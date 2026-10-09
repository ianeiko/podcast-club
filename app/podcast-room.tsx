"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useEffect, useMemo, useRef, useState, useDeferredValue } from "react";
import { Streamdown } from "streamdown";
import type { ComponentProps } from "react";
import episodeInfo from "@/data/episode.json";
import {
  ArrowUp,
  ArrowUpRight,
  AudioLines,
  BookOpen,
  ChevronRight,
  Clock3,
  Download,
  Headphones,
  Lightbulb,
  LoaderCircle,
  MessageCircle,
  Play,
  Plus,
  Search,
  ShieldCheck,
  Square,
  X,
} from "lucide-react";
import type { ClubMessage } from "@/lib/agent";
import type { Passage } from "@/lib/retrieval";

type Segment = { start: number; duration: number; text: string };
type Episode = {
  videoId: string;
  title: string;
  duration: number;
  windowEnd: number;
  passageCount: number;
  wordCount: number;
  totalSegments: number;
  source: string;
};
const STORAGE_KEY = "podcast-club:NYFGCESmikA:v1";
const starters = [
  {
    title: "What changed his mind?",
    detail: "From AI skeptic to agentic programmer.",
    question:
      "What changed DHH’s mind about AI coding? What evidence does he give?",
    icon: Lightbulb,
  },
  {
    title: "More code. Better software?",
    detail: "Find the bottleneck beyond implementation.",
    question:
      "Why doesn’t faster code generation automatically lead to better software? Compare the Omarchy and Basecamp examples.",
    icon: AudioLines,
  },
  {
    title: "Where do you draw the line?",
    detail: "Explore trust, review, and responsibility.",
    question:
      "Which code does DHH still review, and why? Help us debate where human review should remain necessary.",
    icon: ShieldCheck,
  },
  {
    title: "Make the counterargument.",
    detail: "Challenge a claim with your own experience.",
    question:
      "Choose a strong claim from the first 45 minutes and help us critically discuss it. Separate his evidence from assumptions, and suggest a counterargument.",
    icon: MessageCircle,
  },
];
const chapters = [
  { start: 176, title: "A change of mind" },
  { start: 765, title: "Trust, code & human review" },
  { start: 976, title: "The architecture problem" },
  { start: 1124, title: "What actually slows us down?" },
  { start: 1860, title: "A new era of open source" },
  { start: 2163, title: "Creativity, ambition & focus" },
];
const stamp = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

function TranscriptLink({ href, children }: ComponentProps<"a">) {
  try {
    const url = new URL(href || "");
    const time = url.searchParams.get("t") || "";
    if (
      url.protocol !== "https:" ||
      url.hostname !== "www.youtube.com" ||
      url.pathname !== "/watch" ||
      url.searchParams.get("v") !== episodeInfo.videoId ||
      !/^\d+s?$/.test(time) ||
      parseInt(time) >= episodeInfo.windowEnd
    )
      return <span>{children}</span>;
    return (
      <a
        href={`https://www.youtube.com/watch?v=${episodeInfo.videoId}&t=${parseInt(time)}s`}
        target="_blank"
        rel="noreferrer"
      >
        {children}
      </a>
    );
  } catch {
    return <span>{children}</span>;
  }
}
const markdownComponents = { a: TranscriptLink };

