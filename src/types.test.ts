import { describe, expect, it } from "vitest";
import type { FeedbackLanguage, LocalFeedbackConfig, LocalFeedbackSubmission } from "./types";

describe("local feedback public API", () => {
  it("accepts the four supported locales and an optional explicit bridge callback", () => {
    const language: FeedbackLanguage = "zh-CN";
    const config: LocalFeedbackConfig = {
      language,
      onSendToBridge: async () => ({ ok: true }),
    };

    expect(config.language).toBe("zh-CN");
  });

  it("accepts a local submission hook for console output or an async fetch", () => {
    const consoleConfig: LocalFeedbackConfig = {
      onSubmit: (submission) => {
        void submission.prompt;
        void submission.feedback;
        void submission.url;
        void submission.screenshot;
      },
    };
    const fetchConfig: LocalFeedbackConfig = {
      onSubmit: async (submission) => {
        await fetch("/api/feedback", {
          method: "POST",
          body: JSON.stringify(submission),
        });
      },
    };
    const submission: LocalFeedbackSubmission = {
      prompt: "# Feedback",
      feedback: "Move the CTA",
      url: "https://example.test/pricing",
    };

    expect(consoleConfig.onSubmit).toBeTypeOf("function");
    expect(fetchConfig.onSubmit).toBeTypeOf("function");
    expect(submission.screenshot).toBeUndefined();
  });
});
