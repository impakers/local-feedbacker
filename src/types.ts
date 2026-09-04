/** Languages shipped by the local-first feedback experience. */
export type FeedbackLanguage = "en" | "es" | "zh-CN" | "ko";

/** Structured data passed to an explicitly configured local bridge. */
export interface LocalFeedbackCapture {
  prompt: string;
  feedback: string;
  url: string;
}

/** A completed local feedback item that a host app may handle itself. */
export interface LocalFeedbackSubmission extends LocalFeedbackCapture {
  /** Present only while screenshot capture is enabled and succeeds. */
  screenshot?: string;
}

/** Result returned by a user-owned local bridge callback. */
export interface LocalBridgeResult {
  ok: boolean;
  message?: string;
}

/**
 * Configuration for the zero-backend feedback widget.
 *
 * `onSendToBridge` is deliberately opt-in: the widget never discovers or
 * contacts a local service by itself.
 */
export interface LocalFeedbackConfig {
  language?: FeedbackLanguage;
  getLanguage?: () => string | undefined;
  onCopy?: (prompt: string) => void;
  /**
   * Called after a feedback item is created so the host can use any transport
   * it wants (for example `console.log` or `fetch`). Rejections are ignored so
   * a host integration never blocks local copy or storage.
   */
  onSubmit?: (submission: LocalFeedbackSubmission) => void | Promise<void>;
  onSendToBridge?: (capture: LocalFeedbackCapture) => Promise<LocalBridgeResult>;
  /**
   * Whether the widget is visible on mount. Defaults to visible outside
   * production. Ctrl/Cmd+Shift+. toggles it either way.
   */
  defaultVisible?: boolean;
  /**
   * Name this app so its feedback stays its own.
   *
   * Storage is per-origin, so two apps that share an origin share one pile of
   * feedback. That happens more often than it sounds: every local project run
   * on `localhost:3000`, and any two apps mounted under one domain. Give each
   * app a stable, distinct value — the package name is a good default.
   *
   * Leave it unset only when a single app owns the whole origin.
   */
  namespace?: string;
}
