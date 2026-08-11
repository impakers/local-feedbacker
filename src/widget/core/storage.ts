// localStorage 중앙화 — 모든 키 레지스트리 + SSR 가드 + 에러 처리
const PREFIX = "impakers-debug-" as const;

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
  MARKERS: (route: string): string => `${PREFIX}markers-${route}`,
  /**
   * 로컬 모드에서 제출한 프롬프트 원문. 마커(MARKERS)와 달리 **라우트별이 아니다** —
   * 리뷰어가 사이트 여러 화면을 돌며 남긴 것을 한 번에 복사해야 하기 때문에
   * origin 하나에 목록 하나로 둔다.
   */
  LOCAL_ENTRIES: `${PREFIX}local-entries`,
  OPERATOR_LAST_SEEN: (url: string): string => `${PREFIX}operator-last-seen:${url}`,
} as const;

export const storage = {
  get: safeGet,
  set: safeSet,
  trySet,
  remove: safeRemove,
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
