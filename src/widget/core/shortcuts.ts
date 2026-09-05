// =============================================================================
// 위젯 키보드 단축키
// =============================================================================
//
// 모달/Popover 안에서는 FAB 클릭이 호스트의 dismiss 로 먹혀 피드백 모드에 아예
// 진입할 수 없다. 그래서 마우스 없이 진입할 수 있는 단축키가 필요하다.
//
// 두 층으로 나뉜다.
//
// **전역 코드** — Ctrl/Cmd + Shift + 구두점. 페이지 어디서나, 입력창 안에서도 듣는다.
//
//   Ctrl/Cmd + Shift + ,   피드백 모드           (debug-widget)
//   Ctrl/Cmd + Shift + .   위젯 표시/숨김        (react.tsx)
//   Ctrl/Cmd + Shift + ;   피드백 목록
//   Ctrl/Cmd + Shift + '   설정
//   Ctrl/Cmd + Shift + \   모든 단축키
//
//   구두점만 쓰는 이유: Ctrl+Shift+글자는 대부분 브라우저가 선점하고 있다
//   (A/B/C/D/G/H/I/J/K/M/N/O/P/R/S/T/W… 가 Chrome·Edge·Safari·Firefox 중 어딘가에
//   할당돼 있다). 위 다섯 구두점은 Windows·macOS 네 브라우저 모두에서 비어 있다.
//   `[` `]` `` ` `` `/` `-` `=` 는 탭 전환·창 순환·도움말·확대에 걸려 있어 피했다.
//
// **패널 키** — 수식어 없는 글자 하나. 위젯의 패널(설정·목록·단축키 시트)이 떠 있고
//   포커스가 입력창 밖일 때만 듣는다. 호스트 앱의 글자 입력을 가로채지 않기 위한
//   범위 제한이지, 기능 제한이 아니다 — 모든 기능이 여기 하나씩 달려 있다.

export type WidgetActionId =
  | "feedback-mode"
  | "toggle-widget"
  | "feedback-list"
  | "settings"
  | "shortcuts"
  | "copy-all"
  | "export-all"
  | "clear-all"
  | "toggle-markers"
  | "toggle-hide-done"
  | "toggle-capture"
  | "marker-color"
  | "close";

export type WidgetActionGroup = "panels" | "feedback" | "markers" | "widget";

export interface WidgetAction {
  id: WidgetActionId;
  group: WidgetActionGroup;
  /**
   * Ctrl/Cmd + Shift + 이 물리 키. 페이지 어디서나 듣는다.
   *
   * `code` 와 `keys` 를 둘 다 두는 이유: 한글 IME 가 켜져 있으면 일부 브라우저가
   * `key` 를 "Process" 로 넘긴다. 물리 키 기준인 `code` 가 있어야 한글 상태에서도
   * 동작하고, `keys` 는 US 배열에서 Shift 가 얹힌 문자 표현(`<` `>` 등)까지 받는다.
   */
  chord?: { code: string; keys: readonly string[]; label: string };
  /** 패널이 떠 있을 때 듣는 단일 키. `keys` 는 `event.key` 후보. */
  key?: { keys: readonly string[]; label: string };
  /** 실행 전에 한 번 더 확인받는다. */
  destructive?: boolean;
  /** 로컬(zero-backend) 모드에만 있는 기능. */
  local?: boolean;
}

const DIGIT_KEYS = ["1", "2", "3", "4", "5", "6"] as const;

/**
 * 위젯의 모든 동작. 순서가 곧 단축키 시트의 표시 순서다.
 *
 * `chord` 가 있는 다섯 개만 전역이고, 나머지는 패널 안에서 글자 하나로 실행한다.
 * "닫기"는 Esc 로 모든 패널에 공통이라 여기서는 표기만 맡는다 — 실제 처리는
 * 각 패널이 자기 keydown 에서 한다(호스트 모달의 Esc 와 순서를 맞추기 위해).
 */
