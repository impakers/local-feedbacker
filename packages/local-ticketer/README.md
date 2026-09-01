# local-ticketer

Turns UI feedback into tickets that live in your repository as Markdown files,
and pushes them onward to GitHub Issues, Linear, Notion, or Slack when you want
them there.

It is the companion to [`local-feedbacker`](../../README.md), developed in the
same repository and published on its own: that package produces a prompt naming
the exact file and line behind a clicked element, this one gives that prompt
somewhere to live. Neither depends on the other at build time — the submission
type is accepted structurally — so they version independently.

> **Status: scaffold.** The contracts below are settled and the file store, CLI,
> and browser handler are covered by tests. The four adapters are written but
> have not been run against the live APIs.

## Why three entry points

A feedback widget runs in a browser, and a browser cannot write to `.tickets/`.
So the work splits:

| Entry point | Runs in | Does |
| --- | --- | --- |
| `local-ticketer/client` | Browser | Hands the submission to your app's server |
| `local-ticketer/server` | Node | Writes the ticket file, optionally forwards it |
| `local-ticketer` (CLI) | Terminal | Reads and updates what is on disk |

Adapters live on the server side only, because they hold API tokens. A token
that reaches browser code is a leaked token.

## Setup

```bash
npm install local-ticketer
```

**The route** — anywhere that speaks Web `Request`/`Response`:

```ts
// app/api/tickets/route.ts
import { createTicketHandler } from "local-ticketer/server";

export const POST = createTicketHandler();
```

**The widget:**

```tsx
import { ImpakersFeedbackProvider } from "local-feedbacker/react";
import { createTicketSubmit } from "local-ticketer/client";

<ImpakersFeedbackProvider onSubmit={createTicketSubmit()} />
```

That is the whole local setup. Feedback now lands in `.tickets/` as Markdown.

## What a ticket looks like

```markdown
---
id: t-0007
title: Primary button is invisible on hover
status: open
created: 2026-08-21T09:14:02.117Z
updated: 2026-08-21T09:14:02.117Z
url: http://localhost:3000/orders/8123
endpoint: /orders/[id]
route_file: app/orders/[id]/page.tsx
---

# Feedback: "Primary button is invisible on hover"
...the rest of the agent prompt...
```

`endpoint` and `route_file` are read back out of the prompt itself, which
`local-feedbacker` 0.1.7+ fills in. They are what makes two tickets from
`/orders/8123` and `/orders/9004` recognisable as the same screen.

Because tickets are files, they are diffed, reviewed, and shared through git
like anything else in the repository — and an agent can read and close them
without an API.

## CLI

```bash
npx local-ticketer list [--status open|in_progress|done]
npx local-ticketer show t-0007
npx local-ticketer new "Title" [--body "..."] [--url ...]
npx local-ticketer status t-0007 in_progress
```

`--dir` points at a different folder than `.tickets`.

## Sending tickets onward

Pass an adapter to the handler. The ticket is written to disk first, so a
tracker being unreachable degrades to a local ticket rather than a lost one.

```ts
import { createTicketHandler } from "local-ticketer/server";
import { githubAdapter } from "local-ticketer/adapters";

export const POST = createTicketHandler({
  adapter: githubAdapter({
    repo: "acme/storefront",
    token: process.env.GITHUB_TOKEN!,
    labels: ["ui-feedback"],
  }),
});
```

| Adapter | Needs | Records |
| --- | --- | --- |
| `githubAdapter` | `repo`, `token` (`issues: write`) | Issue number and URL |
| `linearAdapter` | `teamId` (UUID), `token` | Issue identifier and URL |
| `notionAdapter` | `databaseId`, `token` | Page id and URL |
| `slackAdapter` | `webhookUrl`, or `token` + `channel` | Message timestamp |

Writing your own is one method:

```ts
import type { TicketAdapter } from "local-ticketer";

export const myTracker: TicketAdapter = {
  name: "my-tracker",
  async create(ticket) {
    const id = await postSomewhere(ticket);
    return { adapter: "my-tracker", id };
  },
};
```

## The `onSubmit` contract

`createTicketSubmit` returns a function shaped for any feedback widget's
`onSubmit`, and honours the rules that make such a handler safe to add to a
working app: it never throws, never blocks, drops a screenshot too large to
survive the request, and sets `keepalive` so a reviewer navigating away does not
cancel delivery. Failures go to `onError`, never to the reviewer.

The submission type is accepted structurally, so this package never imports from
`local-feedbacker` and the two version independently.

## License

MIT
