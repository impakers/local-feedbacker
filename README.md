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

## Connect your own submit function

Feedback remains local by default, but `onSubmit` lets the host handle each
completed item with any function — from `console.log` to an authenticated
`fetch` request. It receives the copied prompt, the written feedback, the URL,
and a screenshot when screenshot capture is enabled and succeeds.

```tsx
<ImpakersFeedbackProvider
  onSubmit={(submission) => console.log(submission)}
/>
```

```tsx
<ImpakersFeedbackProvider
  onSubmit={async (submission) => {
    await fetch("/api/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(submission),
    });
  }}
/>
```

The callback may be synchronous or async. Its failure never blocks local
copying or storage; authentication, retry, and error reporting are owned by
the host app. Screenshot capture can be turned off per browser in the widget's
Settings panel, or with `P` while a panel is open.

[Writing an onSubmit handler](docs/onsubmit.md) covers the payload, the size of
a screenshot, and what a handler must not do.

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

## Keyboard

Five chords work anywhere on the page, even with an input focused:

| | |
| --- | --- |
| `Ctrl/Cmd+Shift+,` | Feedback mode |
| `Ctrl/Cmd+Shift+.` | Show / hide the widget |
| `Ctrl/Cmd+Shift+;` | Feedback list |
| `Ctrl/Cmd+Shift+'` | Settings |
| `Ctrl/Cmd+Shift+\` | All shortcuts |

They are punctuation on purpose: `Ctrl+Shift+<letter>` is almost always taken
by the browser. Once one of the widget's panels is open, single keys do the
rest — press `?` there to see them all, or run any of them from that sheet.
Single keys never fire while you are typing in your own app.

## What the prompt contains

The prompt distinguishes the clicked element and nearby copy from **confirmed implementation source**. Confirmed call sites and definitions require the existing source-attribute instrumentation; without it, source context is intentionally labelled as supporting context rather than asserted as fact.

Supported languages: English (`en`), Spanish (`es`), Simplified Chinese (`zh-CN`), and Korean (`ko`).

An optional `onSendToBridge` callback can send the reviewer-confirmed prompt to a user-owned local bridge. See [the local bridge contract](docs/local-bridge-contract.md).

## Naming the file to edit

Out of the box a prompt describes the element and the route. To have it name the
file and line that rendered the element, wrap your Next config:

```js
// next.config.mjs
import { withLocalFeedbacker } from "local-feedbacker/next";

export default withLocalFeedbacker(nextConfig);
```

> **Warning:** Production source mapping is best for Preview/Staging or an
> access-controlled reviewer environment. It is an aid for feedback, not an
> access-control mechanism: it must not be relied on to protect source-map or
> route-manifest assets. This warning does not prevent the package from running.

`npm i local-feedbacker` includes the package's `docs/` folder. After enabling
mapping, read [Writing components](docs/writing-components.md): a wrapper must
forward its received props to the rendered DOM element for the call-site
`data-imp-o` attribute to survive.

On Next 16, whose default bundler is Turbopack, add the postbuild step that keeps
your source text out of the published source maps:

```jsonc
"scripts": { "build": "next build && local-feedbacker-strip-maps" }
```

[Source mapping](docs/source-mapping.md) covers the whole setup, plain webpack,
and what changes when it is off.

## Documentation

| | |
| --- | --- |
| [Source mapping](docs/source-mapping.md) | How a clicked element resolves to a file and line, and how to set it up |
| [Writing components](docs/writing-components.md) | Why a call site sometimes fails to reach the DOM, and how to author around it |
| [Writing an onSubmit handler](docs/onsubmit.md) | Delivering feedback somewhere without breaking the local path, and the contract integrations implement |
| [Prompt format](docs/prompt-format.md) | What the copied document contains, section by section |
| [Privacy](docs/privacy.md) | What is stored, what is requested, and what shipping source maps exposes |
| [Local bridge contract](docs/local-bridge-contract.md) | The opt-in callback for handing a prompt to a local agent |
| [Changelog](CHANGELOG.md) | |

---

Built by [Impakers](https://www.impakers.club/local-feedbacker). MIT licensed — [issues and pull requests](https://github.com/impakers/local-feedbacker/issues) are welcome.