export const WIDGET_ACTIONS: readonly WidgetAction[] = [
  { id: "feedback-mode", group: "feedback", chord: { code: "Comma", keys: [",", "<"], label: "," }, key: { keys: ["f"], label: "F" } },
  { id: "copy-all", group: "feedback", key: { keys: ["c"], label: "C" }, local: true },
  { id: "export-all", group: "feedback", key: { keys: ["e"], label: "E" }, local: true },
  { id: "toggle-capture", group: "feedback", key: { keys: ["p"], label: "P" } },
  { id: "clear-all", group: "feedback", key: { keys: ["Backspace", "Delete"], label: "⌫" }, destructive: true, local: true },
  { id: "feedback-list", group: "panels", chord: { code: "Semicolon", keys: [";", ":"], label: ";" }, key: { keys: ["l"], label: "L" }, local: true },
  { id: "settings", group: "panels", chord: { code: "Quote", keys: ["'", '"'], label: "'" }, key: { keys: ["s"], label: "S" } },
  { id: "shortcuts", group: "panels", chord: { code: "Backslash", keys: ["\\", "|"], label: "\\" }, key: { keys: ["?"], label: "?" } },
  { id: "close", group: "panels", key: { keys: ["Escape"], label: "Esc" } },
  { id: "toggle-markers", group: "markers", key: { keys: ["m"], label: "M" } },
  { id: "toggle-hide-done", group: "markers", key: { keys: ["d"], label: "D" } },
  { id: "marker-color", group: "markers", key: { keys: DIGIT_KEYS, label: "1–6" } },
  // 표시/숨김 하나로 충분하다: 패널이 떠 있다는 것은 위젯이 보인다는 뜻이라 H 는 늘 "숨김"이다.
  { id: "toggle-widget", group: "widget", chord: { code: "Period", keys: [".", ">"], label: "." }, key: { keys: ["h"], label: "H" } },
];

const ACTIONS_BY_ID = new Map(WIDGET_ACTIONS.map((action) => [action.id, action]));

export function getWidgetAction(id: WidgetActionId): WidgetAction {
  return ACTIONS_BY_ID.get(id)!;
}

function hasChordModifiers(event: KeyboardEvent): boolean {
  // Windows 는 Ctrl, macOS 는 Cmd/Ctrl 을 모두 허용한다.
  return (event.ctrlKey || event.metaKey) && event.shiftKey && !event.altKey;
}

/** 전역 코드에 해당하는 동작. 없으면 null. */
export function matchGlobalChord(event: KeyboardEvent): WidgetActionId | null {
  if (!hasChordModifiers(event)) return null;
  for (const action of WIDGET_ACTIONS) {
    if (!action.chord) continue;
    if (event.code === action.chord.code || action.chord.keys.includes(event.key)) return action.id;
  }
  return null;
}

export interface PanelKeyMatch {
  id: WidgetActionId;
  /** `marker-color` 에서 눌린 숫자(0 기준). */
  index?: number;
}

/**
 * 패널 키에 해당하는 동작. 수식어가 하나라도 눌려 있으면 null 이다 —
 * 호스트의 Ctrl+C 같은 조합과 우리 `c` 가 섞이면 안 된다.
 *
 * `?` 만 예외로 Shift 를 허용한다. US 배열에서 `?` 자체가 Shift+/ 이기 때문이다.
 */
export function matchPanelKey(event: KeyboardEvent): PanelKeyMatch | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  if (event.shiftKey && event.key !== "?") return null;

  const digit = (DIGIT_KEYS as readonly string[]).indexOf(event.key);
  if (digit !== -1) return { id: "marker-color", index: digit };

  const pressed = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  for (const action of WIDGET_ACTIONS) {
    if (action.key?.keys.includes(pressed)) return { id: action.id };
  }
  return null;
}

/**
 * 글자를 받는 요소에 포커스가 있는지. 패널 키는 여기서는 절대 듣지 않는다 —
 * 설정 패널의 언어 select 나 호스트 앱의 검색창에 `s` 를 치는데 설정이
 * 열려서는 안 된다.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  // `=== true`: jsdom leaves isContentEditable undefined, and a caller comparing
  // against false must not be told "undefined".
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable === true;
}

/**
 * 피드백(요소 선택) 모드 토글 단축키인지 판정한다.
 *
 * **입력창 포커스 중에도 통과시킨다.** 필터 Popover 는 검색 input 이 autofocus
 * 되는 경우가 많고, 수식어 조합이라 글자가 입력될 위험이 없다.
 * (위젯 표시/숨김 단축키는 기존대로 입력창에서 무시된다 — react.tsx)
 */
