import { cookies } from "next/headers";
import { createAgentUIStreamResponse } from "ai";
import { createDiscussionAgent } from "@/lib/agent";
import {
  COOKIE_NAME,
  validSession,
  localWithoutPassword,
  sameOrigin,
  allowRequest,
} from "@/lib/auth";
import { chatRequest } from "@/lib/request";
export const maxDuration = 120;
export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!sameOrigin(request))
    return new Response("Invalid origin", { status: 403 });
  const secret = process.env.CLUB_PASSWORD;
  if (
    !localWithoutPassword() &&
    !(secret && validSession((await cookies()).get(COOKIE_NAME)?.value, secret))
  )
    return new Response("Enter the class passcode to start chatting.", {
      status: 401,
    });
  if (!process.env.OPENROUTER_API_KEY)
    return new Response("The teacher has not connected the chat model yet.", {
      status: 503,
    });
  if (
    !allowRequest(
      `chat:${request.headers.get("x-forwarded-for") || "local"}`,
      20,
      60_000,
    )
  )
    return new Response("Please wait a minute before sending more questions.", {
      status: 429,
    });
  let payload;
  try {
    const raw = await request.text();
    if (raw.length > 64000)
      return new Response("This conversation is too long. Start a new chat.", {
        status: 413,
      });
    payload = chatRequest.safeParse(JSON.parse(raw));
  } catch {
    return new Response("Invalid chat request.", { status: 400 });
  }
  if (!payload.success)
    return new Response(
      "Invalid conversation. Start a new chat and try again.",
      { status: 400 },
    );
  try {
    return await createAgentUIStreamResponse({
      agent: createDiscussionAgent(payload.data.mode),
      uiMessages: payload.data.messages,
      abortSignal: request.signal,
      timeout: 110_000,
      sendReasoning: false,
      onError: () =>
        "The discussion assistant could not respond. Please retry. If this continues, ask your teacher to check the model connection.",
    });
  } catch {
    return new Response(
      "The discussion assistant is temporarily unavailable. Please retry.",
      { status: 502 },
    );
  }
}
