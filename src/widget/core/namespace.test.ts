import { beforeEach, describe, expect, it } from "vitest";
import { KEYS, setStorageNamespace, storage } from "./storage";

// 같은 origin 을 나눠 쓰는 두 앱을 흉내 낸다. localStorage 는 origin 단위라
// 실제로 이 상황에서 저장소가 통째로 겹친다 — 이 파일이 지키려는 것이 그 경계다.
function asApp(name: string | null, run: () => void): void {
  setStorageNamespace(name);
  run();
}

describe("storage namespace", () => {
  beforeEach(() => {
    localStorage.clear();
    setStorageNamespace(null);
  });

  it("keeps two apps on one origin from seeing each other's entries", () => {
    asApp("shop", () => storage.set(KEYS.LOCAL_ENTRIES(), '["shop feedback"]'));
    asApp("admin", () => storage.set(KEYS.LOCAL_ENTRIES(), '["admin feedback"]'));

    asApp("shop", () => expect(storage.get(KEYS.LOCAL_ENTRIES())).toBe('["shop feedback"]'));
    asApp("admin", () => expect(storage.get(KEYS.LOCAL_ENTRIES())).toBe('["admin feedback"]'));
  });

  it("keeps markers on the same route apart", () => {
    // 두 앱 모두 "/" 를 갖는다 — 라우트만으로는 절대 갈리지 않는 지점.
    asApp("shop", () => storage.set(KEYS.MARKERS("/"), '["shop pin"]'));
    asApp("admin", () => storage.set(KEYS.MARKERS("/"), '["admin pin"]'));

    asApp("shop", () => expect(storage.get(KEYS.MARKERS("/"))).toBe('["shop pin"]'));
    asApp("admin", () => expect(storage.get(KEYS.MARKERS("/"))).toBe('["admin pin"]'));
  });

  it("does not let one app clear another app's markers", () => {
    asApp("shop", () => storage.set(KEYS.MARKERS("/orders"), '["shop pin"]'));
    asApp("admin", () => storage.set(KEYS.MARKERS("/orders"), '["admin pin"]'));

    asApp("admin", () => storage.clearMarkers());

    asApp("shop", () => expect(storage.get(KEYS.MARKERS("/orders"))).toBe('["shop pin"]'));
    asApp("admin", () => expect(storage.get(KEYS.MARKERS("/orders"))).toBeNull());
  });

  it("still shares settings — those are the reviewer's, not the app's", () => {
    asApp("shop", () => storage.set(KEYS.SETTINGS, '{"markerColor":"#ff0000"}'));
    asApp("admin", () => expect(storage.get(KEYS.SETTINGS)).toBe('{"markerColor":"#ff0000"}'));
  });

  it("hands pre-existing feedback to the first app that names itself", () => {
    // 이름을 달기 전(예전 버전)에 쌓아 둔 것. 업그레이드했다고 사라지면 안 된다.
    asApp(null, () => {
      storage.set(KEYS.LOCAL_ENTRIES(), '["from before"]');
      storage.set(KEYS.MARKERS("/"), '["old pin"]');
    });

    asApp("shop", () => {
      expect(storage.get(KEYS.LOCAL_ENTRIES())).toBe('["from before"]');
      expect(storage.get(KEYS.MARKERS("/"))).toBe('["old pin"]');
    });

    // 넘겨받은 뒤에는 예전 키가 남지 않는다 — 두 번째 앱이 같은 것을 또 집어가면
    // 방금 없앤 "섞임"이 그대로 되살아난다.
    expect(localStorage.getItem("impakers-debug-local-entries")).toBeNull();
    asApp("admin", () => expect(storage.get(KEYS.LOCAL_ENTRIES())).toBeNull());
  });

  it("never overwrites what an app already has", () => {
    asApp("shop", () => storage.set(KEYS.LOCAL_ENTRIES(), '["mine"]'));
    // 다른 경로로 꼬리표 없는 값이 생겨도 이미 있는 것을 밀어내지 않는다.
    localStorage.setItem("impakers-debug-local-entries", '["stray"]');

    asApp("shop", () => expect(storage.get(KEYS.LOCAL_ENTRIES())).toBe('["mine"]'));
  });

  it("leaves the unnamed app working exactly as before", () => {
    asApp(null, () => {
      storage.set(KEYS.LOCAL_ENTRIES(), '["solo"]');
      expect(KEYS.LOCAL_ENTRIES()).toBe("impakers-debug-local-entries");
      expect(storage.get(KEYS.LOCAL_ENTRIES())).toBe('["solo"]');
    });
  });

  it("treats whitespace-only names as no name at all", () => {
    asApp("   ", () => expect(KEYS.LOCAL_ENTRIES()).toBe("impakers-debug-local-entries"));
  });
});
