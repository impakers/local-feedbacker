import type { Ticket, TicketAdapter, TicketExternalRef } from "../types";
import { ticketMarkdown } from "./format";

export interface NotionAdapterOptions {
  /** Database the ticket becomes a page in. */
  databaseId: string;
  /** Internal integration secret. Server-side only. */
  token: string;
  /** Title property name, when the database does not call it `Name`. */
  titleProperty?: string;
  /** Select/status property to write the ticket status into, when one exists. */
  statusProperty?: string;
  notionVersion?: string;
  fetchImpl?: typeof fetch;
}

/** Notion rejects rich-text blocks over 2000 characters. */
const BLOCK_LIMIT = 2000;

function paragraphs(text: string) {
  const chunks: string[] = [];
  for (let at = 0; at < text.length; at += BLOCK_LIMIT) chunks.push(text.slice(at, at + BLOCK_LIMIT));
  return chunks.map((chunk) => ({
    object: "block",
    type: "paragraph",
    paragraph: { rich_text: [{ type: "text", text: { content: chunk } }] },
  }));
}

export function notionAdapter(options: NotionAdapterOptions): TicketAdapter {
  const {
    databaseId,
    token,
    titleProperty = "Name",
    statusProperty,
    notionVersion = "2022-06-28",
    fetchImpl,
  } = options;

  return {
    name: "notion",
    async create(ticket: Ticket): Promise<TicketExternalRef> {
      const send = fetchImpl ?? globalThis.fetch;
      const response = await send("https://api.notion.com/v1/pages", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Notion-Version": notionVersion,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          parent: { database_id: databaseId },
          properties: {
            [titleProperty]: { title: [{ text: { content: ticket.title } }] },
            ...(statusProperty ? { [statusProperty]: { select: { name: ticket.status } } } : {}),
          },
          children: paragraphs(ticketMarkdown(ticket)),
        }),
      });
      if (!response.ok) throw new Error(`notion: ${response.status} ${await response.text()}`);
      const page = (await response.json()) as { id: string; url?: string };
      return { adapter: "notion", id: page.id, ...(page.url ? { url: page.url } : {}) };
    },
  };
}
