#!/usr/bin/env node
import { TicketStore, DEFAULT_DIR } from "./store";
import type { Ticket, TicketStatus } from "./types";

const USAGE = `local-ticketer — file-based tickets for UI feedback

  local-ticketer list [--status open|in_progress|done]
  local-ticketer show <id>
  local-ticketer new "<title>" [--body "<text>"] [--url <url>]
  local-ticketer status <id> <open|in_progress|done>

  --dir <path>   where tickets live (default: ${DEFAULT_DIR})
`;

const STATUS_MARK: Record<TicketStatus, string> = {
  open: "○",
  in_progress: "◐",
  done: "●",
};

function flag(args: string[], name: string): string | undefined {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? undefined : args[at + 1];
}

function isStatus(value: string | undefined): value is TicketStatus {
  return value === "open" || value === "in_progress" || value === "done";
}

/** Positional arguments only — anything from `--flag` onward belongs to a flag. */
function positionals(args: string[]): string[] {
  const out: string[] = [];
  for (let at = 0; at < args.length; at += 1) {
    const value = args[at]!;
    if (value.startsWith("--")) {
      at += 1;
      continue;
    }
    out.push(value);
  }
  return out;
}

function line(ticket: Ticket): string {
  const where = ticket.endpoint ?? ticket.url ?? "";
  const external = ticket.external ? ` → ${ticket.external.adapter}#${ticket.external.id}` : "";
  return `${STATUS_MARK[ticket.status]} ${ticket.id}  ${ticket.title}${where ? `  (${where})` : ""}${external}`;
}

export function run(argv: string[]): number {
  const [command, ...rest] = argv;
  const store = new TicketStore(flag(rest, "dir") ?? DEFAULT_DIR);
  const args = positionals(rest);

  switch (command) {
    case "list": {
      const status = flag(rest, "status");
      if (status !== undefined && !isStatus(status)) {
        process.stderr.write(`unknown status: ${status}\n`);
        return 1;
      }
      const tickets = store.list(status);
      if (tickets.length === 0) {
        process.stdout.write("no tickets\n");
        return 0;
      }
      process.stdout.write(`${tickets.map(line).join("\n")}\n`);
      return 0;
    }

    case "show": {
      const id = args[0];
      const ticket = id ? store.get(id) : null;
      if (!ticket) {
        process.stderr.write(`no such ticket: ${id ?? "(missing id)"}\n`);
        return 1;
      }
      process.stdout.write(`${line(ticket)}\n\n${ticket.body}\n`);
      return 0;
    }

    case "new": {
      const title = args[0];
      if (!title) {
        process.stderr.write("a title is required\n");
        return 1;
      }
      const created = store.create({
        title,
        body: flag(rest, "body") ?? "",
        ...(flag(rest, "url") ? { url: flag(rest, "url")! } : {}),
      });
      process.stdout.write(`${created.id}\n`);
      return 0;
    }

    case "status": {
      const [id, next] = args;
      if (!id || !isStatus(next)) {
        process.stderr.write("usage: local-ticketer status <id> <open|in_progress|done>\n");
        return 1;
      }
      const updated = store.update(id, { status: next });
      if (!updated) {
        process.stderr.write(`no such ticket: ${id}\n`);
        return 1;
      }
      process.stdout.write(`${line(updated)}\n`);
      return 0;
    }

    default:
      process.stdout.write(USAGE);
      return command === undefined || command === "--help" || command === "help" ? 0 : 1;
  }
}

// `import.meta.url` is unavailable in the CJS build, so the ESM build is the
// one wired up as the executable.
process.exitCode = run(process.argv.slice(2));
