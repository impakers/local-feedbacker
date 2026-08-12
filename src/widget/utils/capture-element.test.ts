import { afterEach, describe, expect, it, vi } from "vitest";

// html2canvas 는 jsdom 에서 실제로 그릴 수 없다. 여기서 확인하려는 것은 그림이
// 아니라 **어느 영역을 달라고 요청했는지**(크롭 원점)라서 옵션만 가로챈다.
const calls: Record<string, unknown>[] = [];

vi.mock("html2canvas-pro", () => ({
  default: (_el: HTMLElement, options: Record<string, unknown>) => {
    calls.push(options);
    return Promise.resolve({ toDataURL: () => "data:image/jpeg;base64," });
  },
}));

const { captureFullPage } = await import("./capture-element");

function scrollTo(x: number, y: number): void {
  Object.defineProperty(window, "scrollX", { value: x, configurable: true });
  Object.defineProperty(window, "scrollY", { value: y, configurable: true });
}

afterEach(() => {
  calls.length = 0;
  scrollTo(0, 0);
});

describe("captureFullPage", () => {
  it("crops at the current scroll offset, not the top of the document", async () => {
    // 회귀 방지: x/y 를 빼면 html2canvas 가 크롭 원점을 문서 좌상단(0,0)으로 잡아
    // 아무리 스크롤해도 페이지 맨 위만 찍힌다.
    scrollTo(0, 1200);

    await captureFullPage();

    expect(calls).toHaveLength(1);
    expect(calls[0]!.y).toBe(1200);
    expect(calls[0]!.x).toBe(0);
  });

  it("follows horizontal scrolling too", async () => {
    scrollTo(340, 60);

    await captureFullPage();

    expect(calls[0]!.x).toBe(340);
    expect(calls[0]!.y).toBe(60);
  });

  it("still asks for exactly one viewport", async () => {
    scrollTo(0, 800);

    await captureFullPage();

    expect(calls[0]!.width).toBe(window.innerWidth);
    expect(calls[0]!.height).toBe(window.innerHeight);
  });

  it("captures the top of the page when not scrolled", async () => {
    await captureFullPage();

    expect(calls[0]!.x).toBe(0);
    expect(calls[0]!.y).toBe(0);
  });
});
