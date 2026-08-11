// 도메인 API 함수 — 피드백/코멘트 CRUD + 낙관적 업데이트
import type { FeedbackPayload, FileUploadResult } from "../types";
import { apiFetch, uploadFile, getAuthenticatedUser } from "./client";
import {
  getFeedbacksCacheKey,
  getAllFeedbacksCacheKey,
  getCommentsCacheKey,
  peekCache,
  setCache,
  mutateCache,
  mutateMatchingCaches,
  revalidateCache,
  readWithCache,
  getMatchingKeys,
  subscribeCache,
  getCachedSnapshot,
  invalidateCache,
  type CacheReadOptions,
} from "./cache";

export type { CacheReadOptions };
export {
  subscribeCache,
  getCachedSnapshot,
  invalidateCache,
  getFeedbacksCacheKey,
  getAllFeedbacksCacheKey,
  getCommentsCacheKey,
  getAuthenticatedUser,
  uploadFile,
};
export { getHistoryCacheKey } from "./cache";

// =============================================================================
// 타입 정의
// =============================================================================

export interface FeedbackMarker {
  readonly x: number;
  readonly y: number;
  readonly isFixed?: boolean;
  readonly element?: string;
  readonly boundingBox?: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  readonly anchorSelector?: string;
  readonly offsetRatioX?: number;
  readonly offsetRatioY?: number;
  readonly scrollContainerSelector?: string;
  /** 드롭다운/팝오버가 닫혀 anchorSelector 를 찾을 수 없을 때 마커를 거는 트리거 버튼. */
  readonly triggerAnchorSelector?: string;
  readonly isInModal?: boolean;
  readonly modalSelector?: string;
  /** 모달의 접근성 제목(DialogTitle). 같은 portal 위치의 여러 Dialog를 구분하는 마커 앵커 검증용. */
  readonly modalTitle?: string;
  /** 모달을 연 트리거(버튼) 레이블. 인박스 경로 표시용 ({페이지} > {트리거} > {제목}). */
  readonly modalTrigger?: string;
  /** 원본 코드 파일명 또는 DialogTitle. 빌드 산출물 경로는 저장하지 않는다. */
  readonly modalLabel?: string;
}

export interface FeedbackTask {
  readonly id: string;
  readonly taskNumber: number;
  readonly title: string;
  /** 원문 전체(무손실). title이 프리뷰로 잘린 경우 전문 표시용. (OS가 debug_info.comment 반환) */
  readonly description?: string;
  readonly status: string;
  readonly priority: string;
  readonly feedbackUrl: string;
  readonly feedbackMarker: FeedbackMarker | null;
  readonly authorName?: string | null;
  readonly authorId?: string | null;
  readonly createdAt: string;
  readonly startedAt?: string | null;
  readonly completedAt?: string | null;
  readonly commentCount: number;
  /** 피드백 생성 시 캡처된 스크린샷 URL (OS가 Supabase Storage 업로드 후 반환) */
  readonly screenshotUrl?: string;
  readonly _optimistic?: boolean;
}

export interface CommentReader {
  readonly id: string;
  readonly name: string;
  readonly readAt: string;
}

export interface FeedbackComment {
  readonly id: string;
  readonly content: string;
  readonly authorName: string;
  readonly authorId?: string;
  readonly imageUrl?: string;
  /** 그룹 사진 — 첨부 이미지 전체(첫 장은 imageUrl 과 동일). 구버전 OS 응답에는 없다. */
  readonly imageUrls?: readonly string[];
  readonly fileUrl?: string;
  readonly fileName?: string;
  readonly fileType?: string;
  readonly fileSize?: number;
  readonly fileSource?: "supabase" | "google_drive";
  readonly createdAt: string;
  /** 'system' = 임패커스 자동 안내(완료 확인 등) — 사람 메시지가 아니라 안내 UI로 표시. */
  readonly authorType?: "user" | "operator" | "system";
  readonly readers?: CommentReader[];
  /** 낙관적 임시 코멘트 — 서버 저장 전(첨부 업로드 중 포함) 상태. */
  readonly pending?: boolean;
}

