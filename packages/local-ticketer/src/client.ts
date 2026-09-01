import type { FeedbackSubmission, SubmitHandler, Ticket } from "./types";

export interface TicketSubmitOptions {
  /** Route that `local-ticketer/server` is mounted on. */
  endpoint?: string;
  /**
   * Screenshots arrive as data URLs and routinely exceed a megabyte, which is
   * past what many gateways accept and well past the `keepalive` body cap.
   * Anything larger is dropped rather than failing the whole request.
   */
  maxScreenshotBytes?: number;
  /** Called with the created ticket. `onSubmit`'s own return value is discarded. */
  onCreated?: (ticket: Ticket) => void;
  /** Called instead of throwing. Delivery failures never reach the reviewer. */
  onError?: (error: unknown) => void;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
}

const DEFAULT_ENDPOINT = "/api/tickets";
const DEFAULT_MAX_SCREENSHOT_BYTES = 1_000_000;

/**
 * Build the handler to pass to a feedback widget's `onSubmit`.
 *
 * The browser cannot write to `.tickets/`, so this posts to the server half of
 * this package, which owns the filesystem and any adapter credentials.
 */
export function createTicketSubmit(options: TicketSubmitOptions = {}): SubmitHandler {
  const {
    endpoint = DEFAULT_ENDPOINT,
    maxScreenshotBytes = DEFAULT_MAX_SCREENSHOT_BYTES,
    onCreated,
    onError,
    fetchImpl,
  } = options;

  return async (submission: FeedbackSubmission) => {
    try {
      const send = fetchImpl ?? globalThis.fetch;
      if (!send) return;

      const screenshot =
        submission.screenshot && submission.screenshot.length <= maxScreenshotBytes
          ? submission.screenshot
          : undefined;

      const response = await send(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...submission, screenshot }),
        // Reviewers submit and immediately navigate; without this the request
        // is cancelled with the page.
        keepalive: true,
      });

      if (!response.ok) throw new Error(`local-ticketer: ${response.status}`);
      if (!onCreated) return;
      const created = (await response.json()) as { ticket?: Ticket };
      if (created.ticket) onCreated(created.ticket);
    } catch (error) {
      // The prompt is already on the clipboard and the feedback is already
      // stored by the widget. A failed delivery must not undo either.
      onError?.(error);
    }
  };
}