function containDialogFocus(event: React.KeyboardEvent<HTMLElement>) {
  if (event.key !== "Tab") return;
  const controls = event.currentTarget.querySelectorAll<HTMLElement>(
    "button:not([disabled]), input",
  );
  const first = controls[0],
    last = controls[controls.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
}

function SourceCards({ passages }: { passages: Passage[] }) {
  return (
    <details className="sources">
      <summary>
        <BookOpen size={13} /> {passages.length} transcript{" "}
        {passages.length === 1 ? "passage" : "passages"}{" "}
        <ChevronRight size={13} />
      </summary>
      <div className="source-grid">
        {passages.map((p) => (
          <a
            key={p.id}
            href={p.url}
            target="_blank"
            rel="noreferrer"
            className="source-card"
          >
            <span>
              {p.timestamp} – {stamp(p.end)} <ArrowUpRight size={12} />
            </span>
            <p>{p.text.replace(/\[\d+:\d+\]\s*/g, "").slice(0, 210)}…</p>
          </a>
        ))}
      </div>
    </details>
  );
}

export default function PodcastRoom({
  episode,
  segments,
}: {
  episode: Episode;
  segments: Segment[];
}) {
  const [tab, setTab] = useState<"chat" | "transcript" | "guide">("chat");
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<"discussion" | "dev">("discussion");
  const [playing, setPlaying] = useState(false);
  const [playFrom, setPlayFrom] = useState(0);
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);
  const [ready, setReady] = useState<boolean | null>(null);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [storageReady, setStorageReady] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        prepareSendMessagesRequest: ({ messages, body }) => ({
          body: {
            ...body,
            // Only text history crosses the trust boundary. Tool results are always fetched on the server.
            messages: messages
              .map((m) => ({
                id: m.id,
                role: m.role,
                parts: [
                  {
                    type: "text",
                    text: m.parts
                      .filter((p) => p.type === "text")
                      .map((p) => p.text)
                      .join("\n"),
                  },
                ],
              }))
              .filter((m) => m.parts[0].text.trim())
              .slice(-24),
          },
        }),
      }),
    [],
  );
  const {
    messages,
    sendMessage,
    status,
    error,
    stop,
    setMessages,
    clearError,
    regenerate,
  } = useChat<ClubMessage>({ transport });
  const busy = status === "submitted" || status === "streaming";

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/session").then((r) => r.json()),
      fetch("/api/health").then((r) => r.json()),
    ])
      .then(([session, health]) => {
        if (!cancelled) {
          setAuthenticated(session.authenticated);
          setReady(health.indexed && health.modelConfigured);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAuthenticated(false);
          setReady(false);
        }
      });
    try {
      const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "[]");
      if (
        Array.isArray(saved) &&
        saved.every(
          (m) =>
            typeof m.id === "string" &&
            ["user", "assistant"].includes(m.role) &&
            Array.isArray(m.parts),
        )
      )
        setMessages(saved.slice(-24));
    } catch {
      /* Storage is optional, including in private browsing. */
    }
    setStorageReady(true);
    return () => {
      cancelled = true;
    };
  }, [setMessages]);
  useEffect(() => {
    if (storageReady && !busy) {
      try {
        sessionStorage.setItem(
          STORAGE_KEY,
          JSON.stringify(messages.slice(-24)),
        );
      } catch {
        /* Keep chat usable without storage. */
      }
    }
  }, [messages, storageReady, busy]);
  useEffect(() => {
    if (tab === "chat" && messages.length)
      bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, tab]);

  const transcriptGroups = useMemo(() => {
    const groups: { start: number; text: string }[] = [];
    for (const segment of segments) {
      const last = groups.at(-1);
      if (!last || segment.start - last.start >= 40)
        groups.push({ start: segment.start, text: segment.text });
      else last.text += " " + segment.text;
    }
    return groups;
  }, [segments]);
  const filteredGroups = transcriptGroups.filter((g) =>
    g.text.toLowerCase().includes(deferredSearch.toLowerCase()),
  );
  const play = (start: number) => {
    setPlayFrom(start);
    setPlaying(true);
  };

  async function ask(text: string) {
    if (!text.trim() || busy) return;
    setTab("chat");
    if (!authenticated) {
      setInput(text);
      setLoginOpen(true);
      return;
    }
    clearError();
    setInput("");
    await sendMessage({ text: text.trim() }, { body: { mode } });
  }
  async function login(event: React.FormEvent) {
    event.preventDefault();
    setLoginBusy(true);
    setLoginError("");
    try {
      const response = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!response.ok) {
        setLoginError(await response.text());
        return;
      }
      setAuthenticated(true);
      setLoginOpen(false);
      setPassword("");
      inputRef.current?.focus();
    } catch {
      setLoginError("Could not connect. Please try again.");
    } finally {
      setLoginBusy(false);
    }
  }
  function newChat() {
    stop();
    setMessages([]);
    clearError();
    setInput("");
    setTab("chat");
  }
  function downloadChat() {
    const text = messages
      .map(
        (m) =>
          `${m.role === "user" ? "You" : "Podcast Club"}\n${m.parts
            .filter((p) => p.type === "text")
            .map((p) => p.text)
            .join("\n")}`,
      )
      .join("\n\n---\n\n");
    const url = URL.createObjectURL(
      new Blob(
        [
          `# Podcast Club\n${episode.title}\nDiscussion: 00:00–45:00\n\n${text}`,
        ],
        { type: "text/markdown" },
      ),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "podcast-club-notes.md";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="Podcast Club home">
          <span className="brand-mark">
            <AudioLines size={25} />
          </span>
          <span>
            podcast<span className="brand-second">club</span>
            <i />
          </span>
        </a>
        <div className="sidebar-heading">
          <span className="eyebrow">THE LISTENING ROOM</span>
          <span className="session-number">01</span>
        </div>
        <div className="video-card">
          {playing ? (
            <iframe
              key={playFrom}
              src={`https://www.youtube-nocookie.com/embed/${episode.videoId}?start=${Math.floor(playFrom)}&end=2700&autoplay=1&rel=0`}
              title="DHH podcast — first 45 minutes"
              allow="autoplay; encrypted-media; picture-in-picture"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
            />
          ) : (
            <button
              className="video-cover"
              onClick={() => play(0)}
              aria-label="Play the first 45 minutes"
            >
              <img
                src={`https://i.ytimg.com/vi/${episode.videoId}/hqdefault.jpg`}
                alt="DHH and Lex Fridman"
              />
              <span className="play-circle">
                <Play size={20} fill="currentColor" />
              </span>
              <span className="video-duration">00:00 – 45:00</span>
            </button>
          )}
        </div>
        <div className="episode-kicker">
          LEX FRIDMAN PODCAST <span>· #501</span>
        </div>
        <h2>
          DHH on the future
          <br />
          of programming.
        </h2>
        <p className="episode-description">
          AI, agentic engineering, and what it means to build things.
        </p>
        <div className="scope">
          <Clock3 size={15} />
          <span>First 45 minutes</span>
          <span className="scope-dot" />
          <span>English</span>
        </div>
        <div className="sidebar-divider" />
        <div className="section-label">
          IN THIS SESSION <span>6 moments</span>
        </div>
        <nav className="chapter-list" aria-label="Episode moments">
          {chapters.map((chapter) => (
            <button
              key={chapter.start}
              onClick={() => play(chapter.start)}
              className={playing && playFrom === chapter.start ? "active" : ""}
            >
              <span>{stamp(chapter.start)}</span>
              {chapter.title}
              <Play size={11} />
            </button>
          ))}
        </nav>
        <div className="sidebar-divider" />
        <div className="transcript-downloads">
          <a href="/transcripts/first-45-minutes.txt" download>
            <Download size={14} /> Session transcript <span>45 min</span>
          </a>
          <a href="/transcripts/full.txt" download>
            <Download size={14} /> Full transcript <span>5h 16m</span>
          </a>
        </div>
        <div className="sidebar-bottom">
          <div className="student-credit">
            <span>N</span>
            <p>
              Built on a student project
              <a
                href="https://github.com/narjes-abs/cowork-youtube_summerizer"
                target="_blank"
                rel="noreferrer"
              >
                Narjes’s YouTube Summarizer <ArrowUpRight size={11} />
              </a>
            </p>
          </div>
          <span className="tiny">A little listening. A lot to talk about.</span>
        </div>
      </aside>

      <main className="main-room">
        <header className="room-header">
          <div className="breadcrumb">
            Podcast club <ChevronRight size={13} />
            <span>Session 01</span>
          </div>
          <div className="header-actions">
            <span className="status-pill">
              <i className={ready ? "online" : ""} />
              {ready === null
                ? "Connecting"
                : ready
                  ? "Ready to discuss"
                  : "Transcript ready"}
            </span>
            <button onClick={newChat} className="new-chat">
              <Plus size={15} /> New chat
            </button>
          </div>
        </header>
        <div className="room-topline">
          <nav className="tabs" aria-label="Room views">
            {(
              [
                { key: "chat", label: "Discussion", icon: MessageCircle },
                { key: "transcript", label: "Transcript", icon: BookOpen },
                { key: "guide", label: "Discussion guide", icon: Lightbulb },
              ] as const
            ).map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                aria-current={tab === key ? "page" : undefined}
                className={tab === key ? "selected" : ""}
                onClick={() => setTab(key)}
              >
                <Icon size={15} />
                {label}
              </button>
            ))}
          </nav>
          <span className="window-label">
            <span />
            00:00–45:00 only
          </span>
        </div>
        <div className="room-content">
          {tab === "chat" && (
            <>
              {messages.length === 0 ? (
                <section className="welcome">
                  <div className="welcome-eyebrow">
                    <span className="little-wave">
                      <AudioLines size={18} />
                    </span>{" "}
                    LISTEN CLOSELY. THINK TOGETHER.
                  </div>
                  <h1>
                    Good listening.
                    <br />
                    <em>Better questions.</em>
                  </h1>
                  <p className="welcome-copy">
                    A space to unpack what you heard. Explore an idea, challenge
                    a claim, or find the moment that made you think.
                  </p>
                  <div className="grounding-note">
                    <BookOpen size={15} />
                    <span>
                      Every answer starts with the transcript.
                      <br className="mobile-break" /> Every idea is up for
                      discussion.
                    </span>
                  </div>
                  <div className="starters-label">
                    A FEW PLACES TO START <span>↙</span>
                  </div>
                  <div className="starter-grid">
                    {starters.map(
                      ({ title, detail, question, icon: Icon }, index) => (
                        <button
                          key={title}
                          className="starter-card"
                          disabled={busy}
                          onClick={() => ask(question)}
                        >
                          <div className="card-top">
                            <Icon size={18} />
                            <span>0{index + 1}</span>
                          </div>
                          <strong>{title}</strong>
                          <p>{detail}</p>
                          <ArrowUpRight className="card-arrow" size={17} />
                        </button>
                      ),
                    )}
                  </div>
                </section>
              ) : (
                <section className="conversation" aria-label="Conversation">
                  <div className="conversation-heading">
                    <span>THE CONVERSATION</span>
                    <button onClick={downloadChat}>
                      <Download size={13} /> Save notes
                    </button>
                  </div>
                  {messages.map((message) => (
                    <article
                      key={message.id}
                      className={`message ${message.role}`}
                    >
                      <div className="message-avatar">
                        {message.role === "user" ? (
                          "Y"
                        ) : (
                          <AudioLines size={18} />
                        )}
                      </div>
                      <div className="message-body">
                        <div className="message-label">
                          {message.role === "user" ? "You" : "Podcast Club"}
                          {message.role === "assistant" && (
                            <span>Discussion partner</span>
                          )}
                        </div>
                        {message.parts.map((part, i) => {
                          if (part.type === "text")
                            return (
                              <div className="message-text" key={i}>
                                <Streamdown
                                  components={markdownComponents}
                                  isAnimating={
                                    busy && message.id === messages.at(-1)?.id
                                  }
                                >
                                  {part.text}
                                </Streamdown>
                              </div>
                            );
                          if (
                            part.type === "tool-searchTranscript" ||
                            part.type === "tool-readWindow"
                          ) {
                            if (part.state === "output-available")
                              return (
                                <SourceCards key={i} passages={part.output} />
                              );
                            if (part.state === "output-error")
                              return (
                                <p className="tool-error" key={i}>
                                  Couldn’t retrieve this passage. Try the
                                  question again.
                                </p>
                              );
                            if (busy)
                              return (
                                <div className="searching" key={i}>
                                  <LoaderCircle size={13} className="spin" />{" "}
                                  Reading the transcript…
                                </div>
                              );
                          }
                          return null;
                        })}
                      </div>
                    </article>
                  ))}
                  {status === "submitted" && (
                    <div className="thinking">
                      <span className="thinking-dots">
                        <i />
                        <i />
                        <i />
                      </span>
                      Finding the right moments…
                    </div>
                  )}
                  {error && (
                    <div className="error-box" role="alert">
                      <p>
                        {error.message || "Something went wrong. Please retry."}
                      </p>
                      <button onClick={() => regenerate({ body: { mode } })}>
                        Try again
                      </button>
                      <button onClick={() => setLoginOpen(true)}>
                        Enter passcode
                      </button>
                    </div>
                  )}
                  <div ref={bottom} />
                </section>
              )}
            </>
          )}
          {tab === "transcript" && (
            <section className="transcript-view">
              <span className="eyebrow">THE SOURCE MATERIAL</span>
              <h1>
                Read between
                <br />
                <em>the timestamps.</em>
              </h1>
              <p className="view-description">
                The original captions, from 00:00 to 45:00. Click a timestamp to
                listen in context. Captions may contain transcription errors.
              </p>
              <div className="mobile-downloads">
                <a href="/transcripts/first-45-minutes.txt" download>
                  <Download size={13} /> Session transcript
                </a>
                <a href="/transcripts/full.txt" download>
                  <Download size={13} /> Full transcript
                </a>
              </div>
              <div className="transcript-tools">
                <label>
                  <Search size={16} />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Find a word or idea…"
                    aria-label="Search transcript"
                  />
                </label>
                <span>{filteredGroups.length} passages</span>
              </div>
              <div className="transcript-text">
                {filteredGroups.length ? (
                  filteredGroups.map((g) => (
                    <div className="transcript-block" key={g.start}>
                      <button
                        onClick={() => play(g.start)}
                        aria-label={`Play at ${stamp(g.start)}`}
                      >
                        {stamp(g.start)}
                      </button>
                      <p>{g.text}</p>
                    </div>
                  ))
                ) : (
                  <div className="empty-search">
                    No passages match “{search}”. Try another word.
                  </div>
                )}
              </div>
            </section>
          )}
          {tab === "guide" && (
            <section className="guide-view">
              <span className="eyebrow">BRING YOUR OWN PERSPECTIVE</span>
              <h1>
                Less recapping.
                <br />
                <em>More thinking.</em>
              </h1>
              <p className="view-description">
                A simple path through the conversation. Listen first, form your
                own view, then use the assistant to find evidence.
              </p>
              <div className="guide-steps">
                {[
                  {
                    time: "5 MIN",
                    title: "Start with a moment.",
                    text: "Each person shares one idea that surprised, excited, or bothered them. Find its timestamp before explaining why.",
                  },
                  {
                    time: "15 MIN",
                    title: "Put a claim on the table.",
                    text: "Compare the Basecamp architecture problem with the speed of Omarchy. What explains the difference? What evidence would change your mind?",
                  },
                  {
                    time: "10 MIN",
                    title: "Make it personal.",
                    text: "Connect the episode to your own project. Which decisions can an agent make? Where do your judgment, taste, and responsibility still matter?",
                  },
                  {
                    time: "5 MIN",
                    title: "Leave with an experiment.",
                    text: "Choose one small thing to test this week. Say what you will measure, and what result would make you reconsider your view.",
                  },
                ].map((step, i) => (
                  <div className="guide-step" key={step.title}>
                    <span className="step-number">0{i + 1}</span>
                    <div>
                      <span className="step-time">{step.time}</span>
                      <h3>{step.title}</h3>
                      <p>{step.text}</p>
                    </div>
                  </div>
                ))}
              </div>
              <button
                className="guide-ask"
                onClick={() =>
                  ask(
                    "Give our student group three debatable discussion questions grounded in specific moments from the first 45 minutes. Include timestamps and a contrasting perspective for each.",
                  )
                }
              >
                Find questions for our group <ArrowUpRight size={16} />
              </button>
            </section>
          )}
        </div>
        {tab === "chat" && (
          <div className="composer-area">
            <form
              className="composer"
              onSubmit={(e) => {
                e.preventDefault();
                void ask(input);
              }}
            >
              <label className="sr-only" htmlFor="question">
                Ask about the episode
              </label>
              <textarea
                id="question"
                ref={inputRef}
                rows={2}
                maxLength={4000}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    !e.shiftKey &&
                    !e.nativeEvent.isComposing
                  ) {
                    e.preventDefault();
                    void ask(input);
                  }
                }}
                placeholder="What’s on your mind about this episode?"
              />
              <div className="composer-bottom">
                <span className="composer-context">
                  <BookOpen size={13} /> First 45 minutes
                </span>
                <div className="composer-controls">
                  <label className="sr-only" htmlFor="model">
                    Conversation model
                  </label>
                  <select
                    id="model"
                    value={mode}
                    disabled={busy}
                    onChange={(e) =>
                      setMode(e.target.value as "discussion" | "dev")
                    }
                  >
                    <option value="discussion">GPT-5.1 · Discussion</option>
                    <option value="dev">GPT-6 Luna · Dev</option>
                  </select>
                  {busy ? (
                    <button
                      className="send-button"
                      type="button"
                      onClick={stop}
                      aria-label="Stop generating"
                    >
                      <Square size={14} fill="currentColor" />
                    </button>
                  ) : (
                    <button
                      className="send-button"
                      type="submit"
                      disabled={!input.trim() || ready === false}
                      aria-label="Send question"
                    >
                      <ArrowUp size={19} />
                    </button>
                  )}
                </div>
              </div>
            </form>
            <div className="composer-footnote">
              <span>Grounded in captions. Open to interpretation.</span>
              {authenticated === false ? (
                <button onClick={() => setLoginOpen(true)}>
                  Enter class passcode <ArrowUpRight size={11} />
                </button>
              ) : (
                <span>
                  ↵ to send <span className="footnote-divider">·</span> shift ↵
                  for a new line
                </span>
              )}
            </div>
            {ready === false && (
              <p className="setup-note">
                The transcript is available. Chat is waiting for the teacher’s
                model connection.
              </p>
            )}
          </div>
        )}
      </main>
      {loginOpen && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) setLoginOpen(false);
          }}
        >
          <section
            className="login-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="login-title"
            onKeyDown={(e) => {
              if (e.key === "Escape") setLoginOpen(false);
              else containDialogFocus(e);
            }}
          >
            <button
              className="modal-close"
              aria-label="Close passcode dialog"
              onClick={() => setLoginOpen(false)}
            >
              <X size={19} />
            </button>
            <span className="login-icon">
              <Headphones size={25} />
            </span>
            <span className="eyebrow">PULL UP A CHAIR</span>
            <h2 id="login-title">Join the conversation.</h2>
            <p>
              Enter the class passcode from your teacher. History is saved in
              this browser tab. Questions and relevant captions are sent to
              OpenRouter to generate answers.
            </p>
            <form onSubmit={login}>
              <label htmlFor="passcode">Class passcode</label>
              <input
                id="passcode"
                autoFocus
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <button type="submit" disabled={loginBusy}>
                {loginBusy ? "Joining…" : "Join the discussion"}
                <ArrowUpRight size={16} />
              </button>
              {loginError && (
                <p className="login-error" role="alert">
                  {loginError}
                </p>
              )}
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
