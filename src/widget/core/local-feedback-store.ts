// 로컬(zero-backend) 피드백 저장소 어댑터.
//
// 네트워크 호출이 한 줄도 없다. 제출은 서버로 가는 대신 config.onSubmit 으로
// 그대로 전달되고, 호출자가 그것으로 에이전트용 프롬프트를 만든다.
// 나머지 연산은 DebugWidget 이 capabilities.inbox === false 로 호출하지 않는
// 경로들이라 빈 결과를 돌려주는 것으로 충분하다(던지지 않는다).
//
// config.buildPrompt 를 주면 만들어진 프롬프트 원문을 localStorage 에 쌓아 둔다.
// 마커를 다시 눌렀을 때 뭐라고 썼는지 되짚어 보거나(getEntryText), 여러 화면에
// 남긴 것을 한 번에 복사하기(copyAll) 위한 것이다. 프롬프트 문법 자체는 여전히
// 호출자(oss/)의 몫이고 여기서는 문자열로만 다룬다.

import type {
  FeedbackComment,
  FeedbackStore,
  FeedbackTask,
  HistoryEvent,
  SubmitFeedbackPayload,
} from "./feedback-store";
import { getCommentsCacheKey, getFeedbacksCacheKey } from "./api";
import { storage, KEYS } from "./storage";
import type { FileUploadResult } from "./types";
import { buildZip, downloadBlob, type ZipEntry } from "../utils/zip";

/** 로컬 제출 1건. 마커 id 로 되찾을 수 있게 id 를 마커와 공유한다. */
export interface LocalFeedbackEntry {
  id: string;
  /** 에이전트에 붙여 넣을 프롬프트 원문. */
  text: string;
  /** 목록/구분선에 쓸 짧은 이름 (제출 제목에서 뽑는다). */
  label: string;
  url: string;
  timestamp: number;
  /** 제출 시 캡처된 화면(JPEG dataURL). 용량 압박 때 가장 먼저 버려진다. */
  screenshot?: string;
}

const FILENAME_MAX = 60;

/** 내보낸 zip 파일 이름에 붙일 `2026-08-11-1432` 꼴 시각. */
function exportStamp(): string {
  const now = new Date();
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}

/** 파일 이름으로 쓸 수 없는 문자를 걷어낸다. 비면 기본 이름으로 떨어진다. */
export function sanitizeFilename(label: string): string {
  const cleaned = label
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned ? cleaned.slice(0, FILENAME_MAX).trim() : "feedback";
}

/** 오래된 항목부터 버린다 — localStorage 는 origin 당 한도가 있다. */
const MAX_ENTRIES = 200;

/** copyAll 이 항목 사이에 끼우는 구분선. 에이전트가 경계를 헷갈리지 않을 만큼 뚜렷하게. */
const ENTRY_SEPARATOR = "\n\n---\n\n";

const LABEL_MAX = 60;

function toLabel(payload: SubmitFeedbackPayload): string {
  const raw = (payload.title || payload.description || "").trim().replace(/\s+/g, " ");
  if (!raw) return "피드백";
  return raw.length > LABEL_MAX ? `${raw.slice(0, LABEL_MAX)}…` : raw;
}

function readEntries(): LocalFeedbackEntry[] {
  const stored = storage.get(KEYS.LOCAL_ENTRIES());
  if (!stored) return [];
  try {
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? (parsed as LocalFeedbackEntry[]) : [];
  } catch {
    return [];
  }
}

function writeEntries(entries: readonly LocalFeedbackEntry[]): void {
  const capped = entries.slice(-MAX_ENTRIES);
  if (storage.trySet(KEYS.LOCAL_ENTRIES(), JSON.stringify(capped))) return;

  // 용량 초과. 자리를 차지하는 건 거의 항상 스크린샷이고, 정작 중요한 건 프롬프트
  // 원문이다 — 제출을 통째로 잃는 대신 오래된 절반의 이미지만 버리고 한 번 더 시도한다.
  // (`screenshot: undefined` 는 JSON.stringify 가 알아서 빼 준다)
  const half = Math.ceil(capped.length / 2);
  const degraded = capped.map((entry, index) => (index < half ? { ...entry, screenshot: undefined } : entry));
  storage.trySet(KEYS.LOCAL_ENTRIES(), JSON.stringify(degraded));
}

