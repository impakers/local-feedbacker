// =============================================================================
// @impakers/debug — Operator Reply Poller
// =============================================================================
//
// 담당자(operator)가 쓴 피드백 응답 코멘트를 5초 간격으로 풀링.
// Supabase Realtime 대신 가벼운 폴링으로 구현.
// - 탭이 보이는 동안만 동작, hide 시 일시중지
// - localStorage에 feedbackUrl별 lastSeenAt 저장 (동일 유저/브라우저 dedup)
// - 최근 60초 이내 본 comment id 캐시 (clock skew 대응)

import {
  fetchOperatorUnread,
  type OperatorUnreadComment,
} from "./api";
import { storage, KEYS } from "./storage";
const SEEN_IDS_TTL = 60_000;
const DEFAULT_INTERVAL_MS = 5_000;

export interface AgentReplyPollerHandle {
  stop: () => void;
  flushNow: () => Promise<void>;
}

// 담당자(operator) 응답 폴러.
export interface StartOperatorPollerOptions {
  endpoint: string;
  feedbackUrl: string;
  onOperatorReply: (reply: OperatorUnreadComment) => void;
  /** 기본 5000ms */
  intervalMs?: number;
}

function readOperatorLastSeen(url: string): string | null {
  return storage.get(KEYS.OPERATOR_LAST_SEEN(url));
}

function writeOperatorLastSeen(url: string, iso: string): void {
  storage.set(KEYS.OPERATOR_LAST_SEEN(url), iso);
}

export function startOperatorReplyPoller(
  options: StartOperatorPollerOptions,
): AgentReplyPollerHandle {
  const { endpoint, feedbackUrl, onOperatorReply } = options;
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const seenIds = new Map<string, number>();

  let since = readOperatorLastSeen(feedbackUrl);

  const pruneSeen = () => {
    const now = Date.now();
    for (const [id, seenAt] of seenIds) {
      if (now - seenAt > SEEN_IDS_TTL) seenIds.delete(id);
    }
  };

  const poll = async (): Promise<void> => {
    if (stopped) return;
    if (typeof document !== "undefined" && document.visibilityState !== "visible") {
      return;
    }
    try {
      const res = await fetchOperatorUnread(endpoint, feedbackUrl, since ?? undefined);
      pruneSeen();

      for (const comment of res.comments) {
        if (seenIds.has(comment.id)) continue;
        seenIds.set(comment.id, Date.now());
        try {
          onOperatorReply(comment);
        } catch (err) {
          console.warn("[impakers-debug] onOperatorReply handler threw:", err);
        }
      }

      const lastCreatedAt =
        res.comments.length > 0
          ? res.comments[res.comments.length - 1].createdAt
          : res.now;
      since = lastCreatedAt;
      writeOperatorLastSeen(feedbackUrl, lastCreatedAt);
    } catch (err) {
      if (process.env.NODE_ENV === "development") {
        console.debug("[impakers-debug] operator-unread poll failed:", err);
      }
    }
  };

  const schedule = (delay: number) => {
    if (stopped) return;
    timer = setTimeout(async () => {
      await poll();
      schedule(intervalMs);
    }, delay);
  };

  const handleVisibility = () => {
    if (document.visibilityState === "visible" && !stopped) {
      if (timer) clearTimeout(timer);
      schedule(0);
    }
  };

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", handleVisibility);
  }

  schedule(0);

  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibility);
      }
    },
    flushNow: async () => {
      await poll();
    },
  };
}
