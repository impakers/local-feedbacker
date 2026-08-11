// =============================================================================
// 위젯 키보드 단축키
// =============================================================================
//
// 모달/Popover 안에서는 FAB 클릭이 호스트의 dismiss 로 먹혀 피드백 모드에 아예
// 진입할 수 없다. 그래서 마우스 없이 진입할 수 있는 단축키가 필요하다.
//
//   Ctrl/Cmd + Shift + .   위젯 표시/숨김   (react.tsx)
//   Ctrl/Cmd + Shift + ,   피드백 모드      (debug-widget)
//
// 같은 키 페어(. ,)라 외우기 쉽고, 두 조합 모두 Chrome/Edge/Safari/Firefox 의
// Windows·macOS 기본 단축키에 할당돼 있지 않다. (Ctrl+Shift+A/B/M/N/R/S/T 류,
// Alt+F, Cmd+Shift+/ 등은 브라우저가 선점하고 있어 피했다)

/**
 * 피드백(요소 선택) 모드 토글 단축키인지 판정한다.
 *
 * - Windows 는 Ctrl, macOS 는 Cmd/Ctrl 을 모두 허용한다.
 * - `code` 를 함께 보는 이유: 한글 IME 가 켜져 있으면 일부 브라우저가 `key` 를
 *   "Process" 로 넘긴다. 물리 키 기준인 `code` 가 있어야 한글 상태에서도 동작.
 * - `<` 는 US 배열에서 Shift+, 의 문자 표현.
 * - **입력창 포커스 중에도 통과시킨다.** 필터 Popover 는 검색 input 이 autofocus
 *   되는 경우가 많고, 수식어 조합이라 글자가 입력될 위험이 없다.
 *   (위젯 표시/숨김 단축키는 기존대로 입력창에서 무시된다 — react.tsx)
 */
export function isFeedbackModeShortcut(event: KeyboardEvent): boolean {
  if (!(event.ctrlKey || event.metaKey)) return false;
  if (!event.shiftKey) return false;
  if (event.altKey) return false;

  return event.code === "Comma" || event.key === "," || event.key === "<";
}

/**
 * 위젯 표시/숨김 토글 단축키인지 판정한다.
 *
 * 판정 규칙은 피드백 모드와 같고 키만 `.` 이다. 다만 **입력창 포커스 여부는 여기서
 * 보지 않는다** — 무시 정책은 호출부(oss/react.tsx)가 정한다. 편집 도중 위젯 전체가
 * 사라지는 사고를 막기 위해 그쪽에서 입력창 포커스 중에는 이 판정을 건너뛴다.
 */
export function isVisibilityToggleShortcut(event: KeyboardEvent): boolean {
  if (!(event.ctrlKey || event.metaKey)) return false;
  if (!event.shiftKey) return false;
  if (event.altKey) return false;

  return event.code === "Period" || event.key === "." || event.key === ">";
}

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

/**
 * 설정 패널의 "단축키 안내"에 표시할 목록.
 *
 * 표기는 실제 구현과 반드시 일치해야 한다. 두 조합 모두 ctrlKey 로 동작하므로
 * (피드백 모드는 macOS 에서 ⌘ 도 함께 받는다) 플랫폼 분기 없이 Ctrl 로 안내한다.
 */
export const SHORTCUT_HINTS: ShortcutHint[] = [
  {
    keys: [CTRL, SHIFT, { label: ",(쉼표)" }],
    label: "피드백 모드 켜기/끄기",
  },
  {
    keys: [CTRL, SHIFT, { label: ".(점)" }],
    label: "위젯 표시/숨김",
  },
  {
    keys: [{ label: "Esc", icon: "⎋" }],
    label: "입력창 닫기 → 피드백 모드 해제",
  },
];
