import { describe, expect, it } from "vitest";
import { buildFeedbackPrompt } from "./build-prompt";

const base = {
  feedback: "Make the primary action easier to notice.",
  clicked: { element: "button", selectedText: "Save", nearbyText: "Changes apply immediately." },
  url: "http://localhost:3000/profile",
  confirmed: {
    callsite: { file: "src/profile/ProfileForm.tsx", line: 42, column: 4 },
    definition: { file: "src/components/ui/button.tsx", line: 10, column: 0 },
  },
};

describe("buildFeedbackPrompt", () => {
  it("collapses the feedback heading and its text onto one quoted line", () => {
    const prompt = buildFeedbackPrompt({ ...base, language: "en" });
    expect(prompt.startsWith(`## Feedback: "Make the primary action easier to notice."\n\n## Clicked UI`)).toBe(true);
  });

  it("puts the confirmed call site ahead of definition and supporting context", () => {
    const prompt = buildFeedbackPrompt({ ...base, language: "en" });
    expect(prompt.indexOf("Call site")).toBeLessThan(prompt.indexOf("Definition"));
    expect(prompt.indexOf("Definition")).toBeLessThan(prompt.indexOf("Supporting context"));
  });

  it("does not claim certainty when build-time references are absent", () => {
    const prompt = buildFeedbackPrompt({ ...base, language: "en", confirmed: undefined });
    expect(prompt).not.toContain("Confirmed implementation source");
    expect(prompt).toContain("Supporting context");
  });
});
