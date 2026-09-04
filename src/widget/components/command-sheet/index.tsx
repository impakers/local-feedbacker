"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useModalOverlayIsolation } from "../../utils/modal-isolation";
import type { DebugWidgetTheme } from "../../core/types";
import type { ShortcutKey, WidgetActionGroup, WidgetActionId } from "../../core/shortcuts";
import styles from "./styles.module.scss";

/**
 * 위젯이 할 수 있는 모든 일을 키와 함께 한자리에 늘어놓은 시트.
 *
 * 설정 패널 안에 접혀 있던 "단축키 안내"를 대신한다. 그 목록은 읽기만 됐지만
 * 이 시트는 **실행된다** — 화살표로 고르고 Enter, 또는 행에 적힌 글자를 그대로
 * 누르면 된다. 글자 하나짜리 키는 이 시트가 떠 있는 동안에도 부모(debug-widget)의
 * 전역 리스너가 듣는다. 여기서는 화살표·Enter 만 맡아 이중 처리를 피한다.
 *
 * 검색창을 두지 않은 이유: 항목이 열몇 개라 한 화면에 다 들어가고, 입력창이
 * 포커스를 잡으면 글자 키가 실행이 아니라 타이핑이 되어 세 패널(설정·목록·시트)의
 * 키 동작이 서로 달라진다.
 */
export interface CommandSheetAction {
  id: WidgetActionId;
  group: WidgetActionGroup;
  label: string;
  /** 전역 코드의 키 캡. 없으면 패널 안에서만 되는 동작이다. */
  chord: ShortcutKey[] | null;
  /** 패널 키의 키 캡. */
  key: ShortcutKey[] | null;
  /** 지금은 할 수 없는 동작(예: 지울 피드백이 없음). 보이되 흐리게. */
  disabled?: boolean;
  destructive?: boolean;
}

export interface CommandSheetProps {
  title: string;
  groupLabels: Record<WidgetActionGroup, string>;
  actions: CommandSheetAction[];
  /** 행을 고르거나 Enter 를 눌렀을 때. 확인이 필요한 동작의 2단계도 부모가 관리한다. */
  onRun: (id: WidgetActionId) => void;
  onClose: () => void;
  /** 확인 대기 중인 파괴적 동작. 그 행이 붉게 바뀌고 `confirmLabel` 이 대신 보인다. */
  armedId?: WidgetActionId | null;
  confirmLabel?: string;
  closeAriaLabel?: string;
  theme?: DebugWidgetTheme;
}

const GROUP_ORDER: readonly WidgetActionGroup[] = ["feedback", "panels", "markers", "widget"];

function Caps({ keys }: { keys: ShortcutKey[] }) {
  return (
    <span className={styles.caps}>
      {keys.map((key, i) => (
        <span key={`${key.label}-${i}`} className={styles.capGroup}>
          {i > 0 && <span className={styles.capSep}>+</span>}
          <kbd className={styles.cap}>
            {key.label}
            {key.icon && <span className={styles.capIcon}>{key.icon}</span>}
          </kbd>
        </span>
      ))}
    </span>
  );
}

export function CommandSheet({
  title,
  groupLabels,
  actions,
  onRun,
  onClose,
  armedId = null,
  confirmLabel,
  closeAriaLabel = "닫기",
  theme = "solid",
}: CommandSheetProps) {
  const isolationRef = useModalOverlayIsolation<HTMLDivElement>();

  // 화살표로 옮겨 다니는 하이라이트. 실행 가능한 행만 센다. 행이 줄어(지울 것이
  // 없어져 삭제 행이 비활성) 커서가 밖으로 나가면 마지막 행으로 당긴다.
  const runnable = useMemo(() => actions.filter((action) => !action.disabled), [actions]);
  const [rawCursor, setCursor] = useState(0);
  const cursor = Math.min(rawCursor, Math.max(0, runnable.length - 1));

  // 포커스는 옮기지 않는다. focusin 이 나면 호스트의 Radix DismissableLayer 가
  // "바깥 이탈"로 보고 자기 팝오버를 닫는다 — 이 위젯이 모달 안에서도 살아 있는
  // 이유가 그 규칙이다. 그래서 화살표·Enter 도 window capture 에서 듣는다.
  const latest = useRef({ cursor, runnable, onRun });
  useEffect(() => { latest.current = { cursor, runnable, onRun }; });
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // 부모 디스패처가 먼저 먹은 키(확인 대기 중의 Enter 등)는 건드리지 않는다.
      if (e.defaultPrevented) return;
      const target = e.composedPath()[0] ?? e.target;
      if (target instanceof HTMLElement && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) return;
      const { cursor: at, runnable: rows, onRun: run } = latest.current;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        const delta = e.key === "ArrowDown" ? 1 : -1;
        setCursor((rows.length ? (at + delta + rows.length) % rows.length : 0));
        return;
      }
      if (e.key === "Enter" && rows[at]) {
        e.preventDefault();
        e.stopPropagation();
        run(rows[at].id);
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, []);

  if (typeof document === "undefined") return null;

  const grouped = GROUP_ORDER
    .map((group) => ({ group, items: actions.filter((action) => action.group === group) }))
    .filter(({ items }) => items.length > 0);

  return createPortal(
    <div ref={isolationRef} data-impakers-debug="">
      <div className={styles.backdrop} onClick={onClose} />
      <div
        className={`${styles.sheet} ${theme === "light-glass" ? styles.glass : ""}`}
        role="dialog"
        aria-label={title}
        data-impakers-debug=""
      >
        <div className={styles.header}>
          <span className={styles.title}>{title}</span>
          <button className={styles.closeBtn} onClick={onClose} type="button" aria-label={closeAriaLabel}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className={styles.list}>
          {grouped.map(({ group, items }) => (
            <div key={group} className={styles.group}>
              <div className={styles.groupLabel}>{groupLabels[group]}</div>
              {items.map((action) => {
                const highlighted = runnable[cursor]?.id === action.id;
                const armed = armedId === action.id;
                return (
                  <button
                    key={action.id}
                    type="button"
                    className={[
                      styles.row,
                      highlighted ? styles.highlighted : "",
                      action.destructive ? styles.destructive : "",
                      armed ? styles.armed : "",
                    ].join(" ")}
                    disabled={action.disabled}
                    onClick={() => onRun(action.id)}
                    onMouseEnter={() => {
                      const at = runnable.findIndex((candidate) => candidate.id === action.id);
                      if (at !== -1) setCursor(at);
                    }}
                  >
                    <span className={styles.rowLabel}>{armed && confirmLabel ? confirmLabel : action.label}</span>
                    {!armed && (
                      <span className={styles.rowKeys}>
                        {action.chord && <Caps keys={action.chord} />}
                        {action.key && <Caps keys={action.key} />}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
