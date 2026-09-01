import { describe, expect, it, vi } from "vitest";
import { createTicketSubmit } from "./client";

const submission = { prompt: "# Feedback", feedback: "Save button does nothing", url: "http://x/y" };

// Typed like `fetch` so the recorded calls keep their shape for the assertions.
function ok(body: unknown = { ticket: { id: "t-0001" } }) {
  return vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
    new Response(JSON.stringify(body), { status: 201 }));
}

describe("createTicketSubmit", () => {
  it("posts the submission to the handler", async () => {
    const fetchImpl = ok();
    await createTicketSubmit({ fetchImpl: fetchImpl as unknown as typeof fetch })(submission);

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("/api/tickets");
    expect(init?.keepalive).toBe(true);
    expect(JSON.parse(init?.body as string).prompt).toBe("# Feedback");
  });

  it("drops a screenshot too large to survive the request", async () => {
    const fetchImpl = ok();
    await createTicketSubmit({
      maxScreenshotBytes: 10,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })({ ...submission, screenshot: "data:image/png;base64,".padEnd(500, "A") });

    const body = JSON.parse(fetchImpl.mock.calls[0]![1]?.body as string);
    expect(body.screenshot).toBeUndefined();
  });

  it("never rejects, because the reviewer has already been served", async () => {
    const onError = vi.fn();
    const failing = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
      throw new Error("offline");
    });

    await expect(
      createTicketSubmit({ onError, fetchImpl: failing as unknown as typeof fetch })(submission),
    ).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledOnce();
  });

  it("treats a rejected request as a failure, not a success", async () => {
    const onError = vi.fn();
    const refused = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      new Response("nope", { status: 500 }));

    await createTicketSubmit({ onError, fetchImpl: refused as unknown as typeof fetch })(submission);

    expect(onError).toHaveBeenCalledOnce();
  });

  it("hands the created ticket back to the host", async () => {
    const onCreated = vi.fn();
    await createTicketSubmit({
      onCreated,
      fetchImpl: ok({ ticket: { id: "t-0042" } }) as unknown as typeof fetch,
    })(submission);

    expect(onCreated).toHaveBeenCalledWith({ id: "t-0042" });
  });
});
