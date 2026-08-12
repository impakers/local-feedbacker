// localStorage 중앙화 — 모든 키 레지스트리 + SSR 가드 + 에러 처리
const PREFIX = "impakers-debug-" as const;

/**
 * 앱 구분자.
 *
 * 같은 origin 을 여러 앱이 나눠 쓰면 저장소가 그대로 겹쳐 피드백이 섞인다.
 * 흔한 경우가 둘 있다 — 로컬 개발에서 프로젝트마다 `localhost:3000` 을 돌려쓰는
 * 것, 그리고 한 도메인 아래 여러 앱을 경로로 나눠 붙이는 것.
 *
 * **origin 을 키에 넣는 것으로는 해결되지 않는다.** localStorage 자체가 이미
 * origin 단위라 위 두 경우 모두 origin 이 같다. 앱이 스스로 이름을 대야 갈린다.
 */
let namespace = "";

/** 갈라야 하는 키에만 붙는 꼬리표. 값이 비면 예전과 같은 키를 쓴다. */
const SCOPE_SEP = "@@";

/** 앱별로 갈라야 하는 키인지(= 꼬리표가 붙는 키인지) 판별한다. */
function inScope(key: string): boolean {
  const at = key.indexOf(SCOPE_SEP);
  return namespace ? key.slice(at + SCOPE_SEP.length) === namespace : at === -1;
}

function scope(key: string): string {
  return namespace ? `${key}${SCOPE_SEP}${namespace}` : key;
}

function safeGet(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, value);
  } catch {
    // localStorage 불가 (private mode, storage full 등)
  }
}

/**
 * `safeSet` 과 같지만 성공 여부를 돌려준다. 대부분의 호출부는 저장 실패를 알아도
 * 할 일이 없어 `set` 으로 충분하지만, 용량 초과(QuotaExceededError) 때 값을 줄여
 * 다시 시도해야 하는 곳(로컬 항목 + 스크린샷)은 실패를 볼 수 있어야 한다.
 */
function trySet(key: string, value: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function safeRemove(key: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

export const KEYS = {
  LEGACY_TOKEN: `${PREFIX}token`,
  LEGACY_TOKEN_DATA: `${PREFIX}token-data`,
  USER_DATA: `${PREFIX}user-data`,
  SETTINGS: `${PREFIX}settings`,
  /** 사용자가 직접 토글한 표시 여부. "1"=숨김 / "0"=표시 / 키 없음=선택 안 함(=OS 정책 따름) */
  HIDDEN: `${PREFIX}hidden`,
  /** 도메인별 기본 표시 정책 캐시 (OS config 응답) */
  VISIBILITY_CONFIG: (domain: string): string => `${PREFIX}visibility-config:${domain}`,
  TASK_SEEN: `${PREFIX}task-seen`,
  HISTORY_LAST_SEEN: `${PREFIX}history-last-seen`,
  MARKERS: (route: string): string => scope(`${PREFIX}markers-${route}`),
  /**
   * 로컬 모드에서 제출한 프롬프트 원문. 마커(MARKERS)와 달리 **라우트별이 아니다** —
   * 리뷰어가 한 앱의 여러 화면을 돌며 남긴 것을 한 번에 복사해야 하기 때문에
   * 앱 하나에 목록 하나로 둔다(`setStorageNamespace` 로 앱을 가른다).
   */
  LOCAL_ENTRIES: (): string => scope(`${PREFIX}local-entries`),
  OPERATOR_LAST_SEEN: (url: string): string => `${PREFIX}operator-last-seen:${url}`,
} as const;

/** 꼬리표가 붙는(=앱별로 갈리는) 키인지. 설정·언어처럼 공유해도 무해한 것은 제외한다. */
function isScopedKey(key: string): boolean {
  return key.startsWith(`${PREFIX}markers-`) || key.startsWith(`${PREFIX}local-entries`);
}

/**
 * 이 앱의 저장소 구분자를 정한다. **어떤 읽기보다도 먼저** 불려야 한다.
 *
 * 처음 이름을 다는 앱은 예전(꼬리표 없는) 데이터를 자기 것으로 넘겨받는다 —
 * 업그레이드했다고 남겨둔 피드백이 사라지면 안 되기 때문이다. 넘겨받은 뒤
 * 예전 키는 지우므로, 이미 섞여 있던 origin 에서는 **먼저 연 앱이 가져간다**.
 * 그 뒤로는 앱마다 완전히 갈린다.
 */
export function setStorageNamespace(value: string | null | undefined): void {
  namespace = (value ?? "").trim();
  if (!namespace || typeof window === "undefined") return;

  try {
    const legacy: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      // 꼬리표가 없는 = 아직 갈리기 전에 쌓인 키
      if (key && isScopedKey(key) && !key.includes(SCOPE_SEP)) legacy.push(key);
    }

    for (const key of legacy) {
      const scoped = scope(key);
      const value = localStorage.getItem(key);
      // 이 앱이 이미 자기 것을 갖고 있으면 덮어쓰지 않는다.
      if (value !== null && localStorage.getItem(scoped) === null) {
        localStorage.setItem(scoped, value);
      }
      localStorage.removeItem(key);
    }
  } catch {
    // 저장소를 못 쓰면 이름만 세워두고 넘어간다.
  }
}

export const storage = {
  get: safeGet,
  set: safeSet,
  trySet,
  remove: safeRemove,
  /**
   * 모든 라우트의 마커를 지운다.
   *
   * 마커는 라우트별 키(MARKERS)로 흩어져 있고 제출 원문(LOCAL_ENTRIES)은 origin 당
   * 하나다. 원문만 비우면 리뷰어가 돌아다닌 화면마다 눌러도 아무 일이 없는 유령
   * 핀이 남으므로, 원문을 통째로 버릴 때는 흩어진 마커도 함께 걷어야 한다.
   */
  clearMarkers(): void {
    if (typeof window === "undefined") return;
    try {
      const markerPrefix = `${PREFIX}markers-`;
      const toRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        // 같은 origin 을 쓰는 **다른 앱**의 마커까지 걷어내면 안 된다.
        if (key?.startsWith(markerPrefix) && inScope(key)) toRemove.push(key);
      }
      toRemove.forEach((key) => localStorage.removeItem(key));
    } catch {
      // ignore
    }
  },
  clearAll(): void {
    if (typeof window === "undefined") return;
    try {
      const toRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(PREFIX)) toRemove.push(key);
      }
      toRemove.forEach((key) => localStorage.removeItem(key));
    } catch {
      // ignore
    }
  },
} as const;
