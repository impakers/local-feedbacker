/**
 * What a feedback widget hands over.
 *
 * Accepted structurally on purpose: this package never imports a type from
 * `local-feedbacker`, so the two can be upgraded independently.
 */
export interface FeedbackSubmission {
  prompt: string;
  feedback: string;
  url: string;
  screenshot?: string;
}

/** The shape `onSubmit` expects. Its return value is discarded by the widget. */
export type SubmitHandler = (submission: FeedbackSubmission) => void | Promise<void>;

export type TicketStatus = "open" | "in_progress" | "done";

export interface TicketExternalRef {
  /** Adapter name that created it — `github`, `linear`, `notion`, `slack`. */
  adapter: string;
  /** Identifier in that system, as a string so an issue number and a UUID both fit. */
  id: string;
  url?: string;
}

export interface Ticket {
  /** Stable, sortable, human-typable: `t-0007`. */
  id: string;
  title: string;
  status: TicketStatus;
  /** ISO-8601. */
  created: string;
  updated: string;
  /** Page the feedback was left on. */
  url?: string;
  /** Route pattern the URL resolved to, when the widget could name one. */
  endpoint?: string;
  /** The route's own source file. */
  routeFile?: string;
  external?: TicketExternalRef;
  /** The agent prompt, verbatim. This is the part worth keeping. */
  body: string;
}

/** Everything except the fields the store assigns. */
export type NewTicket = Omit<Ticket, "id" | "created" | "updated" | "status"> &
  Partial<Pick<Ticket, "status">>;

/**
 * A destination outside the repo.
 *
 * Adapters run server-side only. They hold API tokens, so an adapter must never
 * be constructed in browser code.
 */
export interface TicketAdapter {
  readonly name: string;
  /** Create the remote item and return how to find it again. */
  create(ticket: Ticket): Promise<TicketExternalRef>;
}
