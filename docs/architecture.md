# Architecture and tech stack

For maintainers. The user-facing guide is [../README.md](../README.md).

## Overview

```
Browser page (HTML/CSS/JS)  <--JSON over http://127.0.0.1-->  Python server (panel/server.py)
                                                                 |-- fetch_transcript.py --> YouTube (captions, title)
                                                                 |-- summarizer.py -------> Ollama on this Mac      (local)
                                                                 |-- cloud.py ------------> OpenRouter / Anthropic  (cloud, optional)
                                                                 |-- pricing.py ----------> OpenRouter public price list
                                                                 |-- keystore.py ---------> macOS Keychain
                                                                 '-- history.py ----------> panel/data/history.json
```

The server listens on `127.0.0.1` only. Summaries run as background jobs that the page polls once a second.

## Stack and versions

| Part | Used | Version on this machine |
|---|---|---|
| Server language | Python (standard library: `http.server`, `http.client`, `threading`, `json`, `subprocess`) | 3.9.6 |
| Page | HTML, CSS, vanilla JavaScript (two scripts: `icons.js`, `app.js`) | no build step |
| Captions | `youtube-transcript-api` (brings `requests`, `defusedxml`, `certifi`, `urllib3`) | 1.2.4 |
| Local model runtime | Ollama, HTTP API at `localhost:11434` | 0.34.4 |
| Local models | `qwen3.5:2b` (2.7 GB), `qwen3.5:9b` (6.6 GB), `qwen3.5:27b` (17 GB) | as pulled |
| Cloud models (optional) | Claude Haiku 4.5, Sonnet 5.5, Opus 5.5 | via OpenRouter or Anthropic |
| Key storage | macOS Keychain through the `security` command | macOS 27.2 |
| Data | JSON file | n/a |
| Tests | pytest | 8.4.2 (163 tests) |

Size: about 1,700 lines of Python, JavaScript and CSS in `panel/`.

## Prerequisites in detail

`panel/run.sh` runs `panel/setup.sh --quiet` before starting, and `panel/setup.sh` checks and installs these automatically (`--check` only reports). This section adds the detail. The setup never installs Homebrew; it installs Python and Ollama through Homebrew when it is present, creates the virtual environment and library itself, and downloads `qwen3.5:9b` only when no `qwen3.5` model exists. It is tested against stand-in commands in `tests/test_setup_script.py`.

- **macOS.** The key store uses the Keychain, so cloud key storage is macOS-only. Everything else is portable Python.
- **Python 3.9+** and the packages in `.claude/skills/yt-summary/requirements.txt` (`youtube-transcript-api`, `pytest`), installed in `.claude/skills/yt-summary/.venv`.
- **Ollama** running, with at least one model. Rough memory use is the model's download size plus context (measured: `qwen3.5:9b` about 6 GB, `qwen3.5:2b` about 2.6 GB loaded; the 27b needs about 17 GB or more).
- **Internet** for the caption download (`youtube.com`) and the title lookup (`youtube.com/oembed`), and for cloud runs (`openrouter.ai` or `api.anthropic.com`).
- **An API key** only for cloud runs.

## Components

| File | Job |
|---|---|
| `panel/server.py` | routes, background jobs (`Job`), progress, abort, static files, Host/`X-Panel` checks |
| `panel/summarizer.py` | Ollama client, `CancelToken`, chunking, notes, condensing, merge, retry, timestamp snapping |
| `panel/cloud.py` | `AnthropicClient`, `OpenRouterClient`, `make_client`, `check_key`, plain-language errors |
| `panel/keystore.py` | Keychain read/write, key format and provider detection |
| `panel/pricing.py` | price list from OpenRouter's public models endpoint, cost estimates |
| `panel/history.py` | JSON history store (add, list, get, delete, corrupt-file recovery) |
| `panel/tools.py` | tool registry: tags, stages, the six model options |
| `panel/static/icons.js` | the icon theme (all icons) |
| `panel/static/app.js`, `style.css`, `index.html` | the page |
| `panel/setup.sh` | checks every requirement, installs what is missing, reports (`--check`, `--quiet`) |
| `panel/run.sh [localhost:number]` | runs `setup.sh --quiet`, then starts the server; the optional value picks the port, default 8000 (`PANEL_SKIP_SETUP=1` skips the check) |
| `.claude/skills/yt-summary/fetch_transcript.py`, `build_page.py` | shared with the panel: caption fetch and summary validation |

## How a summary is made

1. The page posts the link and the chosen option to `POST /api/youtube/summarize`.
2. **Accessing YouTube:** the captions and title are downloaded.
3. **Reading captions:** the transcript is formatted as `[m:ss] text` lines.
4. **Summarizing:** the transcript is split into chunks of about 12,000 characters. One chunk goes straight to the model. Several chunks each produce notes; notes are condensed if they are too long, then merged. The model returns JSON (TL;DR, sections with a `start_time`, takeaways). It is validated, retried once if unusable, and its section times are snapped to real transcript timestamps.
5. **Finishing:** the record is saved to history.

