import { describe, expect, it } from "vitest";
import type { FeedbackLanguage, LocalFeedbackConfig } from "./types";

describe("local feedback public API", () => {
  it("accepts the four supported locales and an optional explicit bridge callback", () => {
    const language: FeedbackLanguage = "zh-CN";
    const config: LocalFeedbackConfig = {
      language,
      onSendToBridge: async () => ({ ok: true }),
    };

    expect(config.language).toBe("zh-CN");
  });
});
