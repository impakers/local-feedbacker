"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import {
  fetchComments,
  postComment,
  addPendingComment,
  uploadFile,
  fetchHistory,
  getCachedSnapshot,
  subscribeCache,
  getCommentsCacheKey,
  type FeedbackComment,
  type HistoryEvent,
} from "../../core/api";
import { beginPendingUpload } from "../../core/pending-uploads";
import { LoadingSpinner } from "../loading-spinner";
import { PhotoGroup, resolveImages } from "../photo-group";
import { ReplyInput } from "../reply-input";
import { useModalOverlayIsolation } from "../../utils/modal-isolation";
import type { DebugWidgetTheme } from "../../core/types";
import { formatFeedbackRoute, formatModalPath, modalTypeLabel } from "./route-label";
import { renderMarkdown } from "../../utils/markdown";
import styles from "./styles.module.scss";

// 이미지 확대 모달
function ImageLightbox({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div className={styles.lightbox} onClick={onClose} data-impakers-debug="">
      <img src={src} alt="enlarged" onClick={(e) => e.stopPropagation()} />
      <button className={styles.lightboxClose} onClick={onClose} type="button">&times;</button>
    </div>
  );
}

// =============================================================================
// File preview helpers
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

/** Google Drive URL에서 file ID 추출 */
function extractDriveFileId(url: string): string | null {
  const match = url.match(/\/d\/([^/]+)/);
  return match ? match[1] : null;
}

/** 파일 타입에 따라 프리뷰 가능한 iframe src 반환 */
function getPreviewSrc(fileUrl: string, fileType: string, fileSource?: string): string | null {
  // Office 파일 → Microsoft Office Online Viewer (공개 URL 필요)
  const isOffice = /\.(pptx?|xlsx?|docx?)$/i.test(fileUrl) ||
    fileType.includes("presentation") || fileType.includes("powerpoint") ||
    fileType.includes("spreadsheet") || fileType.includes("excel") ||
    fileType.includes("document") || fileType.includes("word") || fileType.includes("msword");

  if (fileSource === "google_drive") {
    const fileId = extractDriveFileId(fileUrl);
    if (fileId) return `https://drive.google.com/file/d/${fileId}/preview`;
  }

  if (isOffice && fileSource !== "google_drive") {
    return `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(fileUrl)}`;
  }

  // PDF → 브라우저 내장
  if (fileType.includes("pdf")) return fileUrl;

  return null;
}

