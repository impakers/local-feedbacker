# Decision ledger

A Claude Code hook that keeps design decisions checkable. Every row in your design
document's decision table has to say what kind of decision it is, what it rests
on, and where it stands. Rows that pass are appended to a ledger that outlives the
session. Rows that fail are sent back to the agent, and the session cannot end
until they are fixed.

It does not depend on the widget: three plain Node files, no dependencies, nothing
imported from `local-feedbacker`. The two fit together, though. A decision can
cite the feedback that prompted it ([Linking decisions to feedback](#linking-decisions-to-feedback)).

## Why

An agent that records "DEC-04: made the badge red, because it looks better" has
written a decision nobody can check later. Asking for more in a prompt works until
the agent forgets. The hook makes it structural:

- **Type**: what the decision is about, from a list you control.
- **Basis**: what it rests on, in priority order. Each kind demands its own
  evidence, so "the user asked" needs a reference and "it is faster" needs a
  number.
- **Status**: open, deferred with an owner and a revisit date, or closed.

## How it works

| Mode | Runs | Does | The agent sees |
| --- | --- | --- | --- |
| `post` | After every `Edit`, `Write`, or `MultiEdit` of the design document or a meta file. Other files exit immediately. | Validates the rows that changed. Passing rows go to the ledger. Failing rows do not. | `additionalContext` naming the row, the rule, and the allowed values |
| `stop` | Before the session ends | The same sync, plus a session summary. Blocks while any row fails. | Exit `2`, with the failures as the reason |
| `check` | By hand or in CI | The same sync | Exit `1`, with the failures on stderr |

> **Why blocking happens at Stop.** A PostToolUse hook runs after the edit is
> already on disk. Claude Code does not honor exit code 2 there and does not show
> the hook's stderr to the agent, so `additionalContext` is the only way back. The
> Stop hook can block, so that is where the rule is enforced. If the agent tries to
> stop a second time (`stop_hook_active`), the hook lets it go instead of looping.
> The failing rows stay out of the ledger, and the next `post`, `stop`, or `check`
> reports them again.

A broken hook never blocks work. If the config is invalid, `post` reports the
error through `additionalContext`, `stop` lets the session end, and `check` exits
`1`.

## Install

Requires Node 18 or later.

1. Create the three files under [Files](#files) in `.claude/hooks/`.
2. Register the hooks in `.claude/settings.json`, merging with any `hooks` you
   already have:

   ```json
   {
     "hooks": {
       "PostToolUse": [
         {
           "matcher": "Edit|Write|MultiEdit",
           "hooks": [{ "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/dec-ledger.mjs\" post" }]
         }
       ],
       "Stop": [
         {
           "hooks": [{ "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/dec-ledger.mjs\" stop" }]
         }
       ]
     }
   }
   ```

3. Add `.decisions/runs/` to `.gitignore`.
4. Add the decision table ([next section](#the-decision-table)) to your design
   document, and set `file` and `section` in `decision-config.json` to match.
5. Run `node .claude/hooks/dec-ledger.mjs check`. It should print
   `All decisions pass.` or tell you what to fix.

Also tell the agent the rules, in `CLAUDE.md` or `AGENTS.md`. The hook enforces
them either way, but an agent that knows them up front writes passing rows the
first time:

```markdown
Every row in the Design Decisions table of DESIGN.md has a Type, Basis, and Status
from .claude/hooks/decision-config.json. Reason is one line of evidence. Put
evidenceRefs, secondaryTypes, and exception in .decisions/meta/DEC-{n}.json. Never
reuse a decision ID. Fix the rows the decision-ledger hook reports; do not work
around it.
```

## The decision table

```markdown
## Design Decisions

| Decision ID | Decision | Type | Basis | Reason | Impact | Status |
| ----------- | -------- | ---- | ----- | ------ | ------ | ------ |
| DEC-03 | Open the next applicant after saving a review | UX | MEASUREMENT | back to the list 5 times per 10 reviews, clicks 4→1 | PAGE-02 | CLOSED |
| DEC-04 | Separate the selected and warning highlight styles | UI | USER_REQUEST+EXISTING_PATTERN | INT-01, reuses src/ui/badge.tsx | NAV-01 | CLOSED |
```

- Only the first table under the section heading is read. The heading can be
  level 2 or 3 and can be numbered (`## 13. Design Decisions`).
- Columns are matched by header name, so their order does not matter. Extra
  columns are ignored.
- **Basis** joins kinds with `+`, highest priority first.
- **Reason** is one line of evidence, not reasoning. Keep longer thinking
  somewhere else.
- **Impact** is a comma-separated list of what the decision touches, in
  whatever IDs your document uses.
- A row with an empty Decision cell is a placeholder and is skipped, so a
  template can ship `| DEC-01 | | | | | | |`.
- Write a literal pipe inside a cell as `\|`.

## The meta file

Fields that do not fit in a table cell go in `.decisions/meta/<id>.json`. Every
field is optional.

```json
{
  "evidenceRefs": ["feedback:t-0007", "INT-01"],
  "secondaryTypes": ["UX"],
  "exception": { "impact": "Filters reset after saving", "owner": "product", "revisitAt": "2026-10-01" }
}
```

| Field | Shape | Used by |
| --- | --- | --- |
| `evidenceRefs` | string array | R4, R5: references that do not fit in Reason |
| `secondaryTypes` | string array | R1: other types the decision also touches |
| `exception` | object | R7: the fields a deferred decision needs |

Editing a meta file triggers `post`, the same as editing the table.

## Configuration

`.claude/hooks/decision-config.json`. The shipped values are a starting point.
Replace the types and basis kinds with your own.

| Key | Default | Meaning |
| --- | --- | --- |
| `file` | `DESIGN.md` | The design document, relative to the project root |
| `section` | `Design Decisions` | The heading of the section that holds the table |
| `idPrefix` | `DEC` | IDs look like `DEC-01` |
| `reasonMaxLength` | `200` | Maximum characters in Reason |
| `types` | required | Allowed Type values |
| `basis` | required | Basis kinds. Each has a `value`, a unique `priority` (lower is stronger), an optional `evidence` of `"reference"` or `"measurement"`, and an optional `standalone: false` |
| `statuses` | required | Allowed Status values |
| `deferredStatus` | none | `{ "value", "requires" }`: the status that needs an exception record, and the exception fields it needs. Leave it out to turn R7 off. |
| `referencePattern` | IDs like `INT-01`, `feedback:<id>`, file paths | The regular expression a reference has to match (R4) |

Values are compared case-insensitively. An invalid config is reported with every
problem listed at once. Changing the config changes `configHash` on new ledger
lines. Lines already stacked are not validated again.

## Rules

| Rule | Fails when |
| --- | --- |
| R1 | Type is not in `types`, or a secondary type is unknown or repeats the primary |
| R2 | Basis is empty, has an unknown kind, or is out of priority order or repeated |
| R3 | A kind marked `standalone: false` is the only basis |
| R4 | A kind with `evidence: "reference"` has nothing matching `referencePattern` in Reason or `evidenceRefs` |
| R5 | A kind with `evidence: "measurement"` has neither a measurement in Reason (`clicks 4→1`, `wait 4s`, `3 errors`, `40%`) nor a `feedback:<id>` in `evidenceRefs`. A bare number is not a measurement. |
| R6 | Status is not in `statuses` |
| R7 | Status is the deferred status and a field in `requires` is missing from `exception`, or `revisitAt` is not a date |
| R8 | The ID is malformed, appears twice in the table, was removed earlier, or is not above the IDs already used |
| R9 | Reason is empty, contains `<br>`, or is longer than `reasonMaxLength` |
| META | The meta file is not valid JSON, or a field has the wrong shape |

With the shipped config, `USER_REQUEST`, `GUIDELINE`, and `EXISTING_PATTERN` need a
reference, `MEASUREMENT` needs a measurement, `PREFERENCE` has to be paired with
another kind, and `DEFERRED` needs `impact`, `owner`, and `revisitAt`.

## What gets written

| Path | Holds |
| --- | --- |
| `.decisions/ledger.jsonl` | The append-only ledger across sessions. The last line for an ID is its current state. |
| `.decisions/runs/<session>/decisions.jsonl` | The lines stacked in one session |
| `.decisions/runs/<session>/summary.md` | A table of the session's decisions, written at Stop between `<!-- decision-ledger:start -->` and `<!-- decision-ledger:end -->`. The rest of the file is left alone. |
| `.decisions/meta/<id>.json` | Written by you or the agent, read by the hook |

Committing the ledger and meta files gives the team one shared history; that is
your call. The `runs/` directory is per-session and belongs in `.gitignore`.

A ledger line:

```json
{
  "event": "created",
  "id": "DEC-03",
  "decision": "Open the next applicant after saving a review",
  "type": "UX",
  "secondaryTypes": [],
  "basis": ["MEASUREMENT"],
  "reason": "back to the list 5 times per 10 reviews, clicks 4→1",
  "evidenceRefs": ["feedback:t-0007"],
  "status": "CLOSED",
  "exception": null,
  "impact": ["PAGE-02"],
  "sessionId": "5f1c…",
  "gitRef": "b1338ef",
  "recordedAt": "2026-09-13T08:00:00.000Z",
  "configHash": "3e9a41c07b2d"
}
```

`event` is `created`, `updated`, `status_changed`, or `removed`. Saving the same
content again stacks nothing.

## Rows that predate the ledger

When the design document is in git, the hook compares it with the committed
version (`HEAD`). It leaves a row alone if the row is already committed, unchanged,
has never been stacked, and has no meta file. That way, adding the hook to an
existing project does not flood the agent with old rows. The first edit to such a
row validates it, and `post` lists the untouched rows as "not stacked until
edited".

Outside git there is nothing to compare with, so every row is validated.

## Linking decisions to feedback

When a decision answers a piece of feedback, cite it in `evidenceRefs` as
`feedback:<id>`. For a [`local-ticketer`](../packages/local-ticketer) ticket that is
`feedback:t-0007`. The reference satisfies R4 and R5, and anyone reading the ledger
can trace the decision back to what the reviewer actually said.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| Nothing happens after an edit | The hook only reacts to `file` and meta files. Run `check` to see what it sees, and confirm the hooks are registered with `/hooks` in Claude Code. |
| `No "Design Decisions" section` | The heading does not match `section` |
| An old row suddenly fails | It was edited, so it is validated now ([Rows that predate the ledger](#rows-that-predate-the-ledger)) |
| `is not above the IDs already in use` | IDs only go up. Use the ID the message suggests. |
| `was removed earlier and cannot be reused` | Removed IDs are retired. Give the new decision a new ID. |
| `hook error, nothing was checked` | `decision-config.json` is invalid or unreadable. The message lists every problem. |

## Files

### `.claude/hooks/decision-config.json`

```json
{
  "file": "DESIGN.md",
  "section": "Design Decisions",
  "idPrefix": "DEC",
  "reasonMaxLength": 200,
  "types": ["SCOPE", "UX", "UI", "ARCHITECTURE", "DATA", "PROCESS"],
  "basis": [
    { "value": "USER_REQUEST", "priority": 1, "evidence": "reference" },
    { "value": "MEASUREMENT", "priority": 2, "evidence": "measurement" },
    { "value": "GUIDELINE", "priority": 3, "evidence": "reference" },
    { "value": "EXISTING_PATTERN", "priority": 4, "evidence": "reference" },
    { "value": "PREFERENCE", "priority": 5, "standalone": false }
  ],
  "statuses": ["OPEN", "DEFERRED", "CLOSED"],
  "deferredStatus": { "value": "DEFERRED", "requires": ["impact", "owner", "revisitAt"] },
  "referencePattern": "\\b[A-Z][A-Z0-9]*-\\d+\\b|feedback:\\S+|[\\w@.-]*[A-Za-z][\\w@.-]*/[\\w./-]+"
}
```

### `.claude/hooks/dec-core.mjs`

```js
// =============================================================================
// Decision ledger — pure logic
// =============================================================================
//
// Reads the decision table from the design document, compares it with the
// append-only ledger, and works out which events to stack and which rows fail
// validation. Files, git, and stdin live in dec-ledger.mjs; everything here takes
// plain input and returns plain output, so tests call it directly.
//
// Rule numbers (R1–R9, META) are described in docs/decision-ledger.md.
// =============================================================================

const SEPARATOR_CELL = /^:?-+:?$/;
const NEXT_SECTION = /^#{1,2}\s/;

/** A bare number is not a measurement ("INT-01" holds digits too). It needs a unit or a before→after pair. */
const MEASUREMENT =
  /\d+(?:\.\d+)?\s*(?:%|(?:ms|s|secs?|seconds?|mins?|minutes?|h|hours?|x|clicks?|taps?|steps?|errors?|times|items?|rows?|px)\b)|\d+(?:\.\d+)?\s*(?:→|->)\s*\d+/i;

const DEFAULT_REFERENCE_PATTERN = "\\b[A-Z][A-Z0-9]*-\\d+\\b|feedback:\\S+|[\\w@.-]*[A-Za-z][\\w@.-]*/[\\w./-]+";

const COLUMN_BY_HEADER = {
  "decision id": "id",
  decision: "decision",
  type: "type",
  basis: "basis",
  reason: "reason",
  impact: "impact",
  status: "status",
};
export const REQUIRED_COLUMNS = ["id", "decision", "type", "basis", "reason", "impact", "status"];
export const META_FIELDS = "evidenceRefs, secondaryTypes, exception";
export const SUMMARY_START = "<!-- decision-ledger:start -->";
export const SUMMARY_END = "<!-- decision-ledger:end -->";

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const upper = (value) => String(value ?? "").trim().toUpperCase();

// -----------------------------------------------------------------------------
// Config
// -----------------------------------------------------------------------------

/** Fills defaults, normalizes case, and throws one error listing every problem. */
export function normalizeConfig(raw) {
  const problems = [];
  const config = {
    file: "DESIGN.md",
    section: "Design Decisions",
    idPrefix: "DEC",
    reasonMaxLength: 200,
    referencePattern: DEFAULT_REFERENCE_PATTERN,
    deferredStatus: null,
    ...raw,
  };
  const isStringList = (list) =>
    Array.isArray(list) && list.length > 0 && list.every((item) => typeof item === "string" && item.trim());

  for (const key of ["file", "section", "idPrefix"]) {
    if (typeof config[key] !== "string" || !config[key].trim()) problems.push(`${key} must be a non-empty string`);
  }
  if (!Number.isInteger(config.reasonMaxLength) || config.reasonMaxLength < 1) {
    problems.push("reasonMaxLength must be a positive integer");
  }

  if (isStringList(config.types)) config.types = config.types.map(upper);
  else problems.push("types must be a non-empty array of strings");

  if (isStringList(config.statuses)) config.statuses = config.statuses.map(upper);
  else problems.push("statuses must be a non-empty array of strings");

  if (!Array.isArray(config.basis) || config.basis.length === 0) {
    problems.push("basis must be a non-empty array");
  } else {
    config.basis = config.basis.map((entry) => ({ ...entry, value: upper(entry?.value) }));
    const priorities = new Set();
    for (const entry of config.basis) {
      if (!entry.value) problems.push("every basis entry needs a value");
      if (!Number.isFinite(entry.priority)) problems.push(`basis ${entry.value || "(no value)"} needs a numeric priority`);
      else if (priorities.has(entry.priority)) problems.push(`basis priority ${entry.priority} is used more than once`);
      else priorities.add(entry.priority);
      if (entry.evidence != null && !["reference", "measurement"].includes(entry.evidence)) {
        problems.push(`basis ${entry.value}: evidence must be "reference" or "measurement"`);
      }
    }
    config.basis.sort((a, b) => a.priority - b.priority);
  }

  if (config.deferredStatus != null) {
    const deferred = config.deferredStatus;
    const value = upper(deferred.value);
    if (Array.isArray(config.statuses) && !config.statuses.includes(value)) {
      problems.push(`deferredStatus.value "${deferred.value}" is not listed in statuses`);
    }
    if (!isStringList(deferred.requires)) problems.push("deferredStatus.requires must be a non-empty array of field names");
    config.deferredStatus = { value, requires: Array.isArray(deferred.requires) ? deferred.requires : [] };
  }

  try {
    config.referenceRegExp = new RegExp(config.referencePattern);
  } catch (error) {
    problems.push(`referencePattern is not a valid regular expression: ${error.message}`);
  }

  if (problems.length) throw new Error(`decision-config.json is invalid:\n- ${problems.join("\n- ")}`);
  return config;
}

// -----------------------------------------------------------------------------
// Table
// -----------------------------------------------------------------------------

function splitCells(line) {
  const body = line.trim().replace(/^\|/, "").replace(/(?<!\\)\|$/, "");
  return body.split(/(?<!\\)\|/).map((cell) => cell.replace(/\\\|/g, "|").trim());
}

/** Reads only the first table in the decision section. Tables in other sections are left alone. */
export function extractDecisionTable(markdown, config) {
  const heading = new RegExp(`^#{2,3}\\s+(?:\\d+(?:\\.\\d+)*\\.?\\s+)?${escapeRegExp(config.section)}\\s*$`, "i");
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => heading.test(line));
  if (start === -1) return { found: false, columns: [], rows: [] };

  let header = null;
  const rows = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (NEXT_SECTION.test(line)) break;
    if (!line.trim().startsWith("|")) {
      if (header) break;
      continue;
    }
    const cells = splitCells(line);
    if (!header) {
      header = cells.map((cell) => COLUMN_BY_HEADER[cell.toLowerCase()] ?? null);
      continue;
    }
    if (cells.every((cell) => SEPARATOR_CELL.test(cell))) continue;
    const row = { line: i + 1 };
    header.forEach((key, index) => {
      if (key) row[key] = cells[index] ?? "";
    });
    rows.push(row);
  }
  return { found: true, columns: header ? header.filter(Boolean) : [], rows };
}

/** A template row with an empty Decision cell (`| DEC-01 | | | |`) is not a decision. */
export function isPlaceholder(row) {
  return !row.decision;
}

function rowKey(row) {
  return JSON.stringify(REQUIRED_COLUMNS.map((key) => row[key] ?? null));
}

// -----------------------------------------------------------------------------
// Records
// -----------------------------------------------------------------------------

function splitList(value, separator) {
  return (value ?? "")
    .split(separator)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function toRecord(row, meta) {
  const m = meta ?? {};
  return {
    id: row.id,
    decision: row.decision,
    type: upper(row.type),
    secondaryTypes: Array.isArray(m.secondaryTypes) ? m.secondaryTypes.map(upper) : (m.secondaryTypes ?? []),
    basis: splitList(row.basis, "+").map((b) => b.toUpperCase()),
    reason: row.reason ?? "",
    evidenceRefs: m.evidenceRefs ?? [],
    status: upper(row.status),
    exception: m.exception ?? null,
    impact: splitList(row.impact, ","),
  };
}

const CONTENT_KEYS = ["decision", "type", "secondaryTypes", "basis", "reason", "evidenceRefs", "status", "exception", "impact"];

export function fingerprint(record) {
  return JSON.stringify(CONTENT_KEYS.map((key) => record[key] ?? null));
}

/** The ledger is append-only, so the last line for an ID is its current state. */
export function latestById(entries) {
  const latest = new Map();
  for (const entry of entries) if (entry?.id) latest.set(entry.id, entry);
  return latest;
}

// -----------------------------------------------------------------------------
// Validation
// -----------------------------------------------------------------------------

export function validateRecord(record, config) {
  const errors = [];
  const fail = (rule, message) => errors.push({ rule, message });
  const list = (values) => values.join(" | ");

  // R1 — type
  if (!config.types.includes(record.type)) {
    fail("R1", `Type "${record.type}" is not a decision type. Use one of: ${list(config.types)}`);
  }
  if (!Array.isArray(record.secondaryTypes)) {
    fail("META", "secondaryTypes must be an array.");
  } else {
    for (const type of record.secondaryTypes) {
      if (!config.types.includes(type)) fail("R1", `secondaryTypes has "${type}". Use one of: ${list(config.types)}`);
      else if (type === record.type) fail("R1", `secondaryTypes repeats the primary Type ${type}.`);
    }
  }

  // R2 — basis kinds, in priority order
  const order = config.basis.map((b) => b.value).join(" > ");
  const known = [];
  if (record.basis.length === 0) fail("R2", `Basis is empty. Join one or more with "+", highest priority first: ${order}`);
  for (const value of record.basis) {
    const entry = config.basis.find((b) => b.value === value);
    if (entry) known.push(entry);
    else fail("R2", `Basis "${value}" is not a basis kind. Use: ${order}`);
  }
  if (known.some((entry, i) => i > 0 && entry.priority <= known[i - 1].priority)) {
    fail("R2", `Basis must follow priority order without repeats: ${order}`);
  }

  // R3 — some kinds cannot stand alone
  if (record.basis.length === 1 && known.length === 1 && known[0].standalone === false) {
    fail("R3", `${known[0].value} cannot stand alone. Pair it with a basis that ties it to an outcome.`);
  }

  if (!Array.isArray(record.evidenceRefs)) fail("META", "evidenceRefs must be an array of strings.");
  const refs = Array.isArray(record.evidenceRefs) ? record.evidenceRefs.map(String) : [];

  // R4 — kinds that need a reference
  const needsReference = known.filter((b) => b.evidence === "reference").map((b) => b.value);
  if (needsReference.length && !config.referenceRegExp.test([record.reason, ...refs].join(" "))) {
    fail(
      "R4",
      `${needsReference.join(" + ")} needs a reference in Reason or evidenceRefs: an ID like INT-01 or DEC-03, a feedback:<id>, or a file path.`,
    );
  }

  // R5 — kinds that need a measurement
  const needsMeasurement = known.filter((b) => b.evidence === "measurement").map((b) => b.value);
  if (needsMeasurement.length && !MEASUREMENT.test(record.reason) && !refs.some((r) => r.startsWith("feedback:"))) {
    fail(
      "R5",
      `${needsMeasurement.join(" + ")} needs a measurement in Reason ("clicks 4→1", "wait 4s", "3 errors") or a feedback:<id> in evidenceRefs.`,
    );
  }

  // R6 — status
  if (!config.statuses.includes(record.status)) {
    fail("R6", `Status "${record.status}" must be one of: ${list(config.statuses)}`);
  }

  // R7 — a deferred decision records who owns it and when it is revisited
  const exceptionIsObject =
    record.exception != null && typeof record.exception === "object" && !Array.isArray(record.exception);
  if (record.exception != null && !exceptionIsObject) fail("META", "exception must be an object.");
  const deferred = config.deferredStatus;
  if (deferred && record.status === deferred.value) {
    const exception = exceptionIsObject ? record.exception : {};
    const missing = deferred.requires.filter((key) => typeof exception[key] !== "string" || !exception[key].trim());
    if (missing.length) {
      fail("R7", `${deferred.value} needs ${missing.map((key) => `exception.${key}`).join(", ")} in the meta file.`);
    } else if (deferred.requires.includes("revisitAt") && Number.isNaN(Date.parse(exception.revisitAt))) {
      fail("R7", `exception.revisitAt "${exception.revisitAt}" is not a date. Use YYYY-MM-DD.`);
    }
  }

  // R9 — Reason is one line of evidence, not reasoning
  const reasonLength = [...record.reason].length;
  if (!record.reason.trim()) {
    fail("R9", "Reason is empty. Write one line of evidence, not reasoning.");
  } else if (/<br\s*\/?>/i.test(record.reason)) {
    fail("R9", "Reason must be one line (no <br>). Keep longer reasoning outside the table.");
  } else if (reasonLength > config.reasonMaxLength) {
    fail("R9", `Reason is ${reasonLength} characters; keep it within ${config.reasonMaxLength}.`);
  }

  return errors;
}

/** R8 — IDs are unique in the table, removed IDs are never reused, and a new ID is above every ID already used. */
export function checkIds(rows, latest, baselineIds, config) {
  const idPattern = new RegExp(`^${escapeRegExp(config.idPrefix)}-(\\d+)$`);
  const errors = new Map();
  const push = (id, message) => {
    if (!errors.has(id)) errors.set(id, []);
    errors.get(id).push({ rule: "R8", message });
  };

  const counts = new Map();
  for (const row of rows) counts.set(row.id, (counts.get(row.id) ?? 0) + 1);

  const usedNumbers = [...latest.keys(), ...baselineIds]
    .map((id) => Number(idPattern.exec(id)?.[1]))
    .filter(Number.isFinite);
  const maxUsed = usedNumbers.length ? Math.max(...usedNumbers) : 0;
  const nextId = `${config.idPrefix}-${String(maxUsed + 1).padStart(2, "0")}`;

  for (const row of rows) {
    const match = idPattern.exec(row.id ?? "");
    if (!match) {
      push(row.id, `ID "${row.id}" must look like ${config.idPrefix}-{n}.`);
      continue;
    }
    if (counts.get(row.id) > 1) push(row.id, `${row.id} appears ${counts.get(row.id)} times in the table.`);
    const prior = latest.get(row.id);
    if (prior?.event === "removed") {
      push(row.id, `${row.id} was removed earlier and cannot be reused. Use ${nextId}.`);
    } else if (!prior && !baselineIds.has(row.id) && Number(match[1]) <= maxUsed) {
      push(row.id, `${row.id} is not above the IDs already in use. Use ${nextId}.`);
    }
  }
  return errors;
}

// -----------------------------------------------------------------------------
// Sync plan
// -----------------------------------------------------------------------------

function eventKind(prior, record) {
  if (!prior || prior.event === "removed") return "created";
  return fingerprint({ ...prior, status: record.status }) === fingerprint(record) ? "status_changed" : "updated";
}

/**
 * @param {object} input
 * @param {string} input.markdown                The design document as it is now
 * @param {string|null} input.baselineMarkdown   The committed version (null outside git: every row counts as touched)
 * @param {object[]} input.ledger                Ledger lines so far
 * @param {Record<string, object>} input.metaById  Parsed `.decisions/meta/<id>.json` files
 * @param {object} input.config                  Result of normalizeConfig
 */
export function planSync({ markdown, baselineMarkdown, ledger, metaById, config }) {
  const result = {
    file: config.file,
    sectionFound: true,
    events: [],
    failures: [],
    warnings: [],
    legacy: [],
    schemaError: null,
  };

  const table = extractDecisionTable(markdown, config);
  // A whole section going missing is more likely a restructure than every decision being removed.
  if (!table.found) {
    result.sectionFound = false;
    return result;
  }

  const rows = table.rows.filter((row) => !isPlaceholder(row));
  const baselineTable = baselineMarkdown == null ? null : extractDecisionTable(baselineMarkdown, config);
  const baselineRows = new Map(
    (baselineTable?.rows ?? []).filter((row) => !isPlaceholder(row)).map((row) => [row.id, rowKey(row)]),
  );
  const latest = latestById(ledger);

  // Rows committed before the ledger existed, and not touched since, are not blocked. Editing one validates it.
  const touched = rows.filter(
    (row) =>
      baselineTable == null ||
      latest.has(row.id) ||
      metaById[row.id] != null ||
      baselineRows.get(row.id) !== rowKey(row),
  );
  result.legacy = rows.filter((row) => !touched.includes(row)).map((row) => row.id);

  const missingColumns = REQUIRED_COLUMNS.filter((column) => !table.columns.includes(column));
  if (missingColumns.length) {
    const message = `The "${config.section}" table is missing column(s): ${missingColumns.join(", ")}. Expected: | Decision ID | Decision | Type | Basis | Reason | Impact | Status |`;
    if (touched.length) result.schemaError = message;
    else if (rows.length) result.warnings.push({ id: null, rule: "SCHEMA", message });
    return result;
  }

  const idErrors = checkIds(rows, latest, new Set(baselineRows.keys()), config);

  for (const row of touched) {
    const meta = metaById[row.id];
    const record = toRecord(row, meta?.__parseError ? null : meta);
    const prior = latest.get(row.id);
    if (prior && prior.event !== "removed" && fingerprint(prior) === fingerprint(record)) continue;

    const errors = validateRecord(record, config);
    if (meta?.__parseError) {
      errors.unshift({ rule: "META", message: `.decisions/meta/${row.id}.json is not valid JSON: ${meta.__parseError}` });
    }
    errors.push(...(idErrors.get(row.id) ?? []));

    if (errors.length) result.failures.push({ id: row.id, line: row.line, errors });
    else result.events.push({ event: eventKind(prior, record), ...record });
  }

  const present = new Set(rows.map((row) => row.id));
  for (const [id, prior] of latest) {
    if (prior.event !== "removed" && !present.has(id)) {
      result.events.push({ event: "removed", id, decision: prior.decision });
    }
  }

  return result;
}

// -----------------------------------------------------------------------------
// Messages
// -----------------------------------------------------------------------------

function stackedLine(entries) {
  return entries.length ? `[decision-ledger] Stacked: ${entries.map((e) => `${e.id} ${e.event}`).join(", ")}` : "";
}

function warningLines(plan) {
  return plan.warnings.map((w) => `[decision-ledger] ${w.id ?? ""} ${w.rule} ${w.message}`.replace(/\s+/g, " "));
}

/** What went wrong, why, and which values to use instead. */
export function formatReport(plan, { stacked = [], stopping = false } = {}) {
  const lines = [];
  const gate = stopping ? "resolve before stopping" : "the session cannot stop until this passes";
  if (plan.schemaError) lines.push(`[decision-ledger] ${plan.schemaError} (${gate})`);
  if (plan.failures.length) {
    lines.push(`[decision-ledger] ${plan.failures.length} decision(s) in ${plan.file} are not stacked (${gate}):`);
    for (const failure of plan.failures) {
      lines.push("", `${failure.id || "(no id)"} (${plan.file}:${failure.line})`);
      for (const error of failure.errors) lines.push(`  - ${error.rule} ${error.message}`);
    }
    lines.push(
      "",
      `Fix the row, or write .decisions/meta/<id>.json for fields the table cannot hold (${META_FIELDS}). The hook checks again on the next edit.`,
    );
  }
  lines.push(...warningLines(plan));
  const stackedText = stackedLine(stacked);
  if (stackedText) lines.push(stackedText);
  return lines.join("\n");
}

/** A short note for a clean edit. Empty when there is nothing worth saying. */
export function formatNotice(plan, stacked) {
  const lines = [];
  const stackedText = stackedLine(stacked);
  if (stackedText) lines.push(stackedText);
  lines.push(...warningLines(plan));
  if (lines.length && plan.legacy.length) {
    lines.push(`[decision-ledger] Not stacked until edited (predate the ledger): ${plan.legacy.join(", ")}`);
  }
  return lines.join("\n");
}

export function renderSummarySection(sessionEntries) {
  const rows = [...latestById(sessionEntries).values()].map(
    (entry) =>
      `| ${entry.id} | ${entry.event} | ${entry.type ?? ""} | ${(entry.basis ?? []).join(" + ")} | ${entry.status ?? ""} |`,
  );
  return [
    SUMMARY_START,
    "## Decisions stacked in this session",
    "",
    "| ID | Last event | Type | Basis | Status |",
    "| --- | --- | --- | --- | --- |",
    ...rows,
    SUMMARY_END,
  ].join("\n");
}

/** summary.md may hold other notes, so only the hook's own section is replaced. */
export function upsertSection(existing, section) {
  const start = existing.indexOf(SUMMARY_START);
  const end = existing.indexOf(SUMMARY_END);
  if (start !== -1 && end > start) {
    return existing.slice(0, start) + section + existing.slice(end + SUMMARY_END.length);
  }
  return existing.trim() ? `${existing.replace(/\s*$/, "")}\n\n${section}\n` : `${section}\n`;
}
```

### `.claude/hooks/dec-ledger.mjs`

```js
#!/usr/bin/env node
// =============================================================================
// Decision ledger hook — Claude Code PostToolUse / Stop entry point
// =============================================================================
//
//   post   Right after an edit to the design document or .decisions/meta/*.json.
//          Validates changed decisions, stacks the passing ones, and reports
//          failures to the agent through additionalContext. PostToolUse cannot
//          undo an edit that already happened, so blocking is left to `stop`.
//   stop   Just before the session ends. Blocks (exit 2) while any decision
//          fails, and summarizes the decisions stacked in this session.
//   check  For CI and agents without hooks. Same sync; exits 1 on failure.
// =============================================================================

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  formatNotice,
  formatReport,
  normalizeConfig,
  planSync,
  renderSummarySection,
  upsertSection,
} from "./dec-core.mjs";

const HOOK_DIR = path.dirname(fileURLToPath(import.meta.url));
export const CONFIG_PATH = path.join(HOOK_DIR, "decision-config.json");

export function loadConfig(file = CONFIG_PATH) {
  const raw = readFileSync(file, "utf8");
  const config = normalizeConfig(JSON.parse(raw));
  config.hash = createHash("sha256").update(raw).digest("hex").slice(0, 12);
  return config;
}

export function projectPaths(root, sessionId, config) {
  const session = String(sessionId ?? "unknown-session").replace(/[^\w-]/g, "_");
  const decisions = path.join(root, ".decisions");
  const run = path.join(decisions, "runs", session);
  return {
    design: path.resolve(root, config.file),
    metaDir: path.join(decisions, "meta"),
    ledger: path.join(decisions, "ledger.jsonl"),
    runLedger: path.join(run, "decisions.jsonl"),
    summary: path.join(run, "summary.md"),
  };
}

/** Resolves symlinks, including for paths that do not exist yet (macOS /tmp is /private/tmp). */
function realPath(target) {
  try {
    return realpathSync(target);
  } catch {
    const parent = path.dirname(target);
    return parent === target ? target : path.join(realPath(parent), path.basename(target));
  }
}

function readJsonl(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .flatMap((line) => {
      // One truncated line must not block every later edit. It stays in the file for a person to inspect.
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

function appendJsonl(file, entries) {
  if (!entries.length) return;
  mkdirSync(path.dirname(file), { recursive: true });
  appendFileSync(file, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
}

function readMeta(metaDir, config) {
  const meta = {};
  if (!existsSync(metaDir)) return meta;
  const name = new RegExp(`^(${config.idPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-\\d+)\\.json$`);
  for (const file of readdirSync(metaDir)) {
    const match = name.exec(file);
    if (!match) continue;
    try {
      meta[match[1]] = JSON.parse(readFileSync(path.join(metaDir, file), "utf8"));
    } catch (error) {
      meta[match[1]] = { __parseError: error.message };
    }
  }
  return meta;
}

function git(root, args) {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
}

/**
 * @param {"post"|"stop"|"check"} mode
 * @param {object} input  Claude Code hook stdin (session_id, tool_input, stop_hook_active, …)
 * @param {object} [options]  For tests: root, config, baselineMarkdown, gitRef, now
 * @returns {{ exitCode: number, stdout: string, stderr: string }}
 */
export function runHook(mode, input, options = {}) {
  const quiet = { exitCode: 0, stdout: "", stderr: "" };
  const config = options.config ?? loadConfig();
  const root = options.root ?? process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? process.cwd();
  const paths = projectPaths(root, input.session_id, config);

  if (mode === "post") {
    const target = input.tool_input?.file_path;
    if (!target) return quiet;
    const resolved = realPath(path.resolve(root, target));
    if (resolved !== realPath(paths.design) && !resolved.startsWith(realPath(paths.metaDir) + path.sep)) return quiet;
  }
  if (!existsSync(paths.design)) {
    return mode === "check"
      ? { exitCode: 0, stdout: `[decision-ledger] ${config.file} not found; nothing to check.`, stderr: "" }
      : quiet;
  }

  const plan = planSync({
    markdown: readFileSync(paths.design, "utf8"),
    baselineMarkdown:
      "baselineMarkdown" in options
        ? options.baselineMarkdown
        : git(root, ["show", `HEAD:./${config.file.split(path.sep).join("/")}`]),
    ledger: readJsonl(paths.ledger),
    metaById: readMeta(paths.metaDir, config),
    config,
  });

  const stamp = {
    sessionId: input.session_id ?? null,
    gitRef: "gitRef" in options ? options.gitRef : (git(root, ["rev-parse", "--short", "HEAD"])?.trim() ?? null),
    recordedAt: (options.now ?? new Date()).toISOString(),
    configHash: config.hash ?? null,
  };
  const stacked = plan.events.map((event) => ({ ...event, ...stamp }));
  appendJsonl(paths.ledger, stacked);
  appendJsonl(paths.runLedger, stacked);

  const blocked = Boolean(plan.schemaError) || plan.failures.length > 0;

  if (mode === "stop") {
    const sessionEntries = readJsonl(paths.runLedger);
    if (sessionEntries.length) {
      const existing = existsSync(paths.summary) ? readFileSync(paths.summary, "utf8") : "";
      writeFileSync(paths.summary, upsertSection(existing, renderSummarySection(sessionEntries)));
    }
    // stop_hook_active means this hook already blocked once. Blocking again would keep the session from ever ending.
    if (blocked && !input.stop_hook_active) {
      return { exitCode: 2, stdout: "", stderr: formatReport(plan, { stacked, stopping: true }) };
    }
    return quiet;
  }

  if (mode === "check") {
    if (!plan.sectionFound) {
      return { exitCode: 0, stdout: `[decision-ledger] No "${config.section}" section in ${config.file}; nothing to check.`, stderr: "" };
    }
    const report = formatReport(plan, { stacked });
    if (blocked) return { exitCode: 1, stdout: "", stderr: report };
    return { exitCode: 0, stdout: report || "[decision-ledger] All decisions pass.", stderr: "" };
  }

  // PostToolUse ignores exit 2 and hides stderr from the agent; additionalContext is the only channel back.
  const notice = blocked ? formatReport(plan, { stacked }) : formatNotice(plan, stacked);
  if (!notice) return quiet;
  return {
    exitCode: 0,
    stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: notice } }),
    stderr: "",
  };
}

async function readStdin() {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  return raw.trim() ? JSON.parse(raw) : {};
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (invokedDirectly) {
  const mode = process.argv[2];
  try {
    if (!["post", "stop", "check"].includes(mode)) throw new Error(`unknown mode "${mode}" (post | stop | check)`);
    const input = mode === "check" ? { session_id: "manual-check" } : await readStdin();
    const { exitCode, stdout, stderr } = runHook(mode, input);
    if (stdout) process.stdout.write(`${stdout}\n`);
    if (stderr) process.stderr.write(`${stderr}\n`);
    process.exitCode = exitCode;
  } catch (error) {
    // A broken hook must never block the agent's work. It reports the cause and lets the work continue.
    const message = `[decision-ledger] hook error, nothing was checked: ${error?.message ?? error}`;
    if (mode === "post") {
      process.stdout.write(
        `${JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: message } })}\n`,
      );
    } else {
      process.stderr.write(`${message}\n`);
    }
    process.exitCode = mode === "check" ? 1 : 0;
  }
}
```
