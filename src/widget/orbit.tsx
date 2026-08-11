/**
 * Shared feedback UI for the local-first OSS package.
 *
 * `DebugWidget` is the single UI and interaction implementation for both hosted
 * and local mode. Only the persistence adapter (`FeedbackStore`) changes:
 * `createLocalFeedbackStore` never authenticates, never reaches an API, and has
 * no Inbox.
 */
export { FabMenu, type FabMenuItem, type FabMenuProps } from "./components/fab-menu";
export { AnnotationPopupCSS, type AnnotationPopupCSSProps } from "./components/annotation-popup-css";
export { IconImpakersOrbit } from "./components/icons";
export { DebugWidget, type DebugWidgetProps, type DebugWidgetLocalExtras } from "./components/debug-widget";
export { LocalRecap, type LocalRecapProps } from "./components/local-recap";
export { FeedbackList, type FeedbackListProps, type FeedbackListEntry } from "./components/feedback-list";
export { AnnotationMarker, PendingMarker } from "./components/annotation-marker";
export { SettingsPanel, type SettingsPanelProps, type SettingsPanelLanguageSettings, type SettingsPanelLabels } from "./components/settings-panel";
// `DebugWidgetProps.theme` / `SettingsPanelProps.theme` 를 타입으로 쓰기 위해 필요하다.
// 로컬 모드는 이 값을 넘기지 않으므로 언제나 기본값("solid")으로 렌더된다.
export type { DebugWidgetTheme } from "./core/types";
// 위젯 표시/숨김 정책은 로컬 모드(oss/)가 소유한다 — 판정만 여기서 공유한다.
export { isVisibilityToggleShortcut } from "./core/shortcuts";
// 단축키 안내 문구는 로컬 모드가 직접(번역해서) 만든다 — 기본 목록(SHORTCUT_HINTS)은
// 한국어 고정이라 내보내지 않고, 모양을 맞출 타입만 공유한다.
export type { ShortcutHint, ShortcutKey } from "./core/shortcuts";
export {
  createHostedFeedbackStore,
  type FeedbackStore,
  type FeedbackStoreCapabilities,
  type SubmitFeedbackPayload,
} from "./core/feedback-store";
export {
  createLocalFeedbackStore,
  type LocalFeedbackStore,
  type LocalFeedbackStoreConfig,
  type LocalFeedbackEntry,
} from "./core/local-feedback-store";
