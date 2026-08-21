# Changelog

## 0.1.7 — 2026-08-21

### Added

- The prompt now names the screen, not only the URL that was visited. Alongside
  `Route`, `## Supporting context` carries two new lines when the route manifest
  resolves:

  ```markdown
  - Route: https://example.com/orders/8123
  - Endpoint: /orders/[id]
  - Route file: `app/orders/[id]/page.tsx`
  ```

  `Endpoint` is what makes two feedbacks left on `/orders/8123` and
  `/orders/9004` recognisable as the same screen, and `Route file` is where a
  page-level change belongs when the request is about the page rather than one
  element in it. Both were already resolved for every submission and were being
  dropped on the way to the prompt — the matched pattern was discarded outright,
  and the route's file was flattened into an unlabelled `Inferred source` line.

  The route file no longer also appears as `Inferred source`, so it is named
  once. Apps without the route manifest are unchanged: `Route` alone, as before.

## 0.1.6 — 2026-08-20

### Fixed

- Both widgets now work in an app that also installs `@impakers/debug`. This
  package was forked from it and kept writing to names the other package owns,
  so installing both left one of them broken:

  - **Every widget rendered without styles.** Each `<style>` tag is looked up by
    a fixed id and its contents replaced, and all eleven ids were shared with
    `@impakers/debug`. Whichever module was evaluated last replaced the other's
    rules wholesale, and because class names are content-hashed per package, the
    loser's elements were left asking for rules no longer in the document — a
    floating action button with no background, menu items with no chip behind
    them, labels with no spacing between them.
  - **The source manifests overwrote each other.** Both packages emitted
    `impakers-debug-route-manifest.json` and `impakers-debug-src-manifest.json`
    into `.next/static/chunks/`, so only one survived the build and the other
    package's prompts silently lost the file and line they name.

  The style ids are now prefixed `local-feedbacker-styles-`, and the manifests
  ship as `local-feedbacker-route-manifest.json` and
  `local-feedbacker-src-manifest.json`. Nothing changes for an app that installs
  this package alone.

### Known

`localStorage` keys still carry the `impakers-debug-` prefix and overlap with
`@impakers/debug` on `settings`, `hidden`, `token`, `user-data`, `task-seen`,
and `history-last-seen`. Because `localStorage` is scoped per origin, this only
bites when both widgets run on the *same* origin — a dev-only widget and a
production one normally do not. Renaming these would orphan feedback that people
have already saved, so it is left for a release that can migrate it.

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
