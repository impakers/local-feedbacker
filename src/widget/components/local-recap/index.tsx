"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { originalSetTimeout } from "../../utils/freeze-animations";
import styles from "./styles.module.scss";

/**
 * 로컬(zero-backend) 모드에서 이미 제출한 마커를 다시 눌렀을 때 뜨는 되짚기 패널.
 *
 * 코멘트 스레드(`CommentThread`)의 자리를 대신하지만 스레드가 아니다 — 로컬 모드에는
 * 주고받을 코멘트가 없다. 뭐라고 남겼는지 다시 보고, 다시 복사하는 것이 전부다.
 * 위치 계산은 스레드와 같은 값(left/top/bottom)을 그대로 받는다.
 */
export interface LocalRecapProps {
  /** 이 마커로 제출했던 프롬프트 원문. */
  text: string;
  left: number;
  top?: number;
  bottom?: number;
  /** 복사 버튼 라벨. 미지정 시 기본 문구. */
  copyLabel?: string;
  /** 패널 제목. 미지정 시 기존 한국어 문구. */
  title?: string;
  /** 닫기 버튼의 aria-label. 미지정 시 기존 한국어 문구. */
  closeAriaLabel?: string;
  /** 복사 직후 잠깐 뜨는 문구. 미지정 시 기존 한국어 문구. */
  copiedLabel?: string;
  /** 제출 시 캡처된 화면(dataURL). 있으면 원문 위에 축소판으로 띄운다. */
  screenshot?: string | null;
  /** 주면 삭제 버튼이 생긴다. 미지정이면 버튼 자체가 없다(= 기존 동작). */
  onDelete?: () => void;
  /** 삭제 버튼의 aria-label. 미지정 시 기존 한국어 문구. */
  deleteAriaLabel?: string;
  onClose: () => void;
}

const COPIED_MS = 1500;

export function LocalRecap({
  text,
  left,
  top,
  bottom,
  copyLabel,
  title = "남긴 피드백",
  closeAriaLabel = "닫기",
  copiedLabel = "복사됨",
  screenshot,
  onDelete,
  deleteAriaLabel = "삭제",
  onClose,
}: LocalRecapProps) {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => (): void => {
    if (resetTimer.current) clearTimeout(resetTimer.current);
  }, []);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // 클립보드 거부(권한·비보안 컨텍스트) — 본문은 화면에 그대로 있으니 직접 고를 수 있다.
      return;
    }
    setCopied(true);
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = originalSetTimeout(() => setCopied(false), COPIED_MS);
  }, [text]);

  return (
    <div
      className={styles.recap}
      data-impakers-debug=""
      style={{ left, ...(top !== undefined ? { top } : {}), ...(bottom !== undefined ? { bottom } : {}) }}
    >
      <div className={styles.header}>
        <span className={styles.title}>{title}</span>
        <button type="button" className={styles.close} onClick={onClose} aria-label={closeAriaLabel}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {screenshot && <img src={screenshot} className={styles.screenshot} alt="" />}

      <pre className={styles.text}>{text}</pre>

      <div className={styles.actions}>
        {/* 한 건 삭제는 확인을 묻지 않는다 — 목록의 행 삭제와 같은 기준.
            확인을 붙이는 것은 한꺼번에 다 지우는 설정 패널 쪽뿐이다. */}
        {onDelete && (
          <button
            type="button"
            className={styles.delete}
            onClick={onDelete}
            aria-label={deleteAriaLabel}
            title={deleteAriaLabel}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
            </svg>
          </button>
        )}
        <button
          type="button"
          className={`${styles.copy} ${copied ? styles.copied : ""}`}
          onClick={handleCopy}
        >
          {copied ? copiedLabel : copyLabel || "다시 복사"}
        </button>
      </div>
    </div>
  );
}
