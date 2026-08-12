# The prompt format

The widget's output is a Markdown document written for an agent to act on. It
is stable enough to build on, so this is what it contains and why.

## One feedback

```markdown
# Feedback: "Change this to 'Limited seats · closes September 20'"

## Clicked UI
- Element: paragraph: "Enrollment closes"
- Selected text: LIMITED SEATS · DEADLINE SEPTEMBER 20
- Nearby copy: Enrollment closes [after: "39d10h37m33s"]

## Confirmed implementation source — start here
- Call site: `app/(marketing)/page.tsx:212:9`
- Definition: `components/countdown.tsx:79:11`

## Supporting context
- Route: https://example.com/
- Inferred source: `app/(marketing)/page.tsx`
```

The heading levels carry meaning. The feedback is the document title, because
it is the request; everything under it is context the agent needs to act on the
request rather than something being asked for.

Section by section:

| Section                         | Always present | What it is                                                        |
| ------------------------------- | -------------- | ----------------------------------------------------------------- |
| `# Feedback`                     | yes            | What the reviewer typed, plus a dictated transcript if they added one |
| `## Clicked UI`                  | yes            | Element, its text, nearby copy, ARIA label and role                |
| `## Modal context`               | only in a modal | The modal's title, what opened it, and its label                  |
| `## Confirmed implementation source` | only when instrumented | Build-time call site and definition — see [source mapping](source-mapping.md) |
| `## Supporting context`          | yes            | The route, and any *inferred* source references                    |

The split between confirmed and supporting is the point of the whole format. A
build-time attribute is a fact; a route-manifest guess is a lead. They are never
mixed, and a guess is never presented as a fact — so an agent knows when to open
a file and when to go looking.

## Agent instructions come first, once

Every copy — one feedback, an export, or all of them at once — starts with the
standing instructions:

```markdown
# Requested agent behavior
Inspect the confirmed call site first. Preserve unrelated behavior.
Ask a question if the requested visual or interaction change is ambiguous.

---

# Feedback: "…"
…
```

They sit at the top and appear exactly once, no matter how many feedbacks
follow. Repeating them between items would bury the actual requests, which is
the failure mode "copy all" is for.

## Many feedbacks

"Copy all" concatenates every stored feedback under one instruction block, in
submission order, separated by `---`:

```markdown
# Requested agent behavior
…

---

# Feedback: "first"
…

---

# Feedback: "second"
…
```

Each feedback carries its own route and source references, so a single paste can
span several screens without the agent having to ask which is which.

Exporting downloads a zip of the same documents as separate `.md` files — one
per feedback, each carrying the instruction block, alongside any screenshots as
`.jpg` with matching names. That form suits handing an agent a directory rather
than a paste.

## Language

The document is written in the widget's current language — English, Spanish,
Simplified Chinese, or Korean — headings included. The reviewer writes in their
own language and the structure around it follows.

## Reading it yourself

`onCopy` receives the exact string that went to the clipboard, so a host app can
route it somewhere else — a file, an editor, a queue — without reimplementing the
format:

```tsx
<ImpakersFeedbackProvider onCopy={(prompt) => console.log(prompt)} />
```
