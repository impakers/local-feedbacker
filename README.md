# local-feedbacker

Local-first UI feedback for designers and PMs working with coding agents. Select an element, describe the desired change, review a structured prompt, then copy it into Codex, Claude Code, or another agent.

It has no account, backend, telemetry, Impakers OS dependency, or automatic local-server discovery.

```tsx
"use client";
import { ImpakersFeedbackProvider } from "local-feedbacker/react";

export function Feedback() {
  return <ImpakersFeedbackProvider language="en" />;
}
```

## Running it in more than one app

Feedback is stored in the browser, which scopes storage per origin — so two apps
that share an origin share one pile of feedback. That is easy to hit by accident:
every local project you run on `localhost:3000` is the same origin, as is any two
apps mounted under one domain.

Give each app a `namespace` and its feedback stays its own:

```tsx
<ImpakersFeedbackProvider namespace="acme-storefront" language="en" />
```

Use a stable, distinct value — your package name works well. You can leave it
unset when a single app owns the whole origin.

Upgrading from a version without `namespace`? The first app to name itself adopts
whatever was already stored, so nothing is lost. If that pile was already mixed,
clear it from the widget's settings panel and start clean.

## What the prompt contains

The prompt distinguishes the clicked element and nearby copy from **confirmed implementation source**. Confirmed call sites and definitions require the existing source-attribute instrumentation; without it, source context is intentionally labelled as supporting context rather than asserted as fact.

Supported languages: English (`en`), Spanish (`es`), Simplified Chinese (`zh-CN`), and Korean (`ko`).

An optional `onSendToBridge` callback can send the reviewer-confirmed prompt to a user-owned local bridge. See [the local bridge contract](docs/local-bridge-contract.md).
