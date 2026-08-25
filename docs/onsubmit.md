# `onSubmit` — sending feedback somewhere

`onSubmit` runs after a reviewer submits one feedback. It is how you get the
generated prompt out of the browser — into a log, a local bridge, an issue
tracker, a chat channel, or your own API.

It is optional. Without it the widget stays entirely local.

```tsx
<ImpakersFeedbackProvider
  namespace="acme-storefront"
  onSubmit={async ({ prompt, feedback, url, screenshot }) => {
    await fetch("/api/ui-feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, feedback, url }),
      keepalive: true,
    });
  }}
/>
```

## What you receive

| Field | Type | Notes |
| --- | --- | --- |
| `prompt` | `string` | The finished agent prompt, exactly as copied to the clipboard. Includes the agent instruction preamble. |
| `feedback` | `string` | Just what the reviewer typed. |
| `url` | `string` | Page URL the feedback was left on. |
| `screenshot` | `string \| undefined` | Data URL. Present only when capture is on and succeeded. **Often over 1 MB.** |

## The rules that matter

### 1. The local path already succeeded — don't undo it

By the time `onSubmit` runs, the prompt is already on the clipboard and the
feedback is already stored. Your handler is additive. Rejections are caught and
ignored on purpose, so a failing transport can never cost the reviewer their
work.

That guarantee only holds if you don't fight it:

```tsx
// Good — failure stays inside the handler.
onSubmit={async (submission) => {
  try {
    await send(submission);
  } catch (error) {
    console.warn("[feedback] delivery failed, kept locally", error);
  }
}}
```

Never `throw` to signal a problem to the reviewer, and never block on something
slow — a hung request delays nothing visible, but it does hold a promise open
for the life of the page.

### 2. Drop the screenshot before it breaks the request

A full-page data URL routinely exceeds 1 MB, and many gateways cap the body
well below that. Decide explicitly rather than discovering the limit in
production:

```tsx
const MAX_SCREENSHOT_BYTES = 1_000_000;

onSubmit={async ({ prompt, feedback, url, screenshot }) => {
  const small = screenshot && screenshot.length <= MAX_SCREENSHOT_BYTES;
  await post({ prompt, feedback, url, screenshot: small ? screenshot : undefined });
}}
```

If screenshots matter to you, upload them separately to blob storage and send
the resulting URL, rather than inlining megabytes of base64 into every request.

### 3. Survive the reviewer navigating away

Reviewers submit feedback and immediately click through to the next screen.
A plain `fetch` started during that teardown can be cancelled. `keepalive: true`
(or `navigator.sendBeacon`) lets the request outlive the page:

```tsx
await fetch(endpoint, { method: "POST", body, keepalive: true });
```

`keepalive` has its own body size cap (64 KB in most browsers) — one more
reason to keep screenshots out of the payload.

### 4. Decide what production means for you

The widget hides itself in production builds unless `defaultVisible` says
otherwise, but `onSubmit` fires wherever it is mounted. If the destination is a
development-only bridge, guard it:

```tsx
onSubmit={process.env.NODE_ENV === "development" ? sendToBridge : undefined}
```

Passing `undefined` is a normal, supported state — the widget simply stays local.

### 5. Know what you are forwarding

The prompt is designed to be useful to a coding agent, so it deliberately
contains repository file paths, line and column numbers, nearby page copy, and
any text the reviewer had selected. That is fine for your own systems. Before
forwarding it to a third party, read one real prompt and confirm you are
comfortable with everything in it.

## Retrying without losing anything

The widget keeps every feedback locally regardless of transport, so a failed
send is a delivery problem, not data loss. Keep retries simple and bounded:

```tsx
async function deliver(submission, attempt = 0) {
  try {
    const res = await fetch(endpoint, { method: "POST", body: JSON.stringify(submission) });
    if (!res.ok) throw new Error(String(res.status));
  } catch (error) {
    if (attempt >= 2) return;                       // give up quietly; it is still stored locally
    await new Promise((r) => setTimeout(r, 2 ** attempt * 1000));
    return deliver(submission, attempt + 1);
  }
}
```

Do not build a persistent outbox unless you actually need one. The reviewer can
always re-copy or export from the widget.

## Common destinations

**Log it while wiring things up**

```tsx
onSubmit={({ prompt }) => console.log(prompt)}
```

**Your own API route** — the default choice. Keep credentials on the server;
never put an API token in browser code.

```tsx
onSubmit={({ prompt, feedback, url }) =>
  fetch("/api/ui-feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, feedback, url }),
    keepalive: true,
  }).then(() => undefined)
}
```

**A local agent bridge** — see [local-bridge-contract.md](./local-bridge-contract.md).
Bind to loopback only, and keep agent credentials and command execution on the
machine, never in browser JavaScript.

## `onSubmit` vs `onCopy` vs `onSendToBridge`

| Hook | Fires | Use it for |
| --- | --- | --- |
| `onCopy` | Every submit, with the prompt | Toasts, analytics counters |
| `onSubmit` | Every submit, with prompt + screenshot | Delivering the feedback somewhere |
| `onSendToBridge` | Only when the reviewer presses **Send to local bridge** | An explicitly reviewer-triggered handoff |

`onSubmit` is automatic; `onSendToBridge` is a decision the reviewer makes per
feedback. Use `onSubmit` when every feedback should go somewhere, and
`onSendToBridge` when the reviewer chooses.

## The contract an integration implements

Packages that deliver feedback somewhere — a ticket store, a hosted inbox, a
chat channel — all expose the same shape, so swapping one for another is a
one-line change in the host app:

```ts
createXSubmit(options): (submission) => void | Promise<void>
```

The returned function is passed straight to `onSubmit`:

```tsx
<ImpakersFeedbackProvider onSubmit={createXSubmit({ /* … */ })} />
```

An integration accepts the submission **structurally** — it must not import a
type from this package, so it stays installable next to any version:

```ts
export interface FeedbackSubmission {
  prompt: string;
  feedback: string;
  url: string;
  screenshot?: string;
}
```

Five rules bind every integration. They are what make an integration safe to
drop into an app that already works:

1. **Never throw, never reject in a way that matters.** Failures are handled
   inside the handler.
2. **Never block.** The reviewer has already been served by the time the
   handler runs.
3. **Decide about the screenshot explicitly.** Drop it, upload it separately, or
   document the size limit — never send it by accident.
4. **Survive navigation.** `keepalive: true`, or a transport that does the same.
5. **No secrets in the browser.** API tokens for a third-party tracker belong on
   a server the integration owns, never in the handler's options.

An integration that needs to tell the host something — a claim URL, a created
ticket's link — takes a callback in its options rather than returning a value,
because `onSubmit`'s return is discarded.

### Integrations

| Package | Delivers to |
| --- | --- |
| [`local-ticketer`](../packages/local-ticketer) | File-based tickets in the repo, and from there GitHub Issues, Linear, Notion, or Slack |
| [`@impakers/jian`](https://github.com/impakers/impakers-jian) | The Impakers inbox, where an agent drafts a reply and opens a PR |

`local-ticketer` is developed in this repository, under `packages/`. It is
published separately and does not depend on this package at build time.
