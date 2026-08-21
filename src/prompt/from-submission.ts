import type { SubmitFeedbackPayload } from "../widget/orbit";
import { getMessages } from "../i18n";
import type { FeedbackLanguage } from "../types";
import type { PromptInput, SourceReference } from "./build-prompt";

type DebugTarget = NonNullable<SubmitFeedbackPayload["metadata"]["debugTargets"]>[number];

/** Build-time source attributes are the only trusted references. */
const CONFIRMED_KINDS = ["component-callsite", "component-definition"] as const;

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function reference(target: DebugTarget): SourceReference {
  return { file: target.file, line: target.line, column: target.column };
}

export interface SubmissionPromptOptions {
  language: FeedbackLanguage;
  /** Transcript the reviewer explicitly requested; appended to the written feedback. */
  transcript?: string;
}

/**
 * Maps the payload `DebugWidget` would have sent to the hosted API onto the
 * local prompt contract. The widget already separates confirmed build-time
 * source attributes from inferred ones, so the trust hierarchy is preserved.
 */
export function promptInputFromSubmission(
  payload: SubmitFeedbackPayload,
  options: SubmissionPromptOptions,
): PromptInput {
  const element = (payload.debugInfo?.element ?? {}) as Record<string, unknown>;
  // The widget already detected this for every submission; hosted mode reads it
  // server-side, local mode only ever saw it pass through untouched until now.
  const marker = (payload.feedbackMarker ?? {}) as Record<string, unknown>;
  const routeDebug = payload.metadata.routeDebug;
  const targets: readonly DebugTarget[] = payload.metadata.debugTargets ?? [];
  const callsite = targets.find((target) => target.kind === "component-callsite");
  const definition = targets.find((target) => target.kind === "component-definition");
  // Surfaced on its own line below, so leaving it in `inferred` would print it twice.
  const routePage = targets.find((target) => target.kind === "route-page");
  const inferred = targets.filter(
    (target) =>
      !CONFIRMED_KINDS.includes(target.kind as (typeof CONFIRMED_KINDS)[number]) &&
      target.kind !== "route-page",
  );
  const transcript = options.transcript?.trim();

  return {
    language: options.language,
    feedback: transcript ? `${payload.title}\n\n${getMessages(options.language).voiceTranscriptLabel}\n${transcript}` : payload.title,
    clicked: {
      element: text(element.selector) ?? "",
      selectedText: text(element.selectedText),
      nearbyText: text(element.nearbyText),
      cssClasses: text(element.cssClasses),
      accessibility: text(element.accessibility),
      selector: text(element.domPath),
    },
    url: payload.metadata.url || payload.feedbackUrl || "",
    // The URL is one instance of a screen; the matched pattern and the route's
    // own file are what let an agent act on the screen itself.
    ...(routeDebug?.matchedRoute || routePage
      ? {
        endpoint: {
          ...(routeDebug?.matchedRoute ? { pattern: routeDebug.matchedRoute } : {}),
          ...(routePage ? { file: routePage.file } : {}),
        },
      }
      : {}),
    ...(callsite || definition
      ? {
        confirmed: {
          ...(callsite ? { callsite: reference(callsite) } : {}),
          ...(definition ? { definition: reference(definition) } : {}),
        },
      }
      : {}),
    ...(inferred.length > 0 ? { inferred: inferred.map(reference) } : {}),
    ...(marker.isInModal
      ? {
        modal: {
          title: text(marker.modalTitle),
          trigger: text(marker.modalTrigger),
          label: text(marker.modalLabel),
        },
      }
      : {}),
  };
}
