# Changelog

## 0.1.5 — 2026-08-12

### Changed

- The agent instructions are no longer repeated after every feedback. They now
  appear once, at the top of whatever is handed over — a single recap, an
  exported file, or every feedback at once. Pasting several screens' worth of
  notes used to say the same three lines once per item and bury the requests
  between them.
- A feedback is now the title of its own document (`# Feedback: "…"`), with its
  sections a level below, so the heading levels say which text is the request
  and which is context around it.

### Added

- Documentation for the parts that were only readable in the source:
  [source mapping](docs/source-mapping.md) (build setup, what the two
  attributes mean, the Turbopack postbuild step),
  [writing components](docs/writing-components.md) (why a call site fails to
  reach the DOM), [the prompt format](docs/prompt-format.md), and
  [what leaves the browser](docs/privacy.md).

### Note

Feedback already in `localStorage` was stored in the old shape and still carries
its trailing instruction block. Clearing the list once from the settings panel
is enough.

## 0.1.4 — 2026-08-12

- Link the repository from the settings panel and the README, in all four
  languages. Released on its own because 0.1.3 shipped from the commit before
  the links existed.

## 0.1.3 — 2026-08-12

- Scope feedback per app with `namespace`, so two apps sharing an origin —
  every project on `localhost:3000`, any two apps under one domain — no longer
  share one pile.
- Fix screen capture, folder export, and pin removal.
- Credit Impakers in the settings panel, with a link that follows the reader's
  language.

## 0.1.0 — 2026-08-11

- First release: local-first UI feedback prompts for coding agents, extracted
  as a standalone package. No account, no backend, no telemetry.
