import { describe, expect, it } from "vitest";
import { collectElementContext } from "./element-context";

describe("collectElementContext", () => {
  it("captures clicked UI and nearby copy without diagnostics", () => {
    document.body.innerHTML = '<button aria-label="Save profile">Save</button><p>Changes apply immediately.</p>';
    const result = collectElementContext(document.querySelector("button")!);
    expect(result).toMatchObject({ element: "button", selectedText: "Save", nearbyText: "Changes apply immediately." });
    expect(JSON.stringify(result)).not.toMatch(/cookie|jwt|console/i);
  });
});