export interface OperatorUnreadComment {
  readonly id: string;
  readonly taskId: string;
  readonly content: string;
  readonly authorName: string;
  /** 'system' = 임패커스 자동 안내. 운영자 답변과 같은 경로로 알림/뱃지에 실린다. */
  readonly authorType: "operator" | "system";
  readonly agentConfidence: null;
  readonly createdAt: string;
}

export interface OperatorUnreadResponse {
  readonly comments: readonly OperatorUnreadComment[];
  readonly now: string;
}

export interface HistoryEvent {
  readonly id: string;
  readonly taskId: string;
  readonly action: "created" | "status_changed" | "comment_added";
  readonly fromStatus?: string | null;
  readonly toStatus?: string | null;
  readonly actorName?: string | null;
  readonly actorId?: string | null;
  readonly metadata?: Record<string, unknown> | null;
  readonly createdAt: string;
  readonly taskTitle?: string | null;
  readonly feedbackUrl?: string | null;
}

// API 응답 바디 타입
interface SubmitFeedbackResponse {
  taskId?: string;
  taskNumber?: number;
}

interface PostCommentResponse {
  comment: FeedbackComment;
}

interface FeedbackListResponse {
  tasks: FeedbackTask[];
}

interface CommentListResponse {
  comments: FeedbackComment[];
}

interface OperatorUnreadApiResponse {
  comments: OperatorUnreadComment[];
  now?: string;
}

interface HistoryApiResponse {
  events: HistoryEvent[];
}

interface MarkReadApiResponse {
  marked?: number;
}

// =============================================================================
// 피드백 조회
// =============================================================================

export async function fetchFeedbacks(
  endpoint: string,
  url: string,
  options: CacheReadOptions = {},
): Promise<FeedbackTask[]> {
  const cacheKey = getFeedbacksCacheKey(url);
  return readWithCache(cacheKey, async (): Promise<FeedbackTask[]> => {
    const res = await apiFetch(`${endpoint}?url=${encodeURIComponent(url)}`);
    const data = await res.json() as FeedbackListResponse;
    return data.tasks ?? [];
  }, options);
}

export async function fetchAllFeedbacks(
  endpoint: string,
  options: CacheReadOptions = {},
): Promise<FeedbackTask[]> {
  const cacheKey = getAllFeedbacksCacheKey();
  return readWithCache(cacheKey, async (): Promise<FeedbackTask[]> => {
    const res = await apiFetch(`${endpoint}?url=__all__`);
    const data = await res.json() as FeedbackListResponse;
    return data.tasks ?? [];
  }, options);
}

export async function revalidateFeedbacks(endpoint: string, url: string): Promise<FeedbackTask[]> {
  const cacheKey = getFeedbacksCacheKey(url);
  return revalidateCache(cacheKey, async (): Promise<FeedbackTask[]> => {
    const res = await apiFetch(`${endpoint}?url=${encodeURIComponent(url)}`);
    const data = await res.json() as FeedbackListResponse;
    return data.tasks ?? [];
  });
}

export async function revalidateAllFeedbacks(endpoint: string): Promise<FeedbackTask[]> {
  const cacheKey = getAllFeedbacksCacheKey();
  return revalidateCache(cacheKey, async (): Promise<FeedbackTask[]> => {
    const res = await apiFetch(`${endpoint}?url=__all__`);
    const data = await res.json() as FeedbackListResponse;
    return data.tasks ?? [];
  });
}

// =============================================================================
// 코멘트 조회
// =============================================================================

export async function fetchComments(
  endpoint: string,
  taskId: string,
  options: CacheReadOptions = {},
): Promise<FeedbackComment[]> {
  const cacheKey = getCommentsCacheKey(taskId);
  return readWithCache(cacheKey, async (): Promise<FeedbackComment[]> => {
    const res = await apiFetch(`${endpoint}/${taskId}/comments`);
    const data = await res.json() as CommentListResponse;
    return data.comments ?? [];
  }, options);
}

