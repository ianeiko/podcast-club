import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

export function openRouter() {
  if (!process.env.OPENROUTER_API_KEY)
    throw new Error("OpenRouter is not configured");
  return createOpenAICompatible({
    name: "openrouter",
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: process.env.OPENROUTER_API_KEY,
    headers: { "X-Title": "Podcast Club" },
  });
}

export function chatModel(mode: "discussion" | "dev") {
  return mode === "dev"
    ? process.env.DEV_CHAT_MODEL || "openai/gpt-6-luna"
    : process.env.CHAT_MODEL || "openai/gpt-5.1";
}
