"use client";

import { useState, useRef, useCallback } from "react";
import { captureElement } from "../../utils/capture-element";
import styles from "./styles.module.scss";

// =============================================================================
// Helpers
// =============================================================================

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function getFileIcon(mimeType: string): string {
  if (mimeType.includes("pdf")) return "PDF";
  if (mimeType.includes("spreadsheet") || mimeType.includes("excel") || mimeType.includes("csv")) return "XLS";
  if (mimeType.includes("presentation") || mimeType.includes("powerpoint")) return "PPT";
  if (mimeType.includes("document") || mimeType.includes("word")) return "DOC";
  if (mimeType.includes("zip") || mimeType.includes("compressed") || mimeType.includes("archive")) return "ZIP";
  if (mimeType.includes("video")) return "VID";
  if (mimeType.includes("audio")) return "AUD";
  return "FILE";
}

// =============================================================================
// Types
// =============================================================================

const MAX_FILE_SIZE = 4.5 * 1024 * 1024;

export interface ReplyInputProps {
  /** Promise 를 반환하면 전송이 끝날 때까지 전송 버튼을 잠그고 상태를 표시한다. */
  onSend: (content: string, screenshot?: string, file?: File) => void | Promise<unknown>;
  onEscape?: () => void;
  placeholder?: string;
  autoFocus?: boolean;
  /** 첨부 용량 초과 등 사용자에게 보여야 하는 오류 */
  onError?: (message: string) => void;
}

// =============================================================================
// Component
// =============================================================================

