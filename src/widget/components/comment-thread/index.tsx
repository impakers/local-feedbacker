"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { captureElement } from "../../utils/capture-element";
import { renderMarkdown } from "../../utils/markdown";
import { LoadingSpinner } from "../loading-spinner";
import { PhotoGroup, resolveImages } from "../photo-group";
import type { DebugWidgetTheme } from "../../core/types";
import styles from "./styles.module.scss";

// =============================================================================
// Types
// =============================================================================

export interface CommentReaderInfo {
  id: string;
  name: string;
  readAt: string;
}

export interface CommentData {
  id: string;
  content: string;
  authorName: string;
  authorId?: string;
  imageUrl?: string;
  /** 그룹 사진 — 첨부 이미지 전체. 구버전 OS 응답에는 없어 imageUrl 폴백이 필요하다. */
  imageUrls?: readonly string[];
  fileUrl?: string;
  fileName?: string;
  fileType?: string;
  fileSize?: number;
  fileSource?: string;
  createdAt: string;
  /** 'system' = 임패커스 자동 안내(완료 확인 등). 말풍선이 아니라 안내 UI로 렌더된다. */
  authorType?: 'user' | 'operator' | 'system';
  readers?: CommentReaderInfo[];
  /** 서버 저장 전(첨부 업로드 중 포함) 임시 코멘트 */
  pending?: boolean;
}

export interface ThreadTask {
  id: string;
  taskNumber?: number;
  title: string;
  status: string;
  feedbackMarker?: { element?: string };
  authorName?: string;
  authorId?: string;
  createdAt: string;
  comments: CommentData[];
}

export interface CommentThreadProps {
  task: ThreadTask;
  currentUserName: string;
  currentUserId?: string;
  left: number;
  top?: number;
  bottom?: number;
  loading?: boolean;
  onClose: () => void;
  /** content, screenshot(base64), file(비이미지 파일). Promise 반환 시 전송 완료까지 입력을 잠근다. */
  onReply: (taskId: string, content: string, screenshot?: string, file?: File) => void | Promise<unknown>;
  /** v1.8: 메신저 스타일 읽음 마킹 — 본 코멘트 ID들을 서버에 read 처리. 익명일 때는 미제공. */
  onMarkRead?: (taskId: string, commentIds: string[]) => void;
  /** 첨부 용량 초과 등 사용자에게 보여야 하는 오류 */
  onError?: (message: string) => void;
  /** 스레드 서피스 재질. 미지정 시 `"solid"` — 기존 불투명 흰 카드 그대로. */
  theme?: DebugWidgetTheme;
}

const MAX_FILE_SIZE = 4.5 * 1024 * 1024;

// =============================================================================
// Helpers
// =============================================================================

function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  const diff = Date.now() - date.getTime();
  const pad = (n: number) => String(n).padStart(2, "0");
  const abs = `${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const m = Math.floor(diff / 60000);
  if (m < 1) return `${abs} (방금)`;
  if (m < 60) return `${abs} (${m}분 전)`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${abs} (${h}시간 전)`;
  const d = Math.floor(h / 24);
  return `${abs} (${d}일 전)`;
}

function getInitials(name: string): string {
  return name.slice(0, 1).toUpperCase();
}

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
// Component
// =============================================================================