Local runs use Ollama's `/api/chat`. Cloud runs use a forced function/tool call so the answer is structured JSON.

## Models and routing

| Option | Local | Cloud |
|---|---|---|
| Easy | `qwen3.5:2b` | `claude-haiku-4-5-20251001` (OpenRouter: `anthropic/claude-haiku-4.5`) |
| Medium (default) | `qwen3.5:9b` | `claude-sonnet-5-5` (`anthropic/claude-sonnet-5.5`) |
| Hard | `qwen3.5:27b` | `claude-opus-5-5` (`anthropic/claude-opus-5.5`) |

The saved key decides the cloud route: `sk-or-…` uses OpenRouter, `sk-ant-…` uses Anthropic. Dollar estimates come from OpenRouter's public price list.

## API (all under `http://127.0.0.1`)

| Method and path | Purpose |
|---|---|
| `GET /api/tools` | tools with tags, stages, options |
| `GET /api/models` | installed Ollama models (or an error message) |
| `GET /api/prices` | cloud option prices per million tokens |
| `GET /api/settings/key` | `{saved, last4, provider}` (never the key) |
| `POST /api/settings/key` | validate with the provider, then store in the Keychain |
| `DELETE /api/settings/key` | remove the stored key |
| `POST /api/youtube/summarize` | start a job (`{url, option}`) |
| `GET /api/jobs/active` | the running job, if any (lets a reloaded page reattach) |
| `GET /api/jobs/<id>` | stage, label, detail, percent, `can_abort`, result or error |
| `POST /api/jobs/<id>/abort` | stop a local job (409 for cloud jobs) |
| `GET /api/history`, `GET`/`DELETE /api/history/<id>` | list, open, delete saved summaries |

Every non-GET request needs the header `X-Panel: 1`; the `Host` header must be `localhost` or `127.0.0.1`.

## Data and storage

- `panel/data/history.json`: saved summaries (title, video, summary, option, provider, route, model, seconds, and for cloud runs tokens and an estimated cost).
- macOS Keychain item "LearningPanel Anthropic API key": the single API key. The service name is historical; it holds an OpenRouter or Anthropic key.
- Browser `localStorage` key `learning-panel:last-summary`: the last summary shown, so it reopens after a reload. Optional; the page works without it.

## Security notes

- The server binds to localhost, checks `Host`, and requires a custom header on writes, which blocks cross-site requests and DNS rebinding.
- The API key is passed to the Keychain on stdin (`security -i`), never in a command line. Only keys matching the exact format are accepted. Responses, history, job records and errors never contain it, and job errors are scrubbed of it.
- All text from models, transcripts and titles is rendered with `textContent`. The only `innerHTML` is for the constant SVG icons from `icons.js`.
- A cloud request cannot be cancelled once sent (the provider may keep generating and bill), so cloud jobs have no Abort. Local Abort closes the connection to Ollama and unloads the model.
- The Keychain protects the key at rest; software running as your user could still ask for it. Use a dedicated key with a spend limit.

## Icon theme

All icons live in `panel/static/icons.js` and share one style: outline, 24 by 24 grid, 2px round stroke, `currentColor`, no fixed colors. A feature's brand tint is a CSS token (for example `--brand-youtube`). `tests/panel/test_icon_theme.py` fails on any off-style icon or inline SVG elsewhere.

## Known limits

- Keychain key storage is macOS-only.
- The caption library is unofficial and YouTube can block some networks.
- Jobs and their clients stay in memory until the server restarts; a restart drops a running job (history is kept).
- No timeout on the caption download; a very slow model past 15 minutes reports the "Ollama is not reachable" message.
- Cloud cost is an estimate; the provider's dashboard has the exact charge.
- The front end has no automated tests; it was checked in the browser.

## Related documents

- Specs: `docs/superpowers/specs/` (`yt-summary`, `local-panel`, `cloud-and-effort`)
- Plans: `docs/superpowers/plans/`
- Agent brief: [../CLAUDE.md](../CLAUDE.md)

## Podcast Club extension

This branch adds a separate Next.js classroom app at the repository root. The original Python panel and its model choices remain available.

### Data flow

