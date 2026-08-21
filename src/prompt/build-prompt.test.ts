import { describe, expect, it } from "vitest";
import { buildFeedbackPrompt, withAgentInstructions } from "./build-prompt";

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
  it("titles the document with the feedback, above its own sections", () => {
    const prompt = buildFeedbackPrompt({ ...base, language: "en" });
    expect(prompt.startsWith(`# Feedback: "Make the primary action easier to notice."\n\n## Clicked UI`)).toBe(true);
  });

  it("leaves the agent instructions out so a batch is not told the same thing twice", () => {
    const prompt = buildFeedbackPrompt({ ...base, language: "en" });
    expect(prompt).not.toContain("Requested agent behavior");
  });

  it("puts the confirmed call site ahead of definition and supporting context", () => {
    const prompt = buildFeedbackPrompt({ ...base, language: "en" });
    expect(prompt.indexOf("Call site")).toBeLessThan(prompt.indexOf("Definition"));
    expect(prompt.indexOf("Definition")).toBeLessThan(prompt.indexOf("Supporting context"));
  });

  it("names the screen, not just the URL that was visited", () => {
    const prompt = buildFeedbackPrompt({
      ...base,
      language: "en",
      url: "http://localhost:3000/orders/8123",
      endpoint: { pattern: "/orders/[id]", file: "app/orders/[id]/page.tsx" },
    });
    expect(prompt).toContain("- Route: http://localhost:3000/orders/8123");
    expect(prompt).toContain("- Endpoint: /orders/[id]");
    expect(prompt).toContain("- Route file: `app/orders/[id]/page.tsx`");
  });

  it("keeps the route lines out when the manifest could not resolve one", () => {
    const prompt = buildFeedbackPrompt({ ...base, language: "en" });
    expect(prompt).not.toContain("Endpoint:");
    expect(prompt).not.toContain("Route file:");
  });

  it("translates the route labels with everything else", () => {
    const prompt = buildFeedbackPrompt({
      ...base,
      language: "ko",
      endpoint: { pattern: "/orders/[id]", file: "app/orders/[id]/page.tsx" },
    });
    expect(prompt).toContain("- 엔드포인트: /orders/[id]");
    expect(prompt).toContain("- 라우트 파일: `app/orders/[id]/page.tsx`");
  });

  it("does not claim certainty when build-time references are absent", () => {
    const prompt = buildFeedbackPrompt({ ...base, language: "en", confirmed: undefined });
    expect(prompt).not.toContain("Confirmed implementation source");
    expect(prompt).toContain("Supporting context");
  });
});

describe("withAgentInstructions", () => {
  it("puts the instructions on top of the document, in the widget's language", () => {
    const decorated = withAgentInstructions(buildFeedbackPrompt({ ...base, language: "es" }), "es");
    expect(decorated.startsWith("# Comportamiento solicitado al agente\n")).toBe(true);
    expect(decorated.indexOf("Comportamiento solicitado")).toBeLessThan(decorated.indexOf("# Comentarios"));
  });

  it("says it once no matter how many feedbacks are pasted together", () => {
    const one = buildFeedbackPrompt({ ...base, language: "en" });
    const decorated = withAgentInstructions([one, one, one].join("\n\n---\n\n"), "en");
    expect(decorated.split("Requested agent behavior")).toHaveLength(2);
  });
});