export async function revalidateComments(
  endpoint: string,
  taskId: string,
): Promise<FeedbackComment[]> {
  const cacheKey = getCommentsCacheKey(taskId);
  return revalidateCache(cacheKey, async (): Promise<FeedbackComment[]> => {
    const res = await apiFetch(`${endpoint}/${taskId}/comments`);
    const data = await res.json() as CommentListResponse;
    return data.comments ?? [];
  });
}

// =============================================================================
// Unread 폴러용 조회
// =============================================================================

export async function fetchOperatorUnread(
  endpoint: string,
  url: string,
  since?: string,
): Promise<OperatorUnreadResponse> {
  const params = new URLSearchParams({ url });
  if (since) params.set("since", since);
  const res = await apiFetch(`${endpoint}/operator-unread?${params.toString()}`);
  const data = await res.json() as OperatorUnreadApiResponse;
  return {
    comments: data.comments ?? [],
    now: data.now ?? new Date().toISOString(),
  };
}

// =============================================================================
// 히스토리 조회
// =============================================================================

export async function fetchHistory(
  endpoint: string,
  options: { readonly since?: string; readonly date?: string; readonly limit?: number } = {},
): Promise<HistoryEvent[]> {
  const params = new URLSearchParams();
  if (options.since) params.set("since", options.since);
  if (options.date) params.set("date", options.date);
  if (options.limit) params.set("limit", String(options.limit));
  const qs = params.toString();
  const url = `${endpoint}/history${qs ? `?${qs}` : ""}`;
  const res = await apiFetch(url);
  const data = await res.json() as HistoryApiResponse;
  return data.events ?? [];
}

// =============================================================================
// 낙관적 업데이트 헬퍼 (내부)
// =============================================================================

function revalidateCachedFeedbackLists(endpoint: string): void {
  const feedbackKeys = getMatchingKeys("feedbacks:");
  feedbackKeys.forEach((key) => {
    const url = key.replace("feedbacks:", "");
    if (url === "__all__") {
      void revalidateAllFeedbacks(endpoint).catch(() => {});
    } else {
      void revalidateFeedbacks(endpoint, url).catch(() => {});
    }
  });
}

// =============================================================================
// 피드백 제출 (낙관적 업데이트)
// =============================================================================

export interface SubmitFeedbackPayload extends FeedbackPayload {
  readonly feedbackUrl?: string;
  readonly feedbackMarker?: Record<string, unknown>;
  readonly authorName?: string;
  readonly authorId?: string;
  readonly debugInfo?: Record<string, unknown>;
  readonly debug_info?: Record<string, unknown>;
}

