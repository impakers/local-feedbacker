import { beforeEach, describe, expect, it } from "vitest";
import { KEYS, storage } from "./storage";

describe("storage.clearMarkers", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("removes markers from every route, not just the current one", () => {
    // 마커는 라우트별 키로 흩어진다 — 한 화면만 걷으면 나머지가 유령 핀으로 남는다.
    storage.set(KEYS.MARKERS("/"), "[]");
    storage.set(KEYS.MARKERS("/orders"), "[]");
    storage.set(KEYS.MARKERS("/settings/profile"), "[]");

    storage.clearMarkers();

    expect(storage.get(KEYS.MARKERS("/"))).toBeNull();
    expect(storage.get(KEYS.MARKERS("/orders"))).toBeNull();
    expect(storage.get(KEYS.MARKERS("/settings/profile"))).toBeNull();
  });

  it("keeps everything that is not a marker", () => {
    // 마커만 걷는 것이지 설정·로그인까지 날리는 것이 아니다(그건 clearAll 의 몫).
    storage.set(KEYS.MARKERS("/orders"), "[]");
    storage.set(KEYS.SETTINGS, '{"markerColor":"#ff0000"}');
    storage.set(KEYS.USER_DATA, '{"name":"reviewer"}');
    storage.set(KEYS.LOCAL_ENTRIES(), "[]");

    storage.clearMarkers();

    expect(storage.get(KEYS.MARKERS("/orders"))).toBeNull();
    expect(storage.get(KEYS.SETTINGS)).toBe('{"markerColor":"#ff0000"}');
    expect(storage.get(KEYS.USER_DATA)).toBe('{"name":"reviewer"}');
    expect(storage.get(KEYS.LOCAL_ENTRIES())).toBe("[]");
  });

  it("leaves foreign keys alone", () => {
    localStorage.setItem("some-host-app-key", "keep me");
    storage.set(KEYS.MARKERS("/"), "[]");

    storage.clearMarkers();

    expect(localStorage.getItem("some-host-app-key")).toBe("keep me");
  });

  it("is a no-op when there are no markers", () => {
    expect(() => storage.clearMarkers()).not.toThrow();
  });
});
