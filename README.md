# @impakers/local-feedbacker

Local-first UI feedback for designers and PMs working with coding agents. Select an element, describe the desired change, review a structured prompt, then copy it into Codex, Claude Code, or another agent.

It has no account, backend, telemetry, Impakers OS dependency, or automatic local-server discovery.

```tsx
"use client";
import { ImpakersFeedbackProvider } from "@impakers/local-feedbacker/react";

export function Feedback() {
  return <ImpakersFeedbackProvider language="en" />;
}
```

The prompt distinguishes the clicked element and nearby copy from **confirmed implementation source**. Confirmed call sites and definitions require the existing source-attribute instrumentation; without it, source context is intentionally labelled as supporting context rather than asserted as fact.

Supported languages: English (`en`), Spanish (`es`), Simplified Chinese (`zh-CN`), and Korean (`ko`).

An optional `onSendToBridge` callback can send the reviewer-confirmed prompt to a user-owned local bridge. See [the local bridge contract](docs/local-bridge-contract.md).