export async function submitFeedback(
  endpoint: string,
  payload: SubmitFeedbackPayload,
): Promise<{ taskId?: string; taskNumber?: number }> {
  const tempTaskId = `temp-task-${Date.now()}`;
  const { feedbackUrl } = payload;
  const marker = (payload.feedbackMarker ?? null) as FeedbackMarker | null;
  const previousFeedbacks = feedbackUrl
    ? peekCache<FeedbackTask[]>(getFeedbacksCacheKey(feedbackUrl)) ?? []
    : null;
  const previousAll = peekCache<FeedbackTask[]>(getAllFeedbacksCacheKey());

  const optimisticTask: FeedbackTask | null = feedbackUrl
    ? {
        id: tempTaskId,
        taskNumber: 0,
        title: payload.title,
        status: "todo",
        priority: payload.priority,
        feedbackUrl,
        feedbackMarker: marker,
        createdAt: new Date().toISOString(),
        commentCount: 0,
        authorName: payload.authorName ?? null,
        authorId: payload.authorId ?? null,
        _optimistic: true,
      }
    : null;

  if (feedbackUrl && optimisticTask) {
    setCache(getFeedbacksCacheKey(feedbackUrl), [optimisticTask, ...(previousFeedbacks ?? [])]);
    if (previousAll) {
      setCache(getAllFeedbacksCacheKey(), [optimisticTask, ...previousAll]);
    }
  }

  try {
    const res = await apiFetch(endpoint, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    const result = await res.json().catch((): SubmitFeedbackResponse => ({})) as SubmitFeedbackResponse;

    if (feedbackUrl && optimisticTask) {
      const finalTask: FeedbackTask = {
        ...optimisticTask,
        id: result.taskId ?? tempTaskId,
        taskNumber: result.taskNumber ?? 0,
        _optimistic: false,
      };
      mutateCache<FeedbackTask[]>(getFeedbacksCacheKey(feedbackUrl), (current) =>
        (current ?? []).map((item) => (item.id === tempTaskId ? finalTask : item)),
      );
      if (previousAll) {
        mutateCache<FeedbackTask[]>(getAllFeedbacksCacheKey(), (current) =>
          (current ?? []).map((item) => (item.id === tempTaskId ? finalTask : item)),
        );
      }
      void revalidateFeedbacks(endpoint, feedbackUrl).catch(() => {});
      if (previousAll) void revalidateAllFeedbacks(endpoint).catch(() => {});
    }

    return result;
  } catch (error) {
    if (feedbackUrl && previousFeedbacks) {
      setCache(getFeedbacksCacheKey(feedbackUrl), previousFeedbacks);
    }
    if (previousAll) {
      setCache(getAllFeedbacksCacheKey(), previousAll);
    }
    throw error;
  }
}

// =============================================================================
// 코멘트 추가 (낙관적 업데이트)
// =============================================================================

export function incrementCommentCount(taskId: string, delta: number): void {
  mutateMatchingCaches<FeedbackTask[]>("feedbacks:", (items) =>
    items.map((item) =>
      item.id === taskId
        ? { ...item, commentCount: Math.max(0, (item.commentCount ?? 0) + delta) }
        : item,
    ),
  );
}

/** 낙관적 임시 코멘트 초안 — 첨부는 아직 업로드 전이라 URL 없이 메타만 갖는다. */
export interface PendingCommentDraft {
  readonly content: string;
  readonly authorName: string;
  readonly authorId?: string;
  readonly screenshot?: string;
  readonly fileName?: string;
  readonly fileType?: string;
  readonly fileSize?: number;
}

let pendingSeq = 0;

/**
 * 파일 업로드 **전에** 임시 코멘트를 캐시에 넣어 즉시 노출한다.
 * 반환된 tempId 를 postComment 에 넘기면 서버 응답으로 교체되고, 실패 시 제거된다.
 */
export function addPendingComment(taskId: string, draft: PendingCommentDraft): string {
  const tempId = `temp-${Date.now()}-${pendingSeq++}`;
  const cacheKey = getCommentsCacheKey(taskId);
  const current = peekCache<FeedbackComment[]>(cacheKey) ?? [];
  const tempComment: FeedbackComment = {
    id: tempId,
    content: draft.content,
    authorName: draft.authorName,
    authorId: draft.authorId,
    imageUrl: draft.screenshot ?? undefined,
    fileName: draft.fileName,
    fileType: draft.fileType,
    fileSize: draft.fileSize,
    createdAt: new Date().toISOString(),
    pending: true,
  };
  setCache(cacheKey, [...current, tempComment]);
  incrementCommentCount(taskId, 1);
  return tempId;
}

/** 전송을 시작하지 못했을 때 임시 코멘트를 되돌린다. */
export function removePendingComment(taskId: string, tempId: string): void {
  const cacheKey = getCommentsCacheKey(taskId);
  const current = peekCache<FeedbackComment[]>(cacheKey);
  if (!current?.some((comment) => comment.id === tempId)) return;
  setCache(cacheKey, current.filter((comment) => comment.id !== tempId));
  incrementCommentCount(taskId, -1);
}

export async function postComment(
  endpoint: string,
  taskId: string,
  content: string,
  authorName: string,
  authorId?: string,
  screenshot?: string,
  file?: FileUploadResult,
  /** addPendingComment 로 미리 띄워 둔 임시 코멘트 ID. 있으면 새로 만들지 않고 재사용한다. */
  pendingTempId?: string,
): Promise<FeedbackComment> {
  const cacheKey = getCommentsCacheKey(taskId);
  const tempId = pendingTempId ?? `temp-${Date.now()}-${pendingSeq++}`;
  // 롤백 기준에서 임시 코멘트는 제외 — 실패 시 말풍선이 남지 않도록.
  const previousComments = (peekCache<FeedbackComment[]>(cacheKey) ?? [])
    .filter((comment) => comment.id !== tempId);

  if (pendingTempId) {
    // 이미 노출 중인 임시 코멘트에 업로드 완료된 첨부 정보만 채운다.
    mutateCache<FeedbackComment[]>(cacheKey, (current) =>
      (current ?? []).map((comment) =>
        comment.id === tempId
          ? {
              ...comment,
              fileUrl: file?.url,
              fileName: file?.fileName ?? comment.fileName,
              fileType: file?.fileType ?? comment.fileType,
              fileSize: file?.fileSize ?? comment.fileSize,
              fileSource: file?.fileSource,
            }
          : comment,
      ),
    );
  } else {
    const tempComment: FeedbackComment = {
      id: tempId,
      content,
      authorName,
      authorId,
      imageUrl: screenshot ?? undefined,
      fileUrl: file?.url,
      fileName: file?.fileName,
      fileType: file?.fileType,
      fileSize: file?.fileSize,
      fileSource: file?.fileSource,
      createdAt: new Date().toISOString(),
      pending: true,
    };
    setCache(cacheKey, [...previousComments, tempComment]);
    incrementCommentCount(taskId, 1);
  }

  try {
    const res = await apiFetch(`${endpoint}/${taskId}/comments`, {
      method: "POST",
      body: JSON.stringify({
        content,
        authorName,
        authorId,
        screenshot,
        ...(file && {
          fileUrl: file.url,
          fileName: file.fileName,
          fileType: file.fileType,
          fileSize: file.fileSize,
          fileSource: file.fileSource,
        }),
      }),
    });
    const data = await res.json() as PostCommentResponse;
    const serverComment = data.comment;
    mutateCache<FeedbackComment[]>(cacheKey, (current) => {
      const list = current ?? [];
      // 전송 중 캐시가 갱신돼 임시 코멘트가 사라졌으면 그냥 덧붙인다.
      return list.some((comment) => comment.id === tempId)
        ? list.map((comment) => (comment.id === tempId ? serverComment : comment))
        : [...list, serverComment];
    });
    void revalidateComments(endpoint, taskId);
    revalidateCachedFeedbackLists(endpoint);
    return serverComment;
  } catch (error) {
    setCache(cacheKey, previousComments);
    incrementCommentCount(taskId, -1);
    throw error;
  }
}

// =============================================================================
// 코멘트 읽음 마킹
// =============================================================================

export async function markCommentsRead(
  endpoint: string,
  taskId: string,
  commentIds: readonly string[],
  reader: { readonly id: string; readonly name: string },
): Promise<{ marked: number }> {
  if (!commentIds.length || !reader.id || !reader.name) {
    return { marked: 0 };
  }

  const cacheKey = getCommentsCacheKey(taskId);
  const readAt = new Date().toISOString();

  mutateCache<FeedbackComment[]>(cacheKey, (current) =>
    (current ?? []).map((comment) => {
      if (!commentIds.includes(comment.id)) return comment;
      const existing = comment.readers ?? [];
      if (existing.some((r) => r.id === reader.id)) return comment;
      return {
        ...comment,
        readers: [...existing, { id: reader.id, name: reader.name, readAt }],
      };
    }),
  );

  const res = await apiFetch(`${endpoint}/${taskId}/comments/reads`, {
    method: "POST",
    body: JSON.stringify({
      commentIds,
      readerId: reader.id,
      readerName: reader.name,
    }),
  });
  const data = await res.json().catch((): MarkReadApiResponse => ({})) as MarkReadApiResponse;
  return { marked: data.marked ?? 0 };
}
