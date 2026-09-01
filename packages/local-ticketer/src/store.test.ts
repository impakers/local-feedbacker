import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TicketStore } from "./store";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "local-ticketer-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("TicketStore", () => {
  it("round-trips every field through the file", () => {
    const store = new TicketStore(dir);
    const created = store.create({
      title: "Primary button is invisible on hover",
      body: "# Feedback\n\nsome prompt",
      url: "http://localhost:3000/orders/8123",
      endpoint: "/orders/[id]",
      routeFile: "app/orders/[id]/page.tsx",
    });

    expect(new TicketStore(dir).get(created.id)).toEqual(created);
  });

  it("numbers tickets in order, so an id can be typed from memory", () => {
    const store = new TicketStore(dir);
    expect(store.create({ title: "one", body: "" }).id).toBe("t-0001");
    expect(store.create({ title: "two", body: "" }).id).toBe("t-0002");
  });

  it("keeps a non-latin title readable in the filename", () => {
    const store = new TicketStore(dir);
    const created = store.create({ title: "저장 버튼이 안 눌립니다", body: "" });

    expect(new TicketStore(dir).get(created.id)?.title).toBe("저장 버튼이 안 눌립니다");
  });

  it("does not leave the old file behind when a retitle renames it", () => {
    const store = new TicketStore(dir);
    const created = store.create({ title: "before", body: "" });

    store.update(created.id, { title: "after" });

    expect(store.list()).toHaveLength(1);
    expect(store.get(created.id)?.title).toBe("after");
  });

  it("reports an empty list rather than failing when nothing has been filed", () => {
    expect(new TicketStore(join(dir, "missing")).list()).toEqual([]);
  });
});
