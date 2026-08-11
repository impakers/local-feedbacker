import { describe, expect, it } from "vitest";
import { collectConfirmedSource } from "./source-context";

describe("collectConfirmedSource", () => {
  it("keeps the call site distinct from the definition", async () => {
    document.body.innerHTML = '<button data-imp-o="src/profile/Form.tsx:42:4" data-imp="src/ui/button.tsx:10:0">Save</button>';
    await expect(collectConfirmedSource(document.querySelector("button")!)).resolves.toEqual({
      callsite: { file: "src/profile/Form.tsx", line: 42, column: 4 },
      definition: { file: "src/ui/button.tsx", line: 10, column: 0 },
    });
  });
});