export function isFeedbackModeShortcut(event: KeyboardEvent): boolean {
  return matchGlobalChord(event) === "feedback-mode";
}

/**
 * 위젯 표시/숨김 토글 단축키인지 판정한다.
 *
 * **입력창 포커스 여부는 여기서 보지 않는다** — 무시 정책은 호출부(react.tsx)가
 * 정한다. 편집 도중 위젯 전체가 사라지는 사고를 막기 위해 그쪽에서 입력창
 * 포커스 중에는 이 판정을 건너뛴다.
 */
export function isVisibilityToggleShortcut(event: KeyboardEvent): boolean {
  return matchGlobalChord(event) === "toggle-widget";
}

// -----------------------------------------------------------------------------
// 표기
// -----------------------------------------------------------------------------

/** 키 캡 하나. icon 은 macOS 기호 표기(⌃ ⇧ ⎋). */
export interface ShortcutKey {
  label: string;
  icon?: string;
}

export interface ShortcutHint {
  /** `+` 로 이어 표시할 키 캡들 */
  keys: ShortcutKey[];
  label: string;
}

const CTRL: ShortcutKey = { label: "Ctrl", icon: "⌃" };
const SHIFT: ShortcutKey = { label: "Shift", icon: "⇧" };

/** 전역 코드의 키 캡. 두 조합 모두 ctrlKey 로 동작하므로 플랫폼 분기 없이 Ctrl 로 안내한다. */
export function chordCaps(action: WidgetAction): ShortcutKey[] | null {
  return action.chord ? [CTRL, SHIFT, { label: action.chord.label }] : null;
}

/** 패널 키의 키 캡. */
export function panelKeyCaps(action: WidgetAction): ShortcutKey[] | null {
  if (!action.key) return null;
  return [{ label: action.key.label, ...(action.id === "close" ? { icon: "⎋" } : {}) }];
}

/**
 * 툴팁·설정 행에 붙일 한 줄 표기. 전역 코드가 있으면 그것을, 없으면 패널 키를 쓴다 —
 * 어디서나 되는 쪽이 더 유용한 정보다.
 */
export function shortcutBadge(id: WidgetActionId): string {
  const action = getWidgetAction(id);
  if (action.chord) return `⌃⇧${action.chord.label}`;
  return action.key?.label ?? "";
}

/** 호스티드(라벨 오버라이드가 없는) 호출부를 위한 한국어 기본 문구. */
export const DEFAULT_ACTION_LABELS: Record<WidgetActionId, string> = {
  "feedback-mode": "피드백 모드 켜기/끄기",
  "toggle-widget": "위젯 표시/숨김",
  "feedback-list": "피드백 목록",
  settings: "설정",
  shortcuts: "모든 단축키",
  "copy-all": "전체 복사",
  "export-all": "전체 내보내기",
  "clear-all": "전체 피드백 삭제",
  "toggle-markers": "마커 표시",
  "toggle-hide-done": "완료 핀 숨기기",
  "toggle-capture": "스크린샷 캡처",
  "marker-color": "마커 색상",
  close: "입력창 닫기 → 피드백 모드 해제",
};

/**
 * 설정 패널의 "단축키 안내"에 표시할 목록(호스티드 기본값).
 *
 * 표기는 실제 구현과 반드시 일치해야 하므로 레지스트리에서 뽑는다.
 * 로컬 전용 동작은 호스티드 패널에 보이면 안 되므로 뺀다.
 */
export const SHORTCUT_HINTS: ShortcutHint[] = WIDGET_ACTIONS
  .filter((action) => !action.local && (action.chord || action.id === "close"))
  .map((action) => ({
    keys: chordCaps(action) ?? panelKeyCaps(action)!,
    label: DEFAULT_ACTION_LABELS[action.id],
  }));
