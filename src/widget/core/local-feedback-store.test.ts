import { beforeEach, describe, expect, it } from "vitest";
import { createLocalFeedbackStore } from "./local-feedback-store";
import type { SubmitFeedbackPayload } from "./feedback-store";

const HEADER = "## Requested agent behavior\nInspect the confirmed call site first.";

function payload(title: string): SubmitFeedbackPayload {
  return { title, description: title, metadata: { url: "http://localhost:3000/" } } as unknown as SubmitFeedbackPayload;
}

function makeStore() {
  return createLocalFeedbackStore({
    onSubmit: () => {},
    buildPrompt: (p) => `# Feedback: "${p.title}"`,
    decorateDocument: (text) => `${HEADER}\n\n---\n\n${text}`,
  });
}

describe("createLocalFeedbackStore document decoration", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("says the agent instructions once, on top of everything copied at once", async () => {
    const store = makeStore();
    await store.submitFeedback("", payload("first"));
    await store.submitFeedback("", payload("second"));

    const combined = await store.copyAll();

    expect(combined.startsWith(HEADER)).toBe(true);
    expect(combined.split("Requested agent behavior")).toHaveLength(2);
    expect(combined.indexOf(`"first"`)).toBeLessThan(combined.indexOf(`"second"`));
  });

  it("still carries the instructions when a single feedback is handed over alone", async () => {
    const store = makeStore();
    const { taskId } = await store.submitFeedback("", payload("only"));

    expect(store.getEntryText(taskId ?? "")?.startsWith(HEADER)).toBe(true);
  });

  it("leaves an empty copy-all empty rather than returning a bare header", async () => {
    expect(await makeStore().copyAll()).toBe("");
  });
});
