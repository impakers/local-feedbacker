"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useModalOverlayIsolation } from "../../utils/modal-isolation";
import { originalSetTimeout } from "../../utils/freeze-animations";
import type { DebugWidgetTheme } from "../../core/types";
import styles from "./styles.module.scss";

/**
 * 로컬(zero-backend) 모드에서 지금까지 남긴 제출을 한자리에서 훑어보는 패널.
 *
 * 호스티드의 수신함(InboxPanel)이 아니다 — 상태 전이도 코멘트도 알림도 없다.
 * 이미 쌓여 있던 항목(local-feedback-store 의 LOCAL_ENTRIES)을 나열하고, 원문을
 * 다시 복사하거나 한 건씩 지우는 것이 전부다. FAB 에서 열리므로 마커 좌표가 없어
 * 되짚기 패널(LocalRecap)과 달리 설정 패널처럼 가운데 카드로 띄운다.
 */
export interface FeedbackListEntry {
  id: string;
  label: string;
  timestamp: number;
  /** 캡처 화면이 함께 저장돼 있는지. 실물은 펼칠 때 getEntryScreenshot 으로 읽는다. */
  hasScreenshot?: boolean;
}

export interface FeedbackListProps {
  entries: FeedbackListEntry[];
  getEntryText: (id: string) => string | null;
  /** 펼친 행에 축소판을 띄우기 위해서만 호출된다. 미지정 시 축소판이 없다. */
  getEntryScreenshot?: (id: string) => string | null;
  onRemove: (id: string) => void;
  onClose: () => void;
  /** 패널 서피스 재질. 미지정 시 `"solid"` — 기존 불투명 흰 카드 그대로. */
  theme?: DebugWidgetTheme;
  title?: string;
  emptyLabel?: string;
  copyLabel?: string;
  copiedLabel?: string;
  removeAriaLabel?: string;
  closeAriaLabel?: string;
  /**
   * 주면 "전체 내보내기" 줄이 생긴다. 미지정이면 줄 자체가 없다(= 기존 동작).
   * 결과를 그대로 화면에 옮기므로 `{ok:false}` 로 끝난 이유까지 받아야 한다.
   */
  onExportAll?: () => Promise<{ ok: boolean; message?: string }>;
  /** false 면 버튼 대신 미지원 안내 문구를 보여 준다(받아쓰기 미지원과 같은 방식). */
  exportSupported?: boolean;
  exportLabel?: string;
  exportUnsupportedLabel?: string;
  exportingLabel?: string;
  exportDoneLabel?: string;
  exportRejectedLabel?: string;
}

const COPIED_MS = 1500;
const EXPORT_DONE_MS = 2000;

