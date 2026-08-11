// 피드백 저장소 어댑터 — DebugWidget 의 네트워크/캐시 의존을 한 곳으로 모은다.
//
// 호스티드 모드는 core/api 를 그대로 호출하고(createHostedFeedbackStore),
// 로컬 모드는 같은 인터페이스를 네트워크 없이 구현한다(createLocalFeedbackStore).
// UI·인터랙션 구현은 DebugWidget 하나뿐이고, 바뀌는 것은 이 어댑터뿐이다.

import {
  submitFeedback,
  fetchFeedbacks,
  fetchAllFeedbacks,
  fetchComments,
  postComment,
  addPendingComment,
  uploadFile,
  getCachedSnapshot,
  subscribeCache,
  getCommentsCacheKey,
  getFeedbacksCacheKey,
  incrementCommentCount,
  fetchHistory,
  markCommentsRead,
  getAuthenticatedUser,
  type CacheReadOptions,
  type FeedbackTask,
  type FeedbackComment,
  type HistoryEvent,
  type PendingCommentDraft,
  type SubmitFeedbackPayload,
} from "./api";
import {
  startOperatorReplyPoller,
  type AgentReplyPollerHandle,
  type StartOperatorPollerOptions,
} from "./agent-reply-poller";
import type { FeedbackUser, FileUploadResult } from "./types";

export type {
  CacheReadOptions,
  FeedbackTask,
  FeedbackComment,
  HistoryEvent,
  PendingCommentDraft,
  SubmitFeedbackPayload,
};

/** 어댑터가 지원하는 기능 — false 인 경로는 DebugWidget 이 아예 실행/렌더하지 않는다. */
export interface FeedbackStoreCapabilities {
  /** 수신함·히스토리·코멘트 스레드·담당자 응답 폴러 (= OS 요청 전반) */
  readonly inbox: boolean;
}

/**
 * DebugWidget 이 쓰는 모든 네트워크/캐시 연산.
 * 시그니처는 core/api 원본과 1:1 로 같다 (endpoint 를 그대로 받는다).
 */
export interface FeedbackStore {
  readonly capabilities: FeedbackStoreCapabilities;

  submitFeedback(
    endpoint: string,
    payload: SubmitFeedbackPayload,
  ): Promise<{ taskId?: string; taskNumber?: number }>;

  fetchFeedbacks(
    endpoint: string,
    url: string,
    options?: CacheReadOptions,
  ): Promise<FeedbackTask[]>;

  fetchAllFeedbacks(endpoint: string, options?: CacheReadOptions): Promise<FeedbackTask[]>;

  fetchComments(
    endpoint: string,
    taskId: string,
    options?: CacheReadOptions,
  ): Promise<FeedbackComment[]>;

  postComment(
    endpoint: string,
    taskId: string,
    content: string,
    authorName: string,
    authorId?: string,
    screenshot?: string,
    file?: FileUploadResult,
    pendingTempId?: string,
  ): Promise<FeedbackComment>;

  addPendingComment(taskId: string, draft: PendingCommentDraft): string;

  uploadFile(
    endpoint: string,
    file: File,
    context: "feedback" | "comment",
    taskId?: string,
  ): Promise<FileUploadResult>;

  fetchHistory(
    endpoint: string,
    options?: { readonly since?: string; readonly date?: string; readonly limit?: number },
  ): Promise<HistoryEvent[]>;

  markCommentsRead(
    endpoint: string,
    taskId: string,
    commentIds: readonly string[],
    reader: { readonly id: string; readonly name: string },
  ): Promise<{ marked: number }>;

  startOperatorReplyPoller(options: StartOperatorPollerOptions): AgentReplyPollerHandle;

  getAuthenticatedUser(): FeedbackUser | null;

  getCachedSnapshot<T>(key: string): T | null;

  subscribeCache<T>(key: string, listener: (data: T) => void): () => void;

  getCommentsCacheKey(taskId: string): string;

  getFeedbacksCacheKey(url: string): string;

  incrementCommentCount(taskId: string, delta: number): void;
}

/**
 * 호스티드(임패커스 OS) 어댑터.
 * core/api 함수를 그대로 참조만 한다 — 래핑도 변형도 없으므로 기존 동작과 동일하다.
 */
export function createHostedFeedbackStore(): FeedbackStore {
  return {
    capabilities: { inbox: true },
    submitFeedback,
    fetchFeedbacks,
    fetchAllFeedbacks,
    fetchComments,
    postComment,
    addPendingComment,
    uploadFile,
    fetchHistory,
    markCommentsRead,
    startOperatorReplyPoller,
    getAuthenticatedUser,
    getCachedSnapshot,
    subscribeCache,
    getCommentsCacheKey,
    getFeedbacksCacheKey,
    incrementCommentCount,
  };
}
