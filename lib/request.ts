import { z } from "zod";
export const chatRequest = z
  .object({
    mode: z.enum(["discussion", "dev"]).default("discussion"),
    messages: z
      .array(
        z
          .object({
            id: z.string().min(1).max(100),
            role: z.enum(["user", "assistant"]),
            parts: z
              .array(
                z
                  .object({
                    type: z.literal("text"),
                    text: z.string().min(1).max(12000),
                  })
                  .strict(),
              )
              .min(1)
              .max(1),
          })
          .strict(),
      )
      .min(1)
      .max(24),
  })
  .refine(
    (value) => value.messages.at(-1)?.role === "user",
    "Last message must be a user message",
  );
