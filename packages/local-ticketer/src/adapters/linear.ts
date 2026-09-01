import type { Ticket, TicketAdapter, TicketExternalRef } from "../types";
import { ticketMarkdown } from "./format";

export interface LinearAdapterOptions {
  /** Linear team UUID, not the team key. */
  teamId: string;
  /** Personal API key or OAuth token. Server-side only. */
  token: string;
  fetchImpl?: typeof fetch;
}

const CREATE_ISSUE = `mutation CreateIssue($input: IssueCreateInput!) {
  issueCreate(input: $input) { success issue { id identifier url } }
}`;

export function linearAdapter(options: LinearAdapterOptions): TicketAdapter {
  const { teamId, token, fetchImpl } = options;

  return {
    name: "linear",
    async create(ticket: Ticket): Promise<TicketExternalRef> {
      const send = fetchImpl ?? globalThis.fetch;
      const response = await send("https://api.linear.app/graphql", {
        method: "POST",
        headers: { Authorization: token, "Content-Type": "application/json" },
        body: JSON.stringify({
          query: CREATE_ISSUE,
          variables: { input: { teamId, title: ticket.title, description: ticketMarkdown(ticket) } },
        }),
      });
      if (!response.ok) throw new Error(`linear: ${response.status} ${await response.text()}`);
      // GraphQL reports failures with HTTP 200, so the body decides.
      const payload = (await response.json()) as {
        errors?: { message: string }[];
        data?: { issueCreate?: { success: boolean; issue?: { id: string; identifier: string; url: string } } };
      };
      const issue = payload.data?.issueCreate?.issue;
      if (payload.errors?.length || !issue) {
        throw new Error(`linear: ${payload.errors?.[0]?.message ?? "issueCreate returned no issue"}`);
      }
      return { adapter: "linear", id: issue.identifier, url: issue.url };
    },
  };
}