export interface LocalFeedbackStoreConfig {
  /** 제출 시점에 동기 호출된다. 호스티드 모드였다면 API 로 보냈을 데이터 그대로. */
  onSubmit: (payload: SubmitFeedbackPayload) => void;
  /**
   * 주면 제출 때마다 프롬프트를 만들어 보관한다(마커 되짚기 · 전체 복사용).
   * 없으면 이 어댑터는 예전처럼 아무것도 쌓지 않는다.
   */
  buildPrompt?: (payload: SubmitFeedbackPayload) => string;
}

/**
 * FeedbackStore + 로컬 전용 연산.
 *
 * 아래 로컬 전용 연산은 **FeedbackStore 에 넣지 않는다** — 호스티드 어댑터에는 쓸 데가 없어서
 * 인터페이스에 올리면 구현체마다 빈 스텁을 달아야 한다.
 */
export interface LocalFeedbackStore extends FeedbackStore {
  /** 마커 id 로 프롬프트 원문을 되찾는다. 없으면(오래돼 잘렸거나 다른 세션) null. */
  getEntryText(id: string): string | null;
  /** 마커 id 로 캡처 화면(dataURL)을 되찾는다. 목록 요약에는 싣지 않는다 — 필요할 때만. */
  getEntryScreenshot(id: string): string | null;
  /** 지금까지 쌓인 제출 수. */
  getPendingCount(): number;
  /** 전체를 하나로 이어 붙여 클립보드에 쓰고, 그 문자열을 돌려준다. */
  copyAll(): Promise<string>;
  /** 쌓인 제출을 전부 버린다. */
  clearAll(): void;
  /** 저장된 항목 요약 목록(최신순 아님, 저장 순서 그대로) — Feedback List 패널용. */
  listEntries(): { id: string; label: string; timestamp: number; hasScreenshot: boolean }[];
  /** 항목 하나만 삭제. clearAll과 달리 확인 없이 즉시 지운다(낮은 위험). */
  removeEntry(id: string): void;
  /** 항목 수가 바뀌면 알려준다 (core/api 의 subscribeCache 와 같은 모양). */
  subscribe(listener: () => void): () => void;
  /** 내보내기를 할 수 있는지 — 평범한 다운로드라 사실상 언제나 true. */
  supportsExport(): boolean;
  /**
   * 항목마다 `.md` 한 개(+스크린샷이 있으면 같은 이름의 `.jpg`)를 담은 zip 을
   * 다운로드한다. 폴더 선택도 권한 대화상자도 없다.
   * 빈 목록·실패는 `{ok:false}` 로 돌아온다 — 던지지 않는다.
   */
  exportAll(): Promise<{ ok: boolean; message?: string }>;
}

