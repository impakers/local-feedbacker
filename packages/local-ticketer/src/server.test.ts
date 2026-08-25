import { describe, expect, it } from "vitest";
import { routeFrom, titleFrom } from "./server";

const PROMPT = `# Feedback: "Make the primary action easier to notice."

## Supporting context
- Route: http://localhost:3000/orders/8123
- Endpoint: /orders/[id]
- Route file: \`app/orders/[id]/page.tsx\`
`;

describe("routeFrom", () => {
  it("lifts the screen back out of the prompt", () => {
    expect(routeFrom(PROMPT)).toEqual({
      endpoint: "/orders/[id]",
      routeFile: "app/orders/[id]/page.tsx",
    });
  });

  it("reads a prompt written in the reviewer's language", () => {
    const korean = "## 보조 컨텍스트\n- 엔드포인트: /orders/[id]\n- 라우트 파일: `app/orders/[id]/page.tsx`\n";
    expect(routeFrom(korean)).toEqual({
      endpoint: "/orders/[id]",
      routeFile: "app/orders/[id]/page.tsx",
    });
  });

  it("returns nothing when the widget could not resolve a route", () => {
    expect(routeFrom("## Supporting context\n- Route: http://localhost:3000/\n")).toEqual({});
  });
});

describe("titleFrom", () => {
  it("uses the first written line", () => {
    expect(titleFrom("\n  Save button does nothing  \nmore detail")).toBe("Save button does nothing");
  });

  it("truncates rather than letting a paragraph become a filename", () => {
    expect(titleFrom("x".repeat(200))).toHaveLength(72);
  });

  it("still names a ticket when the reviewer typed nothing", () => {
    expect(titleFrom("")).toBe("UI feedback");
  });
});