export function CommentThread({
  task,
  currentUserName,
  currentUserId,
  left,
  top,
  bottom,
  loading,
  onClose,
  onReply,
  onMarkRead,
  onError,
  theme = "solid",
}: CommentThreadProps) {
  const [replyText, setReplyText] = useState("");
  const [sendingCount, setSendingCount] = useState(0);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [pendingImage, setPendingImage] = useState<string | null>(null); // base64 미리보기
  const [pendingFile, setPendingFile] = useState<File | null>(null); // 비이미지 파일
  const [capturingDom, setCapturingDom] = useState(false);
  const [titleExpanded, setTitleExpanded] = useState(false);
  const [titleOverflows, setTitleOverflows] = useState(false);
  const titleRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
    textareaRef.current?.focus();
  }, [task.comments.length]);

  // 다른 마커의 스레드로 전환되면 제목 펼침 상태 초기화
  useEffect(() => {
    setTitleExpanded(false);
  }, [task.id]);

  // 제목이 클램프(6줄)를 넘는지 측정 → 넘을 때만 더보기 토글 노출
  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    setTitleOverflows(el.scrollHeight > el.clientHeight + 1);
  }, [task.id, task.title, titleExpanded]);

  // v1.8: 스레드 열림/코멘트 변경 시 본인이 안 읽은 + 본인이 작성하지 않은 코멘트들을 일괄 읽음 처리
  useEffect(() => {
    if (!onMarkRead || !currentUserId) return;
    const targetIds = task.comments
      .filter((c) => c.authorId !== currentUserId)
      .filter((c) => !(c.readers || []).some((r) => r.id === currentUserId))
      .map((c) => c.id)
      // 낙관적 임시 코멘트(temp-*) 제외 — 서버 응답 후 다시 마킹됨
      .filter((id) => !id.startsWith('temp-'));
    if (targetIds.length === 0) return;
    onMarkRead(task.id, targetIds);
  }, [task.id, task.comments, currentUserId, onMarkRead]);

  // 바깥 클릭 닫기 (DOM 캡처 모드일 때는 무시)
  useEffect(() => {
    if (capturingDom) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest(`.${styles.thread}`)) return;
      if (target.closest("[data-annotation-marker]")) return;
      if (target.closest("[data-impakers-debug]")) return;
      handleClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [capturingDom]);

  const handleClose = useCallback(() => {
    setExiting(true);
    setTimeout(() => onClose(), 120);
  }, [onClose]);

  // -------------------------------------------------------------------------
  // Send reply (with optional image)
  // -------------------------------------------------------------------------
  const sending = sendingCount > 0;

  const handleSend = useCallback(() => {
    if (!replyText.trim() && !pendingImage && !pendingFile) return;
    if (sending) return;

    const hadFile = !!pendingFile;
    const result = onReply(task.id, replyText.trim(), pendingImage || undefined, pendingFile || undefined);

    // 전송이 끝날 때까지 잠금 — 업로드 도중 이탈로 유실되는 것을 사용자가 인지하게 한다.
    if (result && typeof (result as Promise<unknown>).then === "function") {
      const release = () => {
        setSendingCount((count) => Math.max(0, count - 1));
        if (hadFile) setUploadingFile(false);
      };
      setSendingCount((count) => count + 1);
      if (hadFile) setUploadingFile(true);
      void (result as Promise<unknown>).then(release, release);
    }

    setReplyText("");
    setPendingImage(null);
    setPendingFile(null);
  }, [replyText, pendingImage, pendingFile, sending, task.id, onReply]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      e.stopPropagation();
      if (e.nativeEvent.isComposing) return;
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
      if (e.key === "Escape") handleClose();
    },
    [handleClose, handleSend],
  );

  // 클립보드 붙여넣기: 이미지면 pendingImage, 비이미지 파일이면 pendingFile
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
  // 카메라: DOM 선택 → 스크린샷
  // -------------------------------------------------------------------------
  const startDomCapture = useCallback(() => {
    setCapturingDom(true);

    // 모든 debug UI 숨기기
    const debugEls = document.querySelectorAll("[data-impakers-debug], [data-annotation-marker]");
    debugEls.forEach((el) => (el as HTMLElement).style.visibility = "hidden");

    // crosshair 커서 (CSS class 방식으로 전환 — 동적 DOM에도 적용)
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
      if (e.key === "Escape") { cleanup(); }
    };

    const handleClick = async (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation(); // 다른 핸들러(dropdown 닫기 등) 차단

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

  const handleCameraClick = useCallback(() => {
    startDomCapture();
  }, [startDomCapture]);

  // -------------------------------------------------------------------------
  // + 버튼: 파일 첨부
  // -------------------------------------------------------------------------
  const handleAttachClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // 4.5MB 제한 체크
    if (file.size > MAX_FILE_SIZE) {
      const msg = `파일 크기가 4.5MB를 초과합니다. (${(file.size / 1024 / 1024).toFixed(1)}MB)`;
      console.warn(`[@impakers/debug] ${msg}`);
      onError?.(msg);
      e.target.value = "";
      return;
    }

    if (file.type.startsWith("image/")) {
      // 이미지: base64 미리보기
      setPendingFile(null);
      const reader = new FileReader();
      reader.onload = () => {
        setPendingImage(reader.result as string);
      };
      reader.readAsDataURL(file);
    } else {
      // 비이미지: File 객체 보관
      setPendingImage(null);
      setPendingFile(file);
    }

    // input 초기화 (같은 파일 다시 선택 가능)
    e.target.value = "";
  }, [onError]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  const feedbackTitle = task.title.replace(/^\[피드백\]\s*/, "");

  // max-height 계산: top 모드일 땐 top~viewport 하단, bottom 모드일 땐 viewport 상단~bottom
  const availableSpace = top !== undefined
    ? window.innerHeight - top - 20
    : bottom !== undefined
      ? window.innerHeight - bottom - 20
      : window.innerHeight - 40;
  const positionStyle: React.CSSProperties = {
    left,
    ...(top !== undefined ? { top } : {}),
    ...(bottom !== undefined ? { bottom } : {}),
    "--thread-max-height": `${Math.max(200, availableSpace)}px`,
  } as React.CSSProperties;

  return (
    <div
      className={`${styles.thread} ${exiting ? styles.exiting : ""} ${theme === "light-glass" ? styles.glass : ""}`}
      style={positionStyle}
      data-impakers-debug=""
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header — 피드백 생성자 이름 표시 */}
      <div className={styles.header}>
        <div className={styles.avatar}>{getInitials(task.authorName || currentUserName)}</div>
        <div className={styles.headerInfo}>
          <div className={styles.headerTop}>
            <span className={styles.authorName}>{task.authorName || currentUserName}</span>
            <span className={styles.timestamp}>{formatTime(task.createdAt)}</span>
          </div>
          <div
            ref={titleRef}
            className={`${styles.title} ${titleExpanded ? styles.titleExpanded : styles.titleClamped}`}
          >
            {feedbackTitle}
          </div>
          {(titleOverflows || titleExpanded) && (
            <button
              className={styles.titleToggle}
              onClick={() => setTitleExpanded((v) => !v)}
              type="button"
            >
              {titleExpanded ? "접기" : "더보기"}
            </button>
          )}
        </div>
        <div className={styles.headerActions}>
          <button className={styles.headerAction} onClick={handleClose} title="닫기" type="button">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Comments list */}
      {loading && task.comments.length === 0 && (
        <>
          <div className={styles.divider} />
          <LoadingSpinner message="댓글 로딩 중..." />
        </>
      )}
      {task.comments.length > 0 && (
        <>
          <div className={styles.divider} />
          <div className={styles.commentsList} ref={listRef}>
            {task.comments.map((comment) => {
              // 임패커스 자동 안내 — 사람 말풍선이 아니라 가운데 정렬 시스템 메시지로.
              if (comment.authorType === "system") {
                return (
                  <div key={comment.id} className={styles.systemMessage}>
                    <div className={styles.systemBubble}>{renderMarkdown(comment.content)}</div>
                    <div className={styles.systemTime}>{formatTime(comment.createdAt)}</div>
                  </div>
                );
              }
              return (
              <div key={comment.id} className={`${styles.comment} ${comment.pending ? styles.commentPending : ""}`}>
                <div className={styles.avatar} style={{ width: 22, height: 22, fontSize: 10 }}>
                  {getInitials(comment.authorName)}
                </div>
                <div className={styles.commentContent}>
                  <div className={styles.commentTop}>
                    <span className={styles.commentAuthor}>{comment.authorName}</span>
                    <span className={styles.commentTime}>
                      {comment.pending ? "전송 중…" : formatTime(comment.createdAt)}
                    </span>
                  </div>
                  {comment.content && <div className={styles.commentText}>{renderMarkdown(comment.content)}</div>}
                  {/* 첨부 사진 — 여러 장이면 그룹으로 묶어 보여준다(구버전 응답은 imageUrl 폴백). */}
                  <PhotoGroup images={resolveImages(comment)} />
                  {/* 업로드 진행 중인 첨부 — URL 이 아직 없어 링크 대신 상태로 표시 */}
                  {comment.pending && !comment.fileUrl && comment.fileName && (
                    <div className={styles.fileCard}>
                      <span className={styles.fileIcon}>{getFileIcon(comment.fileType || "")}</span>
                      <span className={styles.fileInfo}>
                        <span className={styles.fileCardName}>{comment.fileName}</span>
                        <span className={styles.fileCardSize}>
                          {comment.fileSize != null ? `${formatFileSize(comment.fileSize)} · ` : ""}업로드 중…
                        </span>
                      </span>
                    </div>
                  )}
                  {comment.fileUrl && (
                    <a
                      className={styles.fileCard}
                      href={comment.fileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <span className={styles.fileIcon}>{getFileIcon(comment.fileType || "")}</span>
                      <span className={styles.fileInfo}>
                        <span className={styles.fileCardName}>{comment.fileName || "파일"}</span>
                        {comment.fileSize != null && (
                          <span className={styles.fileCardSize}>{formatFileSize(comment.fileSize)}</span>
                        )}
                      </span>
                    </a>
                  )}
                  {(() => {
                    // v1.8: 본인 코멘트에 "읽음 N" 표시 (본인 제외 카운트)
                    const isOwn = !!currentUserId && comment.authorId === currentUserId;
                    if (!isOwn) return null;
                    const others = (comment.readers || []).filter((r) => r.id !== currentUserId);
                    if (others.length === 0) return null;
                    const tooltip = others.map((r) => r.name).join(', ');
                    return (
                      <div className={styles.commentReadCount} title={tooltip}>
                        읽음 {others.length}
                      </div>
                    );
                  })()}
                </div>
              </div>
              );
            })}
          </div>
        </>
      )}

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

      {/* Reply input — 입력창+툴바를 카드 하나로 묶어 유리 패널처럼 보이게 한다 */}
      <div className={styles.composer}>
        <div className={styles.replyArea}>
          <textarea
            ref={textareaRef}
            className={styles.replyInput}
            placeholder="답글 입력..."
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
          />
        </div>
        {/* 전송 진행 상태 — 첨부 업로드 중 이탈 방지 */}
        {sending && (
          <div className={styles.sendingStatus}>
            <span className={styles.sendingDot} />
            {uploadingFile ? "첨부 업로드 중… 페이지를 벗어나지 마세요" : "전송 중…"}
          </div>
        )}
        <div className={styles.replyToolbar}>
          {/* + 파일 첨부 */}
          <button className={styles.replyTool} onClick={handleAttachClick} type="button" title="파일 첨부">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
          {/* 카메라 (DOM 스크린샷) */}
          <button className={styles.replyTool} onClick={handleCameraClick} type="button" title="요소 스크린샷">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14.5 4h-5L7 7H4a2 2 0 00-2 2v9a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2h-3l-2.5-3z" />
              <circle cx="12" cy="13" r="3" />
            </svg>
          </button>
          {/* 전송 */}
          <button
            className={`${styles.replySend} ${(replyText.trim() || pendingImage || pendingFile) && !sending ? styles.active : ""}`}
            onClick={handleSend}
            disabled={(!replyText.trim() && !pendingImage && !pendingFile) || sending}
            type="button"
            title={sending ? "전송 중" : "전송"}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="*/*"
        style={{ display: "none" }}
        onChange={handleFileChange}
      />

      {/* 이미지 확대는 PhotoGroup 이 자체 라이트박스(좌우 이동 포함)로 처리한다. */}
    </div>
  );
}