// 파일 프리뷰 모달
function FilePreviewModal({
  fileUrl, fileName, fileType, fileSource, onClose,
}: {
  fileUrl: string; fileName: string; fileType: string; fileSource?: string; onClose: () => void;
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const previewSrc = getPreviewSrc(fileUrl, fileType, fileSource);

  return (
    <div className={styles.filePreviewOverlay} onClick={onClose} data-impakers-debug="">
      <div className={styles.filePreviewModal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.filePreviewHeader}>
          <span className={styles.filePreviewName}>{fileName}</span>
          <div className={styles.filePreviewActions}>
            <a href={fileUrl} target="_blank" rel="noopener noreferrer" className={styles.filePreviewOpen}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
                <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
              열기
            </a>
            <button className={styles.filePreviewClose} onClick={onClose} type="button">&times;</button>
          </div>
        </div>
        <div className={styles.filePreviewBody}>
          {previewSrc ? (
            <iframe src={previewSrc} className={styles.filePreviewIframe} title={fileName} />
          ) : (
            <div className={styles.filePreviewFallback}>
              <span className={styles.filePreviewFallbackIcon}>{getFileIcon(fileType)}</span>
              <span>미리보기를 지원하지 않는 파일 형식입니다</span>
              <a href={fileUrl} target="_blank" rel="noopener noreferrer">파일 열기</a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Types
// =============================================================================

export interface InboxItem {
  id: string;
  title: string;
  /** 원문 전체(무손실). title이 프리뷰로 잘린 경우 상세에서 전문 표시용. */
  description?: string;
  status: string;
  priority: string;
  authorName: string;
  authorId?: string | null;
  feedbackUrl: string;
  createdAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  commentCount: number;
  screenshot?: string;
  /** 모달/오버레이 안에서 작성된 피드백인지 (U2 구분 표시) */
  isInModal?: boolean;
  /** 원본 코드 파일명 또는 DialogTitle — 모달 피드백의 경로 보조 정보 */
  modalLabel?: string;
  /** 모달의 DialogTitle — 경로 표시 {페이지} > {트리거} > {제목}의 마지막 세그먼트 */
  modalTitle?: string;
  /** 모달을 연 트리거(버튼) 레이블 — 경로 표시의 가운데 세그먼트 */
  modalTrigger?: string;
}

export interface InboxPanelProps {
  pageItems: InboxItem[];
  allItems: InboxItem[];
  currentPath: string;
  serviceName?: string;
  endpoint: string;
  currentUserName: string;
  currentUserId?: string;
  onClose: () => void;
  /** History 탭 진입 시 호출 — lastSeen 갱신용 */
  onHistoryViewed?: () => void;
  /** 새 히스토리 이벤트 개수 (FAB 뱃지와 동일) */
  newNotiCount?: number;
  /** 신규 확인 필요(빨간 점) 표시할 피드백 ID 집합 */
  attentionTaskIds?: Set<string>;
  /** 피드백 상세 진입 시 호출 — 해당 피드백 빨간 점 제거용 */
  onItemSeen?: (taskId: string) => void;
  /** 첨부 용량 초과·업로드 실패 등 사용자에게 보여야 하는 오류 */
  onError?: (message: string) => void;
  /** 패널 서피스 재질. 미지정 시 `"solid"` — 기존 불투명 흰 시트 그대로. */
  theme?: DebugWidgetTheme;
}

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

/** 동적 세그먼트(숫자, UUID)를 무시하고 같은 라우트 패턴인지 비교 */
function isSameRoutePattern(a: string, b: string): boolean {
  const normalize = (path: string) =>
    path.split("/").map((seg) =>
      /^\d+$/.test(seg) || /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(seg) ? "*" : seg
    ).join("/");
  return normalize(a) === normalize(b);
}

function getInitials(name: string): string {
  return name.slice(0, 1).toUpperCase();
}

/** 검색 페이지 크기 — 알림/리스트 모두 이 단위로 "더 보기" */
const PAGE_SIZE = 50;

/** 피드백 카드가 검색어에 매칭되는지 (제목·본문·작성자) */
function itemMatchesQuery(item: InboxItem, q: string): boolean {
  if (!q) return true;
  return [item.title, item.description, item.authorName].some(
    (v) => typeof v === "string" && v.toLowerCase().includes(q),
  );
}

/** 알림(히스토리) 이벤트가 검색어에 매칭되는지 (작성자·피드백 제목·댓글 내용) */
function eventMatchesQuery(ev: HistoryEvent, q: string): boolean {
  if (!q) return true;
  const content =
    ev.metadata && typeof ev.metadata.content === "string" ? ev.metadata.content : "";
  return [ev.actorName, ev.taskTitle, content].some(
    (v) => typeof v === "string" && v.toLowerCase().includes(q),
  );
}

// =============================================================================
// Component
// =============================================================================

export function InboxPanel({
  pageItems,
  allItems,
  currentPath,
  serviceName,
  endpoint,
  currentUserName,
  currentUserId,
  onClose,
  onHistoryViewed,
  newNotiCount,
  attentionTaskIds,
  onItemSeen,
  onError,
  theme = "solid",
}: InboxPanelProps) {
  const [tab, setTab] = useState<"page" | "all" | "history">("page");
  const [statusFilter, setStatusFilter] = useState<"todo" | "in_progress" | "done">("todo");
  const [dateFrom, setDateFrom] = useState<string>(""); // YYYY-MM-DD
  const [dateTo, setDateTo] = useState<string>("");     // YYYY-MM-DD
  const [historyEvents, setHistoryEvents] = useState<HistoryEvent[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [selectedItem, setSelectedItem] = useState<InboxItem | null>(null);
  const [comments, setComments] = useState<FeedbackComment[]>([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [filePreview, setFilePreview] = useState<{ url: string; name: string; type: string; source?: string } | null>(null);
  const [search, setSearch] = useState("");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const commentsEndRef = useRef<HTMLDivElement>(null);
  // 호스트 앱의 Radix(shadcn) 모달이 body에 pointer-events:none을 걸어도
  // 이 패널(별도 body 포털)이 조작 가능하도록 격리한다.
  const isolationRef = useModalOverlayIsolation<HTMLDivElement>();

  // 탭 전환 시 검색어/페이지 초기화
  const handleTabChange = useCallback((next: "page" | "all" | "history") => {
    setTab(next);
    setSearch("");
    setVisibleCount(PAGE_SIZE);
    if (next === "history") onHistoryViewed?.();
  }, [onHistoryViewed]);

  // 검색어/필터 변경 시 표시 개수 초기화
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [search, statusFilter, dateFrom, dateTo, tab]);

  const handleClose = useCallback(() => {
    if (selectedItem) {
      setSelectedItem(null);
      setComments([]);
      return;
    }
    setExiting(true);
    setTimeout(() => onClose(), 150);
  }, [onClose, selectedItem]);

  // 카드 클릭 → 항상 상세 뷰 (댓글 피드) 진입
  const handleItemClick = useCallback(async (item: InboxItem) => {

    setSelectedItem(item);
    onItemSeen?.(item.id); // 상세 진입 → 빨간 점 제거
    const cached = getCachedSnapshot<FeedbackComment[]>(getCommentsCacheKey(item.id));
    setComments(cached || []);
    setLoadingComments(!cached);
  }, [endpoint, onItemSeen]);

  useEffect(() => {
    if (!selectedItem) return;

    const cacheKey = getCommentsCacheKey(selectedItem.id);
    const cached = getCachedSnapshot<FeedbackComment[]>(cacheKey);
    if (cached) {
      setComments(cached);
      setLoadingComments(false);
    }

    const unsubscribe = subscribeCache<FeedbackComment[]>(cacheKey, (nextComments) => {
      setComments(nextComments);
      setLoadingComments(false);
    });

    fetchComments(endpoint, selectedItem.id, { staleWhileRevalidate: true })
      .then((data) => {
        setComments(data);
        setLoadingComments(false);
      })
      .catch(() => {
        setLoadingComments(false);
      });

    return unsubscribe;
  }, [selectedItem, endpoint]);

  // 댓글 로드 후 스크롤
  useEffect(() => {
    commentsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [comments.length]);

  // 댓글 전송 (텍스트 + 스크린샷 + 파일)
  const handleSendReply = useCallback(async (content: string, screenshot?: string, file?: File) => {
    if (!selectedItem) return;
    const taskId = selectedItem.id;

    // 업로드 전에 임시 코멘트를 먼저 띄운다 — 첨부 업로드 중에도 전송 사실이 보이도록.
    const tempId = addPendingComment(taskId, {
      content,
      authorName: currentUserName,
      authorId: currentUserId,
      screenshot,
      fileName: file?.name,
      fileType: file?.type,
      fileSize: file?.size,
    });
    // 새로고침/탭 닫기는 in-flight 요청을 끊으므로 전송 동안만 이탈 경고를 건다.
    const releaseGuard = beginPendingUpload();

    try {
      let fileResult;
      if (file) {
        try {
          fileResult = await uploadFile(endpoint, file, "comment", taskId);
        } catch (err: any) {
          const msg = err?.message || "파일 업로드 실패";
          onError?.(msg);
          console.error("[@impakers/debug] 파일 업로드 실패:", err);
          // 파일 업로드 실패해도 텍스트/스크린샷 코멘트는 전송
        }
      }
      await postComment(endpoint, taskId, content, currentUserName, currentUserId, screenshot, fileResult, tempId);
    } catch (err: any) {
      const msg = err?.message || "코멘트 전송 실패";
      onError?.(msg);
      console.error("[@impakers/debug] 코멘트 전송 실패:", err);
    } finally {
      releaseGuard();
    }
  }, [selectedItem, endpoint, currentUserName, currentUserId, onError]);

  const rawItems = tab === "page" ? pageItems : tab === "all" ? allItems : [];
  const query = search.trim().toLowerCase();
  const filteredItems = rawItems
    .filter((item) => item.status === statusFilter)
    .filter((item) => itemMatchesQuery(item, query));
  const items = filteredItems.slice(0, visibleCount);
  const hasMoreItems = filteredItems.length > items.length;
  // 상태별 카운트(탭 배지)는 검색과 무관하게 전체 기준
  const todoCount = rawItems.filter((item) => item.status === "todo").length;
  const inProgressCount = rawItems.filter((item) => item.status === "in_progress").length;
  const doneCount = rawItems.filter((item) => item.status === "done").length;

  // History: 서버에서 이벤트 로드 (기간 필터)
  useEffect(() => {
    if (tab !== "history") return;
    setHistoryLoading(true);
    fetchHistory(endpoint, { since: dateFrom || undefined, date: dateTo || undefined, limit: 200 })
      .then((events) => {
        // since 파라미터가 서버에서 지원 안 될 경우 클라이언트 필터 fallback
        if (dateFrom && events.length > 0) {
          const fromTime = new Date(dateFrom).getTime();
          const filtered = events.filter((ev) => new Date(ev.createdAt).getTime() >= fromTime);
          if (filtered.length < events.length) {
            setHistoryEvents(filtered);
            return;
          }
        }
        setHistoryEvents(events);
      })
      .catch(() => setHistoryEvents([]))
      .finally(() => setHistoryLoading(false));
  }, [tab, dateFrom, dateTo, endpoint]);

  // 히스토리 이벤트 클릭 → 해당 피드백 상세로 이동
  const handleHistoryItemClick = useCallback((ev: HistoryEvent) => {
    const match = allItems.find((item) => item.id === ev.taskId);
    if (match) handleItemClick(match);
  }, [allItems, handleItemClick]);

  // 알림(히스토리) 검색 + 페이지네이션
  const filteredHistory = historyEvents.filter((ev) => eventMatchesQuery(ev, query));
  const visibleHistory = filteredHistory.slice(0, visibleCount);
  const hasMoreHistory = filteredHistory.length > visibleHistory.length;

  if (typeof document === "undefined") return null;

  return createPortal(
    <div ref={isolationRef} data-impakers-debug="">
      <div className={styles.backdrop} onClick={handleClose} />

      <div
        className={`${styles.panel} ${exiting ? styles.exiting : ""} ${theme === "light-glass" ? styles.glass : ""}`}
        data-impakers-debug=""
      >
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            {selectedItem && (
              <button className={styles.backBtn} onClick={handleClose} type="button">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>
            )}
            <span className={styles.headerTitle}>
              {selectedItem ? "피드백 상세" : (serviceName || "피드백")}
            </span>
          </div>
          <button className={styles.closeBtn} onClick={() => { setExiting(true); setTimeout(() => onClose(), 150); }} type="button">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* === 상세 뷰 === */}
        {selectedItem ? (
          <div className={styles.detailView}>
            {/* 원본 피드백 */}
            <div className={styles.detailHeader}>
              <div className={styles.cardAvatar}>{getInitials(selectedItem.authorName)}</div>
              <div>
                <div className={styles.cardMeta}>
                  <span className={styles.cardAuthor}>{selectedItem.authorName}</span>
                  <span className={styles.cardTime}>{formatTime(selectedItem.createdAt)}</span>
                </div>
                <div className={styles.detailTitle}>
                  {selectedItem.title.replace(/^\[피드백\]\s*/, "")}
                </div>
              </div>
              {selectedItem.isInModal && (
                <span className={`${styles.locationBadge} ${styles.locationModal}`}>모달</span>
              )}
            </div>

            {(() => {
              // title이 프리뷰로 잘린 경우에만 전문(body)을 별도 표시 (중복 방지)
              const titleClean = selectedItem.title.replace(/^\[피드백\]\s*/, "").trim();
              const body = selectedItem.description?.trim();
              if (!body || body === titleClean) return null;
              return <div className={styles.detailBody}>{renderMarkdown(body)}</div>;
            })()}

            {selectedItem.screenshot && (
              <div
                className={styles.detailScreenshot}
                style={{ cursor: "zoom-in" }}
                onClick={(e) => { e.stopPropagation(); setLightboxSrc(selectedItem.screenshot!); }}
              >
                <img src={selectedItem.screenshot} alt="screenshot" />
              </div>
            )}

            {/* 댓글 목록 */}
            <div className={styles.commentsList}>
              {loadingComments && (
                <LoadingSpinner message="댓글 로딩 중..." />
              )}
              {!loadingComments && comments.length === 0 && (
                <div className={styles.noComments}>아직 댓글이 없습니다</div>
              )}
              {comments.map((c) => {
                // 임패커스 자동 안내 — 사람 말풍선이 아니라 가운데 정렬 시스템 메시지로.
                if (c.authorType === "system") {
                  return (
                    <div key={c.id} className={styles.systemMessage}>
                      <div className={styles.systemBubble}>{renderMarkdown(c.content)}</div>
                      <div className={styles.systemTime}>{formatTime(c.createdAt)}</div>
                    </div>
                  );
                }
                return (
                <div key={c.id} className={`${styles.commentItem} ${c.pending ? styles.commentPending : ""}`}>
                  <div className={styles.commentAvatar} style={{ width: 22, height: 22, fontSize: 10 }}>
                    {getInitials(c.authorName)}
                  </div>
                  <div className={styles.commentBody}>
                    <div className={styles.commentMeta}>
                      <span className={styles.commentAuthorName}>{c.authorName}</span>
                      <span className={styles.commentTime}>
                        {c.pending ? "전송 중…" : formatTime(c.createdAt)}
                      </span>
                    </div>
                    {c.content && <div className={styles.commentContent}>{renderMarkdown(c.content)}</div>}
                    {/* 첨부 사진 — 여러 장이면 그룹으로 묶어 보여준다(구버전 응답은 imageUrl 폴백). */}
                    <PhotoGroup images={resolveImages(c)} stopPropagation />
                    {/* 업로드 진행 중인 첨부 — URL 이 아직 없어 열기 대신 상태로 표시 */}
                    {c.pending && !c.fileUrl && c.fileName && (
                      <div className={styles.commentFileCard} style={{ cursor: "default" }}>
                        <span className={styles.commentFileIcon}>{getFileIcon(c.fileType || "")}</span>
                        <span className={styles.commentFileInfo}>
                          <span className={styles.commentFileName}>{c.fileName}</span>
                          <span className={styles.commentFileSize}>
                            {c.fileSize != null ? `${formatFileSize(c.fileSize)} · ` : ""}업로드 중…
                          </span>
                        </span>
                      </div>
                    )}
                    {c.fileUrl && (
                      <div
                        className={styles.commentFileCard}
                        onClick={(e) => {
                          e.stopPropagation();
                          setFilePreview({
                            url: c.fileUrl!,
                            name: c.fileName || "파일",
                            type: c.fileType || "",
                            source: c.fileSource,
                          });
                        }}
                      >
                        <span className={styles.commentFileIcon}>{getFileIcon(c.fileType || "")}</span>
                        <span className={styles.commentFileInfo}>
                          <span className={styles.commentFileName}>{c.fileName || "파일"}</span>
                          {c.fileSize != null && (
                            <span className={styles.commentFileSize}>{formatFileSize(c.fileSize)}</span>
                          )}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
                );
              })}
              <div ref={commentsEndRef} />
            </div>

            {/* 댓글 입력 (파일/스크린샷 첨부 지원) */}
            <ReplyInput
              onSend={handleSendReply}
              onEscape={handleClose}
              autoFocus
              onError={onError}
            />
          </div>
        ) : (
          <>
            {/* === 리스트 뷰 === */}
            <div className={styles.tabs}>
              <button className={`${styles.tab} ${tab === "page" ? styles.active : ""}`} onClick={() => handleTabChange("page")} type="button">
                이 페이지
                {pageItems.length > 0 && <span className={styles.tabBadge}>{pageItems.length}</span>}
              </button>
              <button className={`${styles.tab} ${tab === "all" ? styles.active : ""}`} onClick={() => handleTabChange("all")} type="button">
                전체
                {allItems.length > 0 && <span className={styles.tabBadge}>{allItems.length}</span>}
              </button>
              <button className={`${styles.tab} ${tab === "history" ? styles.active : ""}`} onClick={() => handleTabChange("history")} type="button">
                알림
                {newNotiCount && newNotiCount > 0 ? <span className={styles.tabBadge}>{newNotiCount}</span> : null}
              </button>
            </div>

            {tab === "history" ? (
              /* === 알림 인박스 뷰 === */
              <>
              <div className={styles.searchBox}>
                <svg className={styles.searchIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className={styles.searchInput}
                  placeholder="작성자·피드백·댓글 검색"
                />
                {search && (
                  <button className={styles.searchClear} onClick={() => setSearch("")} type="button" title="검색어 지우기">
                    &times;
                  </button>
                )}
              </div>
              <div className={styles.dateRangeFilter}>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className={styles.dateRangeInput}
                  placeholder="시작일"
                  max={dateTo || undefined}
                />
                <span className={styles.dateRangeSep}>~</span>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className={styles.dateRangeInput}
                  placeholder="종료일"
                  min={dateFrom || undefined}
                />
                {(dateFrom || dateTo) && (
                  <button
                    className={styles.dateRangeClear}
                    onClick={() => { setDateFrom(""); setDateTo(""); }}
                    type="button"
                    title="필터 초기화"
                  >
                    &times;
                  </button>
                )}
              </div>
              <div className={styles.content}>
                {historyLoading ? (
                  <div className={styles.empty}>로딩 중...</div>
                ) : filteredHistory.length === 0 ? (
                  <div className={styles.empty}>
                    <div className={styles.emptyIcon}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
                        <path d="M13.73 21a2 2 0 01-3.46 0" />
                      </svg>
                    </div>
                    {search ? "검색 결과가 없습니다" : "알림이 없습니다"}
                  </div>
                ) : (
                  visibleHistory.map((ev, i) => {
                    const feedbackTitle = (ev.taskTitle || "").replace(/^\[피드백\]\s*/, "");
                    const isClickable = allItems.some((item) => item.id === ev.taskId);

                    return (
                      <div
                        key={`${ev.id}-${ev.action}-${i}`}
                        className={`${styles.notiCard} ${isClickable ? styles.notiClickable : ""}`}
                        onClick={() => isClickable && handleHistoryItemClick(ev)}
                      >
                        <div className={`${styles.notiIcon} ${styles[`notiIcon_${ev.action}`]}`}>
                          {ev.action === "created" && (
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
                              <path d="M12 5v14M5 12h14" />
                            </svg>
                          )}
                          {ev.action === "status_changed" && (
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
                              <polyline points="17 1 21 5 17 9" />
                              <path d="M3 11V9a4 4 0 014-4h14" />
                              <polyline points="7 23 3 19 7 15" />
                              <path d="M21 13v2a4 4 0 01-4 4H3" />
                            </svg>
                          )}
                          {ev.action === "comment_added" && (
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
                              <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
                            </svg>
                          )}
                        </div>
                        <div className={styles.notiBody}>
                          <div className={styles.notiDesc}>
                            {ev.action === "created" && (
                              <span>
                                <strong>{ev.actorName || "익명"}</strong>님이 새 피드백을 등록했습니다
                              </span>
                            )}
                            {ev.action === "status_changed" && (
                              <span>
                                상태가{" "}
                                <span className={`${styles.notiStatusBadge} ${styles[`status_${ev.fromStatus}`]}`}>
                                  {ev.fromStatus === "todo" ? "대기" : ev.fromStatus === "in_progress" ? "진행중" : "완료"}
                                </span>
                                {" → "}
                                <span className={`${styles.notiStatusBadge} ${styles[`status_${ev.toStatus}`]}`}>
                                  {ev.toStatus === "todo" ? "대기" : ev.toStatus === "in_progress" ? "진행중" : "완료"}
                                </span>
                                {" "}(으)로 변경되었습니다
                              </span>
                            )}
                            {ev.action === "comment_added" && (
                              <span>
                                <strong>{ev.actorName || "익명"}</strong>님이 댓글을 남겼습니다
                              </span>
                            )}
                          </div>
                          {ev.action === "comment_added" && !!ev.metadata?.content && (
                            <div className={styles.notiCommentPreview}>
                              {String(ev.metadata.content).slice(0, 100)}
                            </div>
                          )}
                          <div className={styles.notiMeta}>
                            {feedbackTitle && (
                              <span className={styles.notiRef}>{feedbackTitle}</span>
                            )}
                            <span className={styles.notiTime}>{formatTime(ev.createdAt)}</span>
                          </div>
                        </div>
                        {isClickable && (
                          <div className={styles.notiChevron}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
                              <polyline points="9 18 15 12 9 6" />
                            </svg>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
                {hasMoreHistory && (
                  <button
                    className={styles.loadMoreBtn}
                    onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                    type="button"
                  >
                    더 보기 ({filteredHistory.length - visibleHistory.length}개)
                  </button>
                )}
              </div>
              </>
            ) : (
              <>
                <div className={styles.searchBox}>
                  <svg className={styles.searchIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className={styles.searchInput}
                    placeholder="제목·작성자로 검색 (완료 포함)"
                  />
                  {search && (
                    <button className={styles.searchClear} onClick={() => setSearch("")} type="button" title="검색어 지우기">
                      &times;
                    </button>
                  )}
                </div>
                <div className={styles.statusFilter}>
                  <button
                    className={`${styles.filterChip} ${statusFilter === "todo" ? styles.active : ""}`}
                    onClick={() => setStatusFilter("todo")}
                    type="button"
                  >
                    진행전
                    {todoCount > 0 && <span className={styles.filterCount}>{todoCount}</span>}
                  </button>
                  <button
                    className={`${styles.filterChip} ${statusFilter === "in_progress" ? styles.active : ""}`}
                    onClick={() => setStatusFilter("in_progress")}
                    type="button"
                  >
                    진행중
                    {inProgressCount > 0 && <span className={styles.filterCount}>{inProgressCount}</span>}
                  </button>
                  <button
                    className={`${styles.filterChip} ${statusFilter === "done" ? styles.active : ""}`}
                    onClick={() => setStatusFilter("done")}
                    type="button"
                  >
                    완료
                    {doneCount > 0 && <span className={styles.filterCount}>{doneCount}</span>}
                  </button>
                </div>

                <div className={styles.content}>
                  {items.length === 0 ? (
                    <div className={styles.empty}>
                      <div className={styles.emptyIcon}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
                        </svg>
                      </div>
                      {search
                        ? "검색 결과가 없습니다"
                        : tab === "page"
                          ? "이 페이지에 피드백이 없습니다"
                          : "피드백이 없습니다"}
                    </div>
                  ) : (
                    items.map((item) => (
                      <div key={item.id} className={styles.card} onClick={() => handleItemClick(item)}>
                        {attentionTaskIds?.has(item.id) && (
                          <span className={styles.cardAttentionDot} title="확인하지 않은 새 답글이 있습니다" />
                        )}
                        <div className={styles.cardHeader}>
                          <div className={styles.cardInfo}>
                            <div className={styles.cardMeta}>
                              <span className={styles.cardAuthor}>{item.authorName}</span>
                              <span className={styles.cardTime}>{formatTime(item.createdAt)}</span>
                            </div>
                          </div>
                        </div>

                        <div className={styles.cardTitleRow}>
                          <div className={styles.cardTitle}>{item.title.replace(/^\[피드백\]\s*/, "")}</div>
                          {item.isInModal && (
                            <span className={`${styles.locationBadge} ${item.modalTitle ? styles.locationModal : styles.locationButton}`}>
                              {modalTypeLabel({ modalTitle: item.modalTitle })}
                            </span>
                          )}
                        </div>

                        {item.screenshot && (
                          <div className={styles.cardScreenshot}>
                            <img src={item.screenshot} alt="screenshot" />
                          </div>
                        )}

                        {tab === "page" && item.isInModal ? (
                          /* '이 페이지': 페이지 생략, [모달|버튼] 태그 + 트리거 > 제목 */
                          <div className={styles.cardRouteStatic}>
                            <span className={`${styles.routeTag} ${item.modalTitle ? styles.routeTagModal : styles.routeTagButton}`}>
                              {modalTypeLabel({ modalTitle: item.modalTitle })}
                            </span>
                            <span className={styles.cardRoutePath}>
                              {formatModalPath({
                                modalTrigger: item.modalTrigger,
                                modalTitle: item.modalTitle,
                                modalLabel: item.modalLabel,
                              })}
                            </span>
                          </div>
                        ) : tab === "all" && item.feedbackUrl ? (
                          /* '전체': 페이지 > 트리거 > 제목, 클릭 시 페이지로 이동 */
                          <div
                            className={styles.cardRoute}
                            onClick={(e) => {
                              e.stopPropagation();
                              window.location.href = item.feedbackUrl;
                            }}
                            title="페이지로 이동"
                          >
                            <span className={styles.cardRoutePath}>
                              {formatFeedbackRoute(item.feedbackUrl, item.isInModal, {
                                modalTrigger: item.modalTrigger,
                                modalTitle: item.modalTitle,
                                modalLabel: item.modalLabel,
                              })}
                            </span>
                            <svg className={styles.cardRouteIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="12" height="12">
                              <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                              <polyline points="15 3 21 3 21 9" />
                              <line x1="10" y1="14" x2="21" y2="3" />
                            </svg>
                          </div>
                        ) : null}

                        {/* 상태별 시간 */}
                        {(item.startedAt || item.completedAt) && (
                          <div className={styles.cardStatusTime}>
                            {item.startedAt && item.status !== "todo" && (
                              <span>진행 시작: {formatTime(item.startedAt)}</span>
                            )}
                            {item.completedAt && item.status === "done" && (
                              <span>완료: {formatTime(item.completedAt)}</span>
                            )}
                          </div>
                        )}

                        <div className={styles.cardFooter}>
                          <span className={styles.cardReplyDot} />
                          <span className={styles.cardReplyCount}>
                            {item.commentCount}개 답글
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                  {hasMoreItems && (
                    <button
                      className={styles.loadMoreBtn}
                      onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                      type="button"
                    >
                      더 보기 ({filteredItems.length - items.length}개)
                    </button>
                  )}
                </div>
              </>
            )}
          </>
        )}
      </div>

      {/* 이미지 확대 모달 */}
      {lightboxSrc && (
        <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
      )}

      {/* 파일 프리뷰 모달 */}
      {filePreview && (
        <FilePreviewModal
          fileUrl={filePreview.url}
          fileName={filePreview.name}
          fileType={filePreview.type}
          fileSource={filePreview.source}
          onClose={() => setFilePreview(null)}
        />
      )}
    </div>,
    document.body,
  );
}