1. The student's `fetch_transcript.py` now preserves each caption's duration and optionally exports the entire track with `--json-out`. No model is used to condense or rewrite it. Language and caption provenance are recorded.
2. `scripts/prepare_club.py` selects captions fully contained within `[0, 2700]`. Captions crossing 45:00 are excluded because word-level timestamps are unavailable. The complete 4,773-caption transcript remains in `data/full-transcript.json` and `public/transcripts/full.txt` (5:15:40).
3. The selected 625 captions (7,077 words, last end 44:58.092) become 28 passages of roughly 1,800 characters with two captions of overlap. Tests verify full coverage and the cutoff.
4. OpenRouter `openai/text-embedding-3-small` creates 1,536-dimensional vectors. They are upserted into a content-addressed Chroma collection with cosine distance and timestamp metadata. A self-retrieval check verifies the stored index.
5. The script reads documents, embeddings, and metadata back from Chroma into `data/vector-index.json`. Vercel bundles this immutable snapshot. Query embeddings use the same recorded model; exact cosine search filters the window again. This is snapshot search, not a Chroma server hosted on Vercel.
6. If `CHROMA_URL` or `CHROMA_API_KEY` is supplied, runtime queries a live Chroma server/cloud collection. Ingest with those same settings first. Remote result IDs are mapped back to the verified snapshot, preventing unrelated remote documents from entering prompts. Live server mode is optional; the deployed snapshot mode was exercised end-to-end.
7. Vercel AI SDK 7 `ToolLoopAgent` calls `searchTranscript` on every turn; `readWindow` can expand evidence within five-minute ranges. A four-step limit and a final no-tools step bound model work. GPT-5.1 is the discussion default; GPT-6 Luna is the development option. Both use the OpenAI-compatible provider pointed at OpenRouter.
8. The UI uses the AI SDK's streaming message transport and Streamdown. Tool results are expandable source cards. Model answers link to actual YouTube times; these remain generated text, so citations should be checked by readers. The UI includes transcript search, bounded video playback, a discussion guide, and Markdown note export.

### Stack

Next.js 16.4 / React 19.3 / TypeScript 7 / AI SDK 7 / Chroma Python 1.5.9 and JS 3.5.0. Node 24 and Python 3.14 were used. Exact JS dependencies are in `package-lock.json`; Python dependencies in `requirements-club.lock`.

### API and storage

| Endpoint | Behavior |
|---|---|
| `GET /api/health` | Reports index and model configuration readiness, never credentials |
| `GET /api/session` | Reports whether the signed class cookie is valid |
| `POST /api/session` | Validates class passcode and issues a 12-hour HttpOnly, SameSite=Strict cookie (Secure in production) |
| `POST /api/chat` | Authenticates, validates bounded text-only history, then streams the agent response |

`.env` and `.env.local` are ignored; local overrides win. The OpenRouter key is never sent to the browser. `CLUB_PASSWORD` is required for production, and rotating it invalidates all class cookies. Local development permits missing passcodes only when not on Vercel. The public transcript is readable without a passcode; the passcode controls billed chat. Login and chat also have best-effort per-instance throttling (10 login attempts / minute, 20 chat requests / minute). These counters are not distributed and should be replaced with a shared limiter for a large public service.

Conversation history is stored in `sessionStorage` in the current browser tab, with a 24-message cap. Only text history is accepted by the server; client-provided tools, system roles, model IDs, and tool outputs are rejected. The model must retrieve fresh evidence. The app checks request origins against the incoming Host (Next may normalize its internal request URL). Captions and conversation content are treated as untrusted evidence in the system prompt.

### Deployment

The repo has been linked to the separate `podcast-club` project in the owner's Vercel account. Use `vercel project inspect --non-interactive` to verify the target before changing environment variables or deploying. Configure `OPENROUTER_API_KEY` and `CLUB_PASSWORD` as sensitive server environment variables, plus the three model identifiers from `.env.example`. Never upload `.env` files. `.vercelignore` excludes secrets, Python runtime, the local Chroma database, and the full structured source. The public transcript downloads are intentionally deployed.

Run `npm run build`, then `vercel deploy --prod` from this root. No transcription or embedding happens during builds; run `npm run transcribe && npm run ingest` locally when changing source material, then redeploy. `next.config.ts` explicitly bundles the vector snapshot into the chat and health functions.

### Scope and limitations

This implementation prepares one fixed episode for one class. The text is the available YouTube caption track, not newly generated audio speech recognition. Caption errors and misattributed speakers can occur. Episode changes require rebuilding the dataset and updating the editorial chapter markers and starter prompts in the UI. The cutoff is enforced by retrieval; an LLM is still probabilistic, so the prompt additionally disallows answering from episode knowledge outside the window. The full video transcript is downloadable but never loaded into the agent context.

Both model IDs were checked against OpenRouter's live catalog. `openai/gpt-5.1` is the available identifier used for the requested “sol 5.1”. OpenRouter's provider availability and behavior can change independently of this app.

### Verification (9 October 2026)

- 195 Python tests and 5 TypeScript tests pass; production compilation and type checking pass.
- Live embedding search retrieves the Basecamp architecture passage. Both GPT-6 Luna and GPT-5.1 successfully call tools and answer with timestamp citations. A request for 1:30:00 declines to invent an answer outside the window.
- Browser verification covers passcode sign-in, streamed discussion, source cards, transcript search, discussion guide navigation, fresh-chat reset, and a narrow layout without horizontal overflow. The video container's flex shrink issue and the local origin mismatch were fixed during verification.
- Production: https://podcast-club.vercel.app. The deployment includes the Chroma snapshot, requires a class passcode for billed chat, and serves both transcript downloads.

The production HTTP smoke test verifies anonymous rejection, invalid-passcode rejection, authenticated cookies, origin rejection, role validation, streamed evidence and citations, and SHA-256 equality of both downloaded transcripts. Run `.venv/bin/python scripts/smoke_http.py https://podcast-club.vercel.app` to repeat it (uses model credits).
