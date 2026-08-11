import { getMessages } from "../i18n";
import type { FeedbackLanguage } from "../types";
import type { ElementContext } from "../capture/element-context";

export interface SourceReference { file: string; line?: number; column?: number; }
export interface PromptInput {
  language: FeedbackLanguage;
  feedback: string;
  clicked: ElementContext;
  url: string;
  confirmed?: { callsite?: SourceReference; definition?: SourceReference };
  inferred?: SourceReference[];
  /**
   * Present only when the feedback was left inside a modal/overlay. The agent
   * cannot reach that screen by URL alone, so how it was opened matters.
   */
  modal?: { title?: string; trigger?: string; label?: string };
}

function source(ref: SourceReference): string {
  return `\`${ref.file}${ref.line ? `:${ref.line}` : ""}${ref.column !== undefined ? `:${ref.column}` : ""}\``;
}

export function buildFeedbackPrompt(input: PromptInput): string {
  const m = getMessages(input.language);
  const clicked = [
    `- ${m.element}: ${input.clicked.element}`,
    input.clicked.selectedText && `- ${m.selectedText}: ${input.clicked.selectedText}`,
    input.clicked.nearbyText && `- ${m.nearbyCopy}: ${input.clicked.nearbyText}`,
    input.clicked.accessibility && `- Accessibility: ${input.clicked.accessibility}`,
  ].filter(Boolean).join("\n");
  const confirmed = input.confirmed && (input.confirmed.callsite || input.confirmed.definition)
    ? `\n\n## ${m.confirmedSource}\n${[
      input.confirmed.callsite && `- ${m.callsite}: ${source(input.confirmed.callsite)}`,
      input.confirmed.definition && `- ${m.definition}: ${source(input.confirmed.definition)}`,
    ].filter(Boolean).join("\n")}` : "";
  const modal = input.modal
    ? `\n\n## ${m.modalContext}\n${[
      input.modal.title && `- ${m.modalTitle}: ${input.modal.title}`,
      input.modal.trigger && `- ${m.modalTrigger}: ${input.modal.trigger}`,
      input.modal.label && `- ${m.modalLabel}: ${input.modal.label}`,
    ].filter(Boolean).join("\n")}`
    : "";
  const supporting = [`- ${m.route}: ${input.url}`, ...(input.inferred?.map((ref) => `- Inferred source: ${source(ref)}`) ?? [])].join("\n");
  return `## ${m.feedback}: "${input.feedback}"\n\n## ${m.clickedUi}\n${clicked}${modal}${confirmed}\n\n## ${m.supportingContext}\n${supporting}\n\n## ${m.requestedBehavior}\n${m.inspectInstruction}\n${m.ambiguousInstruction}`;
}
