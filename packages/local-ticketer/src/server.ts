import { TicketStore, DEFAULT_DIR } from "./store";
import type { FeedbackSubmission, Ticket, TicketAdapter } from "./types";

export interface TicketHandlerOptions {
  /** Where tickets are written. Relative to the process working directory. */
  dir?: string;
  /** Forward each new ticket to one destination. Omit to stay purely local. */
  adapter?: TicketAdapter;
  /** Called after a ticket is written, before any adapter runs. */
  onCreated?: (ticket: Ticket) => void;
}

const TITLE_LIMIT = 72;

/** The first line of what the reviewer typed, short enough to be a title. */
export function titleFrom(feedback: string): string {
  const firstLine = feedback.split("\n").map((line) => line.trim()).find(Boolean) ?? "UI feedback";
  return firstLine.length > TITLE_LIMIT ? `${firstLine.slice(0, TITLE_LIMIT - 1)}…` : firstLine;
}

/**
 * Lift the route lines back out of the prompt.
 *
 * `local-feedbacker` 0.1.7+ names the matched route pattern and the route's own
 * source file under `## Supporting context`. Reading them here means a ticket
 * knows which screen it belongs to without the widget having to send a second,
 * parallel description of the same thing.
 */
export function routeFrom(prompt: string): { endpoint?: string; routeFile?: string } {
  const endpoint = /^-\s+(?:Endpoint|Punto final|端点|엔드포인트):\s*(.+)$/m.exec(prompt);
  const routeFile = /^-\s+(?:Route file|Archivo de ruta|路由文件|라우트 파일):\s*`?([^`\n]+)`?$/m.exec(prompt);
  return {
    ...(endpoint?.[1] ? { endpoint: endpoint[1].trim() } : {}),
    ...(routeFile?.[1] ? { routeFile: routeFile[1].trim() } : {}),
  };
}

function isSubmission(value: unknown): value is FeedbackSubmission {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.prompt === "string" && typeof candidate.feedback === "string";
}

/**
 * A Web-standard handler, so it drops into a Next.js route, Hono, Bun, or Deno
 * without an adapter of its own.
 *
 * ```ts
 * // app/api/tickets/route.ts
 * export const POST = createTicketHandler({ adapter: githubAdapter({ ... }) });
 * ```
 */
export function createTicketHandler(options: TicketHandlerOptions = {}) {
  const { dir = DEFAULT_DIR, adapter, onCreated } = options;
  const store = new TicketStore(dir);

  return async function POST(request: Request): Promise<Response> {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "expected a JSON body" }, { status: 400 });
    }
    if (!isSubmission(body)) {
      return Response.json({ error: "expected { prompt, feedback } as strings" }, { status: 400 });
    }

    const ticket = store.create({
      title: titleFrom(body.feedback),
      body: body.prompt,
      ...(body.url ? { url: body.url } : {}),
      ...routeFrom(body.prompt),
    });
    onCreated?.(ticket);

    if (!adapter) return Response.json({ ticket }, { status: 201 });

    // A tracker being down must not lose the ticket that is already on disk.
    try {
      const external = await adapter.create(ticket);
      const linked = store.update(ticket.id, { external }) ?? ticket;
      return Response.json({ ticket: linked }, { status: 201 });
    } catch (error) {
      return Response.json(
        { ticket, warning: `stored locally; ${adapter.name} failed: ${String(error)}` },
        { status: 201 },
      );
    }
  };
}
