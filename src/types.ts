/** Languages shipped by the local-first feedback experience. */
export type FeedbackLanguage = "en" | "es" | "zh-CN" | "ko";

/** Structured data passed to an explicitly configured local bridge. */
export interface LocalFeedbackCapture {
  prompt: string;
  feedback: string;
  url: string;
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
  onSendToBridge?: (capture: LocalFeedbackCapture) => Promise<LocalBridgeResult>;
  /**
   * Whether the widget is visible on mount. Defaults to visible outside
   * production. Ctrl/Cmd+Shift+. toggles it either way.
   */
  defaultVisible?: boolean;
}