export function createLocalFeedbackStore(config: LocalFeedbackStoreConfig): LocalFeedbackStore {
  const listeners = new Set<() => void>();

  function emit(): void {
    listeners.forEach((listener) => listener());
  }

  return {
    capabilities: { inbox: false },

    submitFeedback: async (_endpoint: string, payload: SubmitFeedbackPayload) => {
      // id 를 여기서 먼저 만든다 — DebugWidget 이 이걸 마커 id 로 그대로 쓰기 때문에
      // 나중에 그 마커를 눌렀을 때 아래 항목을 찾아올 수 있다.
      const id = `local-${Date.now()}`;
      config.onSubmit(payload);

      if (config.buildPrompt) {
        writeEntries([
          ...readEntries(),
          {
            id,
            text: config.buildPrompt(payload),
            label: toLabel(payload),
            url: payload.metadata.url || payload.feedbackUrl || "",
            timestamp: Date.now(),
            screenshot: payload.screenshot,
          },
        ]);
        emit();
      }

      return { taskId: id };
    },

    getEntryText: (id: string) => readEntries().find((entry) => entry.id === id)?.text ?? null,

    getEntryScreenshot: (id: string) => readEntries().find((entry) => entry.id === id)?.screenshot ?? null,

    getPendingCount: () => readEntries().length,

    copyAll: async () => {
      // 프롬프트 첫 줄이 이미 `## 피드백: "..."` 이라 머리말이 같은 정보를 반복한다.
      const combined = readEntries().map((entry) => entry.text).join(ENTRY_SEPARATOR);
      try {
        await navigator.clipboard.writeText(combined);
      } catch {
        // 클립보드 거부(권한·비보안 컨텍스트) — 호출자가 문자열로 직접 처리할 수 있다.
      }
      return combined;
    },

    clearAll: () => {
      writeEntries([]);
      emit();
    },

    // 원문(text)도 스크린샷도 요약에는 싣지 않는다 — 있다/없다만 알려주고
    // 실물은 getEntryText/getEntryScreenshot 으로 펼칠 때만 읽는다.
    listEntries: () => readEntries().map(({ id, label, timestamp, screenshot }) => ({
      id,
      label,
      timestamp,
      hasScreenshot: Boolean(screenshot),
    })),

    removeEntry: (id: string) => {
      writeEntries(readEntries().filter((entry) => entry.id !== id));
      emit();
    },

    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return (): void => {
        listeners.delete(listener);
      };
    },

    // 평범한 다운로드라 못 하는 브라우저가 없다. 이 값은 이제 항상 참이지만,
    // 호출부가 버튼을 감추는 분기를 그대로 두고 있어 인터페이스는 유지한다.
    supportsExport: () => typeof window !== "undefined" && typeof URL.createObjectURL === "function",

    exportAll: async () => {
      const entries = readEntries();
      if (entries.length === 0) return { ok: false, message: "empty" };

      try {
        const files: ZipEntry[] = [];
        const encoder = new TextEncoder();
        let index = 0;
        for (const entry of entries) {
          index += 1;
          const base = `${String(index).padStart(3, "0")}-${sanitizeFilename(entry.label)}`;
          files.push({ name: `${base}.md`, data: encoder.encode(entry.text) });

          if (entry.screenshot) {
            // dataURL → 바이트는 fetch 가 표준으로 해 준다(직접 base64 를 풀지 않는다).
            const buffer = await (await fetch(entry.screenshot)).arrayBuffer();
            files.push({ name: `${base}.jpg`, data: new Uint8Array(buffer) });
          }
        }

        downloadBlob(buildZip(files), `local-feedback-${exportStamp()}.zip`);
        return { ok: true };
      } catch {
        // 여기까지 오는 건 스크린샷 디코딩 실패 정도다 — 폴더 권한 같은 건 이제 없다.
        return { ok: false, message: "failed" };
      }
    },

    fetchFeedbacks: async (): Promise<FeedbackTask[]> => [],
    fetchAllFeedbacks: async (): Promise<FeedbackTask[]> => [],
    fetchComments: async (): Promise<FeedbackComment[]> => [],
    fetchHistory: async (): Promise<HistoryEvent[]> => [],

    postComment: async (
      _endpoint: string,
      _taskId: string,
      content: string,
      authorName: string,
      authorId?: string,
    ): Promise<FeedbackComment> => ({
      id: `local-comment-${Date.now()}`,
      content,
      authorName,
      authorId,
      createdAt: new Date().toISOString(),
    }),

    addPendingComment: () => `local-pending-${Date.now()}`,

    // 업로드할 곳이 없다. 파일 메타만 되돌려 준다(빈 url = 열 수 있는 링크 없음).
    uploadFile: async (
      _endpoint: string,
      file: File,
    ): Promise<FileUploadResult> => ({
      url: "",
      fileName: file.name,
      fileType: file.type,
      fileSize: file.size,
      fileSource: "supabase",
    }),

    markCommentsRead: async () => ({ marked: 0 }),

    startOperatorReplyPoller: () => ({
      stop: () => {},
      flushNow: async () => {},
    }),

    // 로컬 모드에는 인증이 없다.
    getAuthenticatedUser: () => null,

    getCachedSnapshot: () => null,
    subscribeCache: () => () => {},

    // 키 생성기는 순수 함수라 그대로 쓴다.
    getCommentsCacheKey,
    getFeedbacksCacheKey,

    incrementCommentCount: () => {},
  };
}