export function FeedbackList({
  entries,
  getEntryText,
  getEntryScreenshot,
  onRemove,
  onClose,
  theme = "solid",
  title = "피드백 목록",
  emptyLabel = "저장된 피드백이 없습니다",
  copyLabel = "복사",
  copiedLabel = "복사됨",
  removeAriaLabel = "삭제",
  closeAriaLabel = "닫기",
  onExportAll,
  exportSupported = true,
  exportLabel = "내보내기",
  exportUnsupportedLabel = "이 브라우저는 내보내기를 지원하지 않습니다",
  exportingLabel = "내보내는 중…",
  exportDoneLabel = "내보내기 완료",
  exportRejectedLabel = "이 폴더는 선택할 수 없어요 — 다운로드 폴더 안에 새 폴더를 만들어 다시 시도해 보세요",
}: FeedbackListProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [exportStatus, setExportStatus] = useState<"idle" | "exporting" | "done" | "rejected">("idle");
  const resetExportTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => (): void => {
    if (resetTimer.current) clearTimeout(resetTimer.current);
    if (resetExportTimer.current) clearTimeout(resetExportTimer.current);
  }, []);

  const handleCopy = useCallback(async (id: string) => {
    const text = getEntryText(id);
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // 클립보드 거부(권한·비보안 컨텍스트) — 본문은 펼쳐진 채라 직접 고를 수 있다.
      return;
    }
    setCopiedId(id);
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = originalSetTimeout(() => setCopiedId(null), COPIED_MS);
  }, [getEntryText]);

  // 폴더 선택은 브라우저가 거절할 수 있다(Chrome 은 홈·바탕화면 같은 곳을 막는다).
  // 무엇이 일어났는지 여기서 말해 주지 않으면 사용자는 브라우저 대화상자만 보고 끝난다.
  const handleExportAll = useCallback(async () => {
    if (!onExportAll) return;
    setExportStatus("exporting");
    const result = await onExportAll();
    if (result.ok) {
      setExportStatus("done");
      if (resetExportTimer.current) clearTimeout(resetExportTimer.current);
      resetExportTimer.current = originalSetTimeout(() => setExportStatus("idle"), EXPORT_DONE_MS);
    } else if (result.message === "cancelled") {
      setExportStatus("idle"); // 사용자가 스스로 닫았다 — 굳이 알릴 것이 없다.
    } else {
      setExportStatus("rejected"); // 다시 시도할 때까지 남겨 둔다(자동으로 지우지 않는다).
    }
  }, [onExportAll]);

  // 호스트 앱의 Radix(shadcn) 모달이 body에 pointer-events:none을 걸어도
  // 이 패널(별도 body 포털)이 조작 가능하도록 격리한다.
  const isolationRef = useModalOverlayIsolation<HTMLDivElement>();

  if (typeof document === "undefined") return null;

  return createPortal(
    <div ref={isolationRef} data-impakers-debug="">
      <div className={styles.backdrop} onClick={onClose} />
      <div
        className={`${styles.panel} ${theme === "light-glass" ? styles.glass : ""}`}
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

        {/* 목록이 길어지면 아래로 밀려 안 보이므로 머리말 바로 아래에 고정한다. */}
        {onExportAll && (
          <div className={styles.exportRow}>
            {exportSupported ? (
              <>
                {exportStatus === "exporting" && <span className={styles.exportStatus}>{exportingLabel}</span>}
                {exportStatus === "done" && <span className={styles.exportStatus}>{exportDoneLabel}</span>}
                {exportStatus === "rejected" && (
                  <span className={`${styles.exportStatus} ${styles.exportStatusError}`}>{exportRejectedLabel}</span>
                )}
                <button
                  className={styles.exportBtn}
                  type="button"
                  onClick={handleExportAll}
                  disabled={exportStatus === "exporting"}
                >
                  {exportLabel}
                </button>
              </>
            ) : (
              <span className={styles.exportUnsupported}>{exportUnsupportedLabel}</span>
            )}
          </div>
        )}

        <div className={styles.body}>
          {entries.length === 0 ? (
            <div className={styles.empty}>{emptyLabel}</div>
          ) : (
            entries.map((entry) => {
              const expanded = expandedId === entry.id;
              return (
                <div key={entry.id} className={styles.entry}>
                  <div className={styles.row}>
                    <button
                      className={styles.rowMain}
                      type="button"
                      aria-expanded={expanded}
                      onClick={() => setExpandedId(expanded ? null : entry.id)}
                    >
                      <span className={styles.rowLabel}>{entry.label}</span>
                      <span className={styles.rowTime}>{new Date(entry.timestamp).toLocaleString()}</span>
                    </button>
                    {/* 한 건 삭제는 확인을 묻지 않는다 — 되돌릴 것이 한 줄뿐이라
                        전체 삭제(설정 패널)와 달리 확인 비용이 손실보다 크다. */}
                    <button
                      className={styles.removeBtn}
                      type="button"
                      aria-label={removeAriaLabel}
                      title={removeAriaLabel}
                      onClick={() => onRemove(entry.id)}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                      </svg>
                    </button>
                  </div>

                  {expanded && (
                    <div className={styles.detail}>
                      {(() => {
                        const shot = getEntryScreenshot?.(entry.id);
                        return shot ? <img src={shot} className={styles.screenshot} alt="" /> : null;
                      })()}
                      <pre className={styles.text}>{getEntryText(entry.id)}</pre>
                      <div className={styles.actions}>
                        <button
                          className={`${styles.copy} ${copiedId === entry.id ? styles.copied : ""}`}
                          type="button"
                          onClick={() => handleCopy(entry.id)}
                        >
                          {copiedId === entry.id ? copiedLabel : copyLabel}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
