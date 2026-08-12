# What leaves the browser

The short version: feedback stays in `localStorage` until you copy it, and this
package makes no request to anything it does not serve itself. The longer
version is worth reading before you put it on a production build, because two
things do reach outside the page and one of them is not obvious.

## What the package stores

Everything lives in `localStorage` on the origin the app runs on:

| What                          | Where                                                    |
| ----------------------------- | -------------------------------------------------------- |
| Submitted prompts (+ screenshots) | one key per app namespace                             |
| Pin positions                 | one key per route                                         |
| Widget settings, language     | one key each                                              |

Prompts are capped at the most recent 200. If the browser refuses the write
because the origin is out of quota, screenshots from the older half are dropped
and the write is retried — the prompt text is what matters, so images are given
up first rather than losing a submission whole.

Because storage is per-origin, two apps served from one origin — every project
you run on `localhost:3000`, any two apps under one domain — share one pile
unless you give each a `namespace`. See the README.

Clearing it is in the widget's settings panel, and the browser's own site-data
controls work too.

## What the package requests

Only its own build output, from your own origin: the file-ID manifest and the
route manifest under `/_next/static/chunks/`. Both are `GET`s for static JSON
that your build emitted. There is no account, no telemetry, no analytics, and
no error reporting.

Nothing is discovered automatically either. The optional local bridge runs only
when the host app passes `onSendToBridge` *and* the reviewer presses the button
— the widget never probes localhost ports looking for an agent. See
[the local bridge contract](local-bridge-contract.md).

## Dictation sends audio to the browser vendor

The microphone button uses the browser's built-in `SpeechRecognition`. In
Chrome that is a **server-side** service: the audio goes to Google, is
transcribed there, and comes back as text. Safari behaves similarly with Apple's
service. This package neither sees nor stores the audio, but "local-first" does
not extend to what the browser does with the microphone.

If that is not acceptable in your setting, say so to the people using the
widget — typing works everywhere and the button is theirs not to press.

## Shipping source maps is a deliberate trade

Attribute injection needs `productionBrowserSourceMaps: true`, which publishes
`.map` files as static assets anyone can fetch. That is the cost of a prompt
that can name a file and line in a production build.

To keep the cost bounded, `withLocalFeedbacker` deletes `sourcesContent` from
every emitted map, so the maps carry path and line mappings without the
original source text. Under Turbopack that stripping does not run as part of
the build — see [source mapping](source-mapping.md) for the postbuild step, and
check a deployed `.map` once to confirm the field is gone.

What remains public even after stripping is the **shape** of your source tree:
file paths and line numbers. The `id` attribute mode keeps those paths out of
the rendered HTML, but the maps still hold them. If a public build must not
reveal its file layout, run with `injectSourceAttributes: false` and accept
prompts that describe the element and route without a confirmed file — the
prompt is explicitly built to stay useful in that case.

## What ends up in a prompt

Only what was on screen: the element and its text, nearby copy, ARIA label and
role, the route URL, the modal it was left inside, the source references above,
and a screenshot when one was attached. Cookies, storage contents, tokens, and
console output are never read into it.
