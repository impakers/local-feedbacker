import type { Ticket, TicketAdapter, TicketExternalRef } from "../types";
import { ticketMarkdown } from "./format";

export interface SlackAdapterOptions {
  /**
   * Incoming webhook URL, or a bot token plus channel.
   *
   * A webhook is the simpler choice; it returns no message id, so the ticket
   * records the channel rather than a permalink.
   */
  webhookUrl?: string;
  token?: string;
  channel?: string;
  fetchImpl?: typeof fetch;
}

/** Slack truncates hard; leave room for the surrounding fence and heading. */
const TEXT_LIMIT = 2800;

function message(ticket: Ticket): string {
  const body = ticketMarkdown(ticket);
  const trimmed = body.length > TEXT_LIMIT ? `${body.slice(0, TEXT_LIMIT)}\n…` : body;
  return `*${ticket.title}*\n\`\`\`${trimmed}\`\`\``;
}

export function slackAdapter(options: SlackAdapterOptions): TicketAdapter {
  const { webhookUrl, token, channel, fetchImpl } = options;
  if (!webhookUrl && !(token && channel)) {
    throw new Error("slack: pass webhookUrl, or both token and channel");
  }

  return {
    name: "slack",
    async create(ticket: Ticket): Promise<TicketExternalRef> {
      const send = fetchImpl ?? globalThis.fetch;

      if (webhookUrl) {
        const response = await send(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: message(ticket) }),
        });
        if (!response.ok) throw new Error(`slack: ${response.status} ${await response.text()}`);
        return { adapter: "slack", id: `webhook:${ticket.id}` };
      }

      const response = await send("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ channel, text: message(ticket) }),
      });
      if (!response.ok) throw new Error(`slack: ${response.status}`);
      // chat.postMessage answers 200 even when it refuses.
      const payload = (await response.json()) as { ok: boolean; ts?: string; error?: string };
      if (!payload.ok || !payload.ts) throw new Error(`slack: ${payload.error ?? "no ts returned"}`);
      return { adapter: "slack", id: payload.ts };
    },
  };
}
