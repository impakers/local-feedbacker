import { describe, expect, it } from "vitest";
import type { SubmitFeedbackPayload } from "../widget/orbit";
import { buildFeedbackPrompt } from "./build-prompt";
import { promptInputFromSubmission } from "./from-submission";

const payload = {
  title: "Make the upgrade button more prominent",
  description: "",
  priority: "medium",
  metadata: {
    url: "https://example.test/billing",
    timestamp: "2026-07-29T00:00:00.000Z",
    browser: "Chrome",
    userAgent: "test",
    viewport: "1280x800",
    pixelRatio: 2,
    language: "en",
    referrer: "",
    debugTargets: [
      { kind: "component-callsite", file: "src/app/billing/page.tsx", line: 42, column: 6, confidence: 1, reason: "build-time" },
      { kind: "component-definition", file: "src/components/ui/button.tsx", line: 18, column: 2, confidence: 1, reason: "build-time" },
      { kind: "route-page", file: "src/app/billing/page.tsx", confidence: 0.5, reason: "route-manifest" },
    ],
  },
  debugInfo: {
    comment: "Make the upgrade button more prominent",
    element: {
      selector: "<PlanCard> button.upgrade",
      domPath: "main > article > button",
      selectedText: "Upgrade workspace",
      nearbyText: "You can cancel or change plans at any time.",
      cssClasses: "upgrade",
      accessibility: "role=button",
    },
  },
  feedbackUrl: "/billing",
} as unknown as SubmitFeedbackPayload;

describe("promptInputFromSubmission", () => {
  it("keeps confirmed build-time sources separate from inferred ones", () => {
    const input = promptInputFromSubmission(payload, { language: "en" });

    expect(input.confirmed).toEqual({
      callsite: { file: "src/app/billing/page.tsx", line: 42, column: 6 },
      definition: { file: "src/components/ui/button.tsx", line: 18, column: 2 },
    });
    expect(input.inferred).toEqual([{ file: "src/app/billing/page.tsx", line: undefined, column: undefined }]);
  });

  it("maps the clicked UI and route from the widget submission", () => {
    const input = promptInputFromSubmission(payload, { language: "en" });

    expect(input.clicked).toMatchObject({
      element: "<PlanCard> button.upgrade",
      selectedText: "Upgrade workspace",
      nearbyText: "You can cancel or change plans at any time.",
      selector: "main > article > button",
    });
    expect(input.url).toBe("https://example.test/billing");
    expect(input.feedback).toBe("Make the upgrade button more prominent");
  });

  it("appends an explicitly requested transcript to the feedback", () => {
    const input = promptInputFromSubmission(payload, { language: "en", transcript: "  also fix the spacing  " });
    expect(input.feedback).toContain("Voice note transcript:\nalso fix the spacing");
  });

  it("omits the confirmed heading when the consumer has no source instrumentation", () => {
    const bare = { ...payload, metadata: { ...payload.metadata, debugTargets: undefined } } as SubmitFeedbackPayload;
    const prompt = buildFeedbackPrompt(promptInputFromSubmission(bare, { language: "en" }));

    expect(prompt).not.toContain("Confirmed implementation source");
    expect(prompt).toContain("## Clicked UI");
  });

  it("carries the modal the feedback was left inside into the prompt", () => {
    const inModal = {
      ...payload,
      feedbackMarker: {
        isInModal: true,
        modalTitle: "Change plan",
        modalTrigger: "button.upgrade",
        modalLabel: "Upgrade workspace",
      },
    } as unknown as SubmitFeedbackPayload;
    const input = promptInputFromSubmission(inModal, { language: "en" });

    expect(input.modal).toEqual({ title: "Change plan", trigger: "button.upgrade", label: "Upgrade workspace" });

    const prompt = buildFeedbackPrompt(input);
    expect(prompt).toContain("## Modal context");
    expect(prompt).toContain("- Title: Change plan");
    expect(prompt).toContain("- Trigger: button.upgrade");
    expect(prompt).toContain("- Label: Upgrade workspace");
  });

  it("omits the modal section outside a modal, and with no marker at all", () => {
    const outside = {
      ...payload,
      feedbackMarker: { isInModal: false, modalTitle: "Change plan" },
    } as unknown as SubmitFeedbackPayload;

    const outsideInput = promptInputFromSubmission(outside, { language: "en" });
    expect(outsideInput.modal).toBeUndefined();
    expect(buildFeedbackPrompt(outsideInput)).not.toContain("Modal context");

    // The base fixture has no `feedbackMarker` key whatsoever.
    const bareInput = promptInputFromSubmission(payload, { language: "en" });
    expect(bareInput.modal).toBeUndefined();
    expect(buildFeedbackPrompt(bareInput)).not.toContain("Modal context");
  });

  it("never carries cookies, JWT claims, or console buffers into the prompt", () => {
    const noisy = {
      ...payload,
      metadata: {
        ...payload.metadata,
        cookies: { session: "secret" },
        jwtClaims: { sub: "user-1" },
        consoleErrors: ["boom"],
      },
    } as SubmitFeedbackPayload;
    const prompt = buildFeedbackPrompt(promptInputFromSubmission(noisy, { language: "en" }));

    expect(prompt).not.toMatch(/secret|user-1|boom/);
  });
});
