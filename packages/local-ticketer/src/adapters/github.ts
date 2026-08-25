import type { Ticket, TicketAdapter, TicketExternalRef } from "../types";
import { ticketMarkdown } from "./format";

export interface GithubAdapterOptions {
  /** `owner/repo`. */
  repo: string;
  /** A token with `issues: write`. Server-side only — never ship this to a browser. */
  token: string;
  labels?: string[];
  /** Override for GitHub Enterprise. */
  apiBase?: string;
  fetchImpl?: typeof fetch;
}

export function githubAdapter(options: GithubAdapterOptions): TicketAdapter {
  const { repo, token, labels, apiBase = "https://api.github.com", fetchImpl } = options;

  return {
    name: "github",
    async create(ticket: Ticket): Promise<TicketExternalRef> {
      const send = fetchImpl ?? globalThis.fetch;
      const response = await send(`${apiBase}/repos/${repo}/issues`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: ticket.title,
          body: ticketMarkdown(ticket),
          ...(labels?.length ? { labels } : {}),
        }),
      });
      if (!response.ok) throw new Error(`github: ${response.status} ${await response.text()}`);
      const issue = (await response.json()) as { number: number; html_url: string };
      return { adapter: "github", id: String(issue.number), url: issue.html_url };
    },
  };
}
