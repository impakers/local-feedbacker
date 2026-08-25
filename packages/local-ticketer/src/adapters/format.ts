import type { Ticket } from "../types";

/**
 * The body every adapter sends.
 *
 * The agent prompt is the payload worth moving; the rest is enough for a person
 * scanning a tracker to know which screen this came from.
 */
export function ticketMarkdown(ticket: Ticket): string {
  const where = [
    ticket.url && `- URL: ${ticket.url}`,
    ticket.endpoint && `- Endpoint: \`${ticket.endpoint}\``,
    ticket.routeFile && `- Route file: \`${ticket.routeFile}\``,
  ].filter(Boolean);

  return [
    ticket.body,
    where.length ? `\n---\n\n${where.join("\n")}` : "",
    `\n\nFiled by local-ticketer as \`${ticket.id}\`.`,
  ].join("");
}
