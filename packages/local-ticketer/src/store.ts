import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { NewTicket, Ticket, TicketStatus } from "./types";

export const DEFAULT_DIR = ".tickets";

const STATUSES: readonly TicketStatus[] = ["open", "in_progress", "done"];

function isStatus(value: string): value is TicketStatus {
  return (STATUSES as readonly string[]).includes(value);
}

function slug(title: string): string {
  return (
    title
      .toLowerCase()
      // Keep letters and digits from any script, so a Korean title stays readable.
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "ticket"
  );
}

/**
 * Frontmatter is written and read by hand rather than with a YAML library.
 *
 * The schema is a fixed set of single-line string fields, so a parser that
 * splits on the first `:` is both sufficient and impossible to get subtly
 * wrong — and it keeps the package at zero runtime dependencies.
 */
function serialize(ticket: Ticket): string {
  const lines = [
    `id: ${ticket.id}`,
    `title: ${ticket.title.replace(/\n/g, " ")}`,
    `status: ${ticket.status}`,
    `created: ${ticket.created}`,
    `updated: ${ticket.updated}`,
    ticket.url && `url: ${ticket.url}`,
    ticket.endpoint && `endpoint: ${ticket.endpoint}`,
    ticket.routeFile && `route_file: ${ticket.routeFile}`,
    ticket.external && `external_adapter: ${ticket.external.adapter}`,
    ticket.external && `external_id: ${ticket.external.id}`,
    ticket.external?.url && `external_url: ${ticket.external.url}`,
  ].filter(Boolean);
  return `---\n${lines.join("\n")}\n---\n\n${ticket.body}\n`;
}

function parse(text: string, fallbackId: string): Ticket | null {
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (!match) return null;
  const fields = new Map<string, string>();
  for (const line of match[1]!.split("\n")) {
    const at = line.indexOf(":");
    if (at === -1) continue;
    fields.set(line.slice(0, at).trim(), line.slice(at + 1).trim());
  }
  const status = fields.get("status") ?? "open";
  const adapter = fields.get("external_adapter");
  const externalId = fields.get("external_id");
  return {
    id: fields.get("id") ?? fallbackId,
    title: fields.get("title") ?? "(untitled)",
    status: isStatus(status) ? status : "open",
    created: fields.get("created") ?? "",
    updated: fields.get("updated") ?? "",
    ...(fields.get("url") ? { url: fields.get("url")! } : {}),
    ...(fields.get("endpoint") ? { endpoint: fields.get("endpoint")! } : {}),
    ...(fields.get("route_file") ? { routeFile: fields.get("route_file")! } : {}),
    ...(adapter && externalId
      ? {
        external: {
          adapter,
          id: externalId,
          ...(fields.get("external_url") ? { url: fields.get("external_url")! } : {}),
        },
      }
      : {}),
    body: text.slice(match[0].length).replace(/^\n+/, "").replace(/\n+$/, ""),
  };
}

export class TicketStore {
  constructor(private readonly dir: string = DEFAULT_DIR) {}

  private ensure(): void {
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
  }

  private files(): string[] {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir).filter((name) => name.endsWith(".md")).sort();
  }

  list(status?: TicketStatus): Ticket[] {
    const all = this.files()
      .map((name) => parse(readFileSync(join(this.dir, name), "utf-8"), name.replace(/\.md$/, "")))
      .filter((ticket): ticket is Ticket => ticket !== null);
    return status ? all.filter((ticket) => ticket.status === status) : all;
  }

  get(id: string): Ticket | null {
    return this.list().find((ticket) => ticket.id === id) ?? null;
  }

  /** `t-0007`, one past the highest number already on disk. */
  private nextId(): string {
    const highest = this.list().reduce((max, ticket) => {
      const n = Number.parseInt(ticket.id.replace(/^t-/, ""), 10);
      return Number.isFinite(n) && n > max ? n : max;
    }, 0);
    return `t-${String(highest + 1).padStart(4, "0")}`;
  }

  private pathFor(ticket: Ticket): string {
    return join(this.dir, `${ticket.id}-${slug(ticket.title)}.md`);
  }

  create(input: NewTicket, now = new Date().toISOString()): Ticket {
    this.ensure();
    const ticket: Ticket = {
      ...input,
      id: this.nextId(),
      status: input.status ?? "open",
      created: now,
      updated: now,
    };
    writeFileSync(this.pathFor(ticket), serialize(ticket), "utf-8");
    return ticket;
  }

  update(id: string, patch: Partial<Omit<Ticket, "id" | "created">>, now = new Date().toISOString()): Ticket | null {
    const existing = this.get(id);
    if (!existing) return null;
    const updated: Ticket = { ...existing, ...patch, id: existing.id, created: existing.created, updated: now };
    // The title is part of the filename, so a retitle has to replace the file.
    const oldPath = this.files()
      .map((name) => join(this.dir, name))
      .find((path) => readFileSync(path, "utf-8").includes(`id: ${id}`));
    const newPath = this.pathFor(updated);
    writeFileSync(newPath, serialize(updated), "utf-8");
    if (oldPath && oldPath !== newPath) rmSync(oldPath);
    return updated;
  }
}