export function ReplyInput({
  onSend,
  onEscape,
  placeholder = "답글 입력...",
  autoFocus = false,
  onError,
}: ReplyInputProps) {
  const [replyText, setReplyText] = useState("");
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [capturingDom, setCapturingDom] = useState(false);
  const [sendingCount, setSendingCount] = useState(0);
  const [uploadingFile, setUploadingFile] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const hasContent = replyText.trim() || pendingImage || pendingFile;
  const sending = sendingCount > 0;

  // -------------------------------------------------------------------------
  // Send
  // -------------------------------------------------------------------------
  const handleSend = useCallback(() => {
    if (!hasContent || sending) return;

    const hadFile = !!pendingFile;
    const result = onSend(replyText.trim(), pendingImage || undefined, pendingFile || undefined);

    // 전송이 끝날 때까지 잠금 — 업로드 도중 이탈로 유실되는 것을 사용자가 인지하게 한다.
    if (result && typeof (result as Promise<unknown>).then === "function") {
      setSendingCount((count) => count + 1);
      if (hadFile) setUploadingFile(true);
      void (result as Promise<unknown>).then(
        () => {
          setSendingCount((count) => Math.max(0, count - 1));
          if (hadFile) setUploadingFile(false);
        },
        () => {
          setSendingCount((count) => Math.max(0, count - 1));
          if (hadFile) setUploadingFile(false);
        },
      );
    }

    setReplyText("");
    setPendingImage(null);
    setPendingFile(null);
    // reset textarea height
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }, [replyText, pendingImage, pendingFile, hasContent, sending, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      e.stopPropagation();
      if (e.nativeEvent.isComposing) return;
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
      if (e.key === "Escape") onEscape?.();
    },
    [handleSend, onEscape],
  );

  // 클립보드 붙여넣기: 이미지 → pendingImage, 비이미지 파일 → pendingFile
  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items || items.length === 0) return;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind !== "file") continue;
      const file = item.getAsFile();
      if (!file) continue;

      e.preventDefault();

      if (file.size > MAX_FILE_SIZE) {
        const msg = `파일 크기가 4.5MB를 초과합니다. (${(file.size / 1024 / 1024).toFixed(1)}MB)`;
        console.warn(`[@impakers/debug] ${msg}`);
        onError?.(msg);
        return;
      }

      if (file.type.startsWith("image/")) {
        setPendingFile(null);
        const reader = new FileReader();
        reader.onload = () => setPendingImage(reader.result as string);
        reader.readAsDataURL(file);
      } else {
        setPendingImage(null);
        setPendingFile(file);
      }
      return;
    }
  }, [onError]);

  // -------------------------------------------------------------------------
  // Camera: DOM 선택 → 스크린샷
  // -------------------------------------------------------------------------
  const handleCameraClick = useCallback(() => {
    setCapturingDom(true);

    const debugEls = document.querySelectorAll("[data-impakers-debug], [data-annotation-marker]");
    debugEls.forEach((el) => (el as HTMLElement).style.visibility = "hidden");

    document.documentElement.classList.add("impakers-selecting");

    let hoverBox: HTMLDivElement | null = null;

    const showHover = (rect: DOMRect) => {
      if (!hoverBox) {
        hoverBox = document.createElement("div");
        hoverBox.style.cssText = `position:fixed;border:2px solid #3b82f6;background:rgba(59,130,246,0.05);border-radius:4px;pointer-events:none;z-index:999999;transition:all 0.08s ease`;
        document.body.appendChild(hoverBox);
      }
      hoverBox.style.left = `${rect.left}px`;
      hoverBox.style.top = `${rect.top}px`;
      hoverBox.style.width = `${rect.width}px`;
      hoverBox.style.height = `${rect.height}px`;
    };

    const cleanup = () => {
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("click", handleClick, true);
      document.removeEventListener("keydown", handleEsc);
      document.documentElement.classList.remove("impakers-selecting");
      hoverBox?.remove();
      debugEls.forEach((el) => (el as HTMLElement).style.visibility = "");
      setCapturingDom(false);
    };

    const handleMove = (e: MouseEvent) => {
      const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement;
      if (!el || el === hoverBox) return;
      showHover(el.getBoundingClientRect());
    };

    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") cleanup();
    };

    const handleClick = async (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      const targetEl = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement;
      cleanup();

      if (!targetEl) return;

      try {
        const base64 = await captureElement(targetEl);
        setPendingImage(base64);
      } catch (err) {
        console.error("[@impakers/debug] DOM 스크린샷 실패:", err);
      }

      textareaRef.current?.focus();
    };

    document.addEventListener("mousemove", handleMove);
    document.addEventListener("click", handleClick, true);
    document.addEventListener("keydown", handleEsc);
  }, []);

  // -------------------------------------------------------------------------
  // File attach
  // -------------------------------------------------------------------------
  const handleAttachClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > MAX_FILE_SIZE) {
      const msg = `파일 크기가 4.5MB를 초과합니다. (${(file.size / 1024 / 1024).toFixed(1)}MB)`;
      console.warn(`[@impakers/debug] ${msg}`);
      onError?.(msg);
      e.target.value = "";
      return;
    }

    if (file.type.startsWith("image/")) {
      setPendingFile(null);
      const reader = new FileReader();
      reader.onload = () => setPendingImage(reader.result as string);
      reader.readAsDataURL(file);
    } else {
      setPendingImage(null);
      setPendingFile(file);
    }

    e.target.value = "";
  }, [onError]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <div className={styles.replyWrapper} data-impakers-debug="">
      {/* 첨부 이미지 미리보기 */}
      {pendingImage && (
        <div className={styles.pendingImage}>
          <img src={pendingImage} alt="pending" />
          <button className={styles.pendingRemove} onClick={() => setPendingImage(null)} type="button">&times;</button>
        </div>
      )}

      {/* 첨부 파일 미리보기 */}
      {pendingFile && (
        <div className={styles.pendingFile}>
          <span className={styles.fileIcon}>{getFileIcon(pendingFile.type)}</span>
          <span className={styles.fileInfo}>
            <span className={styles.fileCardName}>{pendingFile.name}</span>
            <span className={styles.fileCardSize}>{formatFileSize(pendingFile.size)}</span>
          </span>
          <button className={styles.pendingRemove} onClick={() => setPendingFile(null)} type="button">&times;</button>
        </div>
      )}

      {/* Textarea */}
      <div className={styles.replyArea}>
        <textarea
          ref={textareaRef}
          className={styles.replyInput}
          placeholder={placeholder}
          value={replyText}
          onChange={(e) => {
            setReplyText(e.target.value);
            const el = e.target;
            el.style.height = "auto";
            el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
          }}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          rows={2}
          autoFocus={autoFocus}
        />
      </div>

      {/* 전송 진행 상태 — 첨부 업로드 중 이탈 방지 */}
      {sending && (
        <div className={styles.sendingStatus}>
          <span className={styles.sendingDot} />
          {uploadingFile ? "첨부 업로드 중… 페이지를 벗어나지 마세요" : "전송 중…"}
        </div>
      )}

      {/* Toolbar */}
      <div className={styles.replyToolbar}>
        <button className={styles.replyTool} onClick={handleAttachClick} type="button" title="파일 첨부">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
        <button className={styles.replyTool} onClick={handleCameraClick} type="button" title="요소 스크린샷">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14.5 4h-5L7 7H4a2 2 0 00-2 2v9a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2h-3l-2.5-3z" />
            <circle cx="12" cy="13" r="3" />
          </svg>
        </button>
        <button
          className={`${styles.replySend} ${hasContent && !sending ? styles.active : ""}`}
          onClick={handleSend}
          disabled={!hasContent || sending}
          type="button"
          title={sending ? "전송 중" : "전송"}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="*/*"
        style={{ display: "none" }}
        onChange={handleFileChange}
      />
    </div>
  );
}
