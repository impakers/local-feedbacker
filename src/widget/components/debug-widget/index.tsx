"use client";

import { useState, useCallback, useEffect, useRef, useMemo, type CSSProperties } from "react";
import { createPortal } from "react-dom";

import {
  AnnotationPopupCSS,
  AnnotationPopupCSSHandle,
} from "../annotation-popup-css";
import {
  identifyElement,
  getNearbyText,
  getElementClasses,
  getDetailedComputedStyles,
  getForensicComputedStyles,
  getFullElementPath,
  getAccessibilityInfo,
  closestCrossingShadow,
} from "../../utils/element-identification";
import { getReactComponentName } from "../../utils/react-detection";
import { getSourceLocation, findNearestComponentSource, formatSourceLocation } from "../../utils/source-location";
import { buildStableSelector, findBySelector } from "../../utils/stable-selector";
import { findScrollContainer } from "../../utils/scroll-container";
import { detectModalContext, findModalContainer, installTriggerTracker, resolveModalLabel } from "../../utils/modal-context";
import { useModalOverlayIsolation } from "../../utils/modal-isolation";
import { originalSetTimeout } from "../../utils/freeze-animations";
import { captureFullPage, captureElement, preloadCapture } from "../../utils/capture-element";
import { collectMetadata } from "../../core/collector";
import { getRouteDebugTargets, mergeDebugTargets } from "../../core/debug-targets";
import {
  collectSourceAttributes,
  buildSourceAttributeTargets,
  formatSourceRef,
  exposeSourceAttributeHelper,
} from "../../utils/source-attribute";
import type {
  FeedbackTask,
  FeedbackComment,
  OperatorUnreadComment,
} from "../../core/api";
import { createHostedFeedbackStore, type FeedbackStore } from "../../core/feedback-store";
import { beginPendingUpload } from "../../core/pending-uploads";
import { resolveSourceString } from "../../core/sourcemap-resolver";
import type { DebugTarget, DebugWidgetTheme, FeedbackUser } from "../../core/types";
import type { Annotation } from "../../types";
import { AnnotationMarker, PendingMarker, mergeMarkerAuthor } from "../annotation-marker";
import { CommentThread, type ThreadTask, type CommentData } from "../comment-thread";
import { LocalRecap } from "../local-recap";
import { FeedbackList } from "../feedback-list";
import { FabMenu, type FabMenuItem } from "../fab-menu";
import { InboxPanel, type InboxItem } from "../inbox-panel";
import { SettingsPanel, type SettingsPanelLanguageSettings, type SettingsPanelLabels } from "../settings-panel";
import { getServiceName } from "../../core/auth";
import { loadSettings, saveSettings, type DebugSettings } from "../../core/settings";
import { isFeedbackModeShortcut, type ShortcutHint } from "../../core/shortcuts";
import { storage, KEYS } from "../../core/storage";
import styles from "./styles.module.scss";

// =============================================================================
// Utils
// =============================================================================

/**
 * 피드백 원문을 자르거나 분리하지 않고 그대로 하나의 인박스 항목으로 남긴다.
 * - title = 원문 전체(무손실). 90/100자 절단·title/description 분리·"다음 코멘트로 등록" 모두 없음.
 * - description은 비운다(별도 본문/코멘트로 쪼개지 않는다).
 * 알림톡처럼 길이 제한이 있는 채널은 OS가 표시 시점에 자체 절단한다
 * (impakers-os feedback-notify.ts cleanTitle).
 */
function splitCommentIntoTitle(comment: string): { title: string; description: string } {
  return { title: (comment ?? "").trim(), description: "" };
}


function deepElementFromPoint(x: number, y: number): HTMLElement | null {
  let element = document.elementFromPoint(x, y) as HTMLElement | null;
  if (!element) return null;
  while (element?.shadowRoot) {
    const deeper = element.shadowRoot.elementFromPoint(x, y) as HTMLElement | null;
    if (!deeper || deeper === element) break;
    element = deeper;
  }
  return element;
}

function isElementFixed(element: HTMLElement): boolean {
  let current: HTMLElement | null = element;
  while (current && current !== document.body) {
    const style = window.getComputedStyle(current);
    if (style.position === "fixed" || style.position === "sticky") return true;
    current = current.parentElement;
  }
  return false;
}

function identifyElementWithReact(element: HTMLElement): {
  name: string;
  elementName: string;
  path: string;
  reactComponents: string | null;
} {
  const { name: elementName, path } = identifyElement(element);
  const reactInfo = getReactComponentName(element, { mode: "filtered" });
  return {
    name: reactInfo.path ? `${reactInfo.path} ${elementName}` : elementName,
    elementName,
    path,
    reactComponents: reactInfo.path,
  };
}

function detectSourceFile(element: Element): string | undefined {
  const result = getSourceLocation(element as HTMLElement);
  const loc = result.found ? result : findNearestComponentSource(element as HTMLElement);
  if (loc.found && loc.source) {
    return formatSourceLocation(loc.source, "path");
  }
  return undefined;
}

/** 여러 소스 파일 후보를 반환 (프로덕션에서 첫 번째 청크가 node_modules일 수 있음) */
function detectSourceFileCandidates(element: Element): string[] {
  const result = getSourceLocation(element as HTMLElement);
  const loc = result.found ? result : findNearestComponentSource(element as HTMLElement);
  if (loc.found && loc.sourceCandidates && loc.sourceCandidates.length > 0) {
    return loc.sourceCandidates.map((s) => formatSourceLocation(s, "path"));
  }
  if (loc.found && loc.source) {
    return [formatSourceLocation(loc.source, "path")];
  }
  return [];
}

function buildComponentDebugTarget(
  resolvedSource: string,
  componentName?: string | null,
): DebugTarget | null {
  const match = resolvedSource.match(/^(.+):(\d+)(?::(\d+))?$/);
  if (!match) return null;

  const [, file, lineStr, columnStr] = match;
  const line = Number.parseInt(lineStr, 10);
  const column = columnStr ? Number.parseInt(columnStr, 10) : undefined;
  if (!file || Number.isNaN(line)) return null;

  return {
    kind: "component",
    file,
    line,
    column,
    label: componentName || "Resolved component source",
    confidence: 0.98,
    reason: "resolved-from-source-map",
  };
}

// =============================================================================
// Types
// =============================================================================

type HoverInfo = {
  element: string;
  elementName: string;
  elementPath: string;
  rect: DOMRect | null;
  reactComponents?: string | null;
};

type PendingAnnotation = {
  x: number;
  y: number;
  clientY: number;
  element: string;
  elementPath: string;
  selectedText?: string;
  boundingBox?: { x: number; y: number; width: number; height: number };
  nearbyText?: string;
  cssClasses?: string;
  isFixed?: boolean;
  fullPath?: string;
  accessibility?: string;
  computedStyles?: string;
  computedStylesObj?: Record<string, string>;
  nearbyElements?: string;
  reactComponents?: string;
  sourceFile?: string;
  resolvedSource?: string;
  resolvedName?: string;
  targetElement?: HTMLElement;
  // v1.7+ element anchoring
  anchorSelector?: string;
  offsetRatioX?: number;
  offsetRatioY?: number;
  scrollContainerSelector?: string;
  triggerAnchorSelector?: string;
  // v1.8+ modal context
  isInModal?: boolean;
  modalSelector?: string;
  modalTitle?: string;
  modalTrigger?: string;
  modalSourceCandidate?: string;
};

// =============================================================================
// Component
// =============================================================================

export interface DebugWidgetProps {
  endpoint: string;
  getUser?: () => FeedbackUser | null;
  onHide?: () => void;
  onLogout?: () => void;
  /**
   * 영속화 어댑터. 기본값은 임패커스 OS(호스티드) 어댑터라 기존 호출부는 그대로 동작한다.
   * capabilities.inbox === false 인 어댑터(로컬 모드)는 수신함/코멘트/히스토리 경로를
   * 아예 실행하지 않는다.
   */
  store?: FeedbackStore;
  /** 피드백 팝오버 액션 행 위에 끼워 넣을 로컬 전용 컨트롤(예: 음성 녹음). */
  popoverFooter?: React.ReactNode;
  /** 팝오버 입력창 placeholder 오버라이드 (미지정 시 기본 문구). */
  popoverPlaceholder?: string;
  /** 팝오버 제출 버튼 라벨 오버라이드 (미지정 시 기본 문구). */
  popoverSubmitLabel?: string;
  /**
   * 읽기 패널(수신함·스레드·설정)의 서피스 재질. 미지정 시 `"solid"` —
   * 지금 배포돼 있는 모든 호스티드 클라이언트와 픽셀 단위로 동일하다.
   *
   * FAB·팝오버·마커·토스트는 이 값을 보지 않는다. 컨트롤을 반투명하게 만들면
   * 밝은 호스트 앱 위에서 비활성처럼 읽히기 때문에, 어떤 테마에서도 기존
   * 다크 글래스를 유지한다 (styles/_tokens.scss Dark glass 주석).
   */
  theme?: DebugWidgetTheme;
  /**
   * 로컬(zero-backend) 모드 전용 부가 기능. 주면 마커 되짚기 패널과 FAB "전체 복사"
   * 항목이 켜진다. 미지정(= 모든 호스티드 호출부)이면 아무것도 달라지지 않는다.
   *
   * `FeedbackStore` 에 넣지 않는 이유: 호스티드 어댑터에는 쓸 데가 없어서
   * 인터페이스에 올리면 구현체마다 빈 스텁을 달아야 한다.
   */
  localExtras?: DebugWidgetLocalExtras;
}

export interface DebugWidgetLocalExtras {
  /** 마커 id 로 제출했던 프롬프트 원문을 되찾는다. 없으면 null → 패널을 띄우지 않는다. */
  getEntryText: (id: string) => string | null;
  /** 마커 id 로 캡처 화면(dataURL)을 되찾는다. 미지정이면 축소판이 어디에도 뜨지 않는다. */
  getEntryScreenshot?: (id: string) => string | null;
  /** FAB "전체 복사" 선택 시 호출. */
  onCopyAll?: () => void;
  /** "전체 복사" 항목에 붙일 배지 숫자. */
  pendingCount?: number;
  /** 되짚기 패널의 복사 버튼 라벨. */
  recapCopyLabel?: string;
  /** FAB "전체 복사" 항목 라벨. */
  copyAllLabel?: string;
  /** FAB "전체 복사" 항목 아이콘. 미지정 시 기본 복사 아이콘. */
  copyAllIcon?: React.ReactNode;
  /** 설정 패널의 계정/로그아웃을 인증 상태와 무관하게 감춘다. 로컬 모드는 누구도 인증하지 않는다. */
  hideAccount?: boolean;
  /** 설정 패널에 언어 선택 필드를 붙인다. 미지정이면 필드가 없다. */
  languageSettings?: SettingsPanelLanguageSettings;
  /** 설정 패널의 "전체 삭제" 선택 시 호출. 미지정이면 버튼이 없다. */
  onClearAll?: () => void;
  /** "전체 삭제" 버튼 라벨. */
  clearAllLabel?: string;
  /** FAB "피드백" 항목 라벨. 미지정 시 기존 한국어 문구. */
  commentLabel?: string;
  /** FAB "설정" 항목 라벨. 미지정 시 기존 한국어 문구. */
  settingsLabel?: string;
  /** FAB 트리거 버튼의 aria-label. 미지정 시 기존 한국어 문구. */
  fabAriaLabel?: string;
  /** 설정 패널 문구 오버라이드. 미지정 필드는 기존 한국어 문구. */
  panelLabels?: SettingsPanelLabels;
  /** 설정 패널 "단축키 안내" 목록 오버라이드. 미지정 시 기본(한국어) 목록. */
  shortcutHints?: ShortcutHint[];
  /** 설정 패널의 "내가 추가한 것만 표시"를 감춘다. 로컬 모드에는 작성자가 없다. */
  hideShowOnlyMine?: boolean;
  /** 팝오버 취소 버튼 라벨. 미지정 시 기존 한국어 문구. */
  cancelLabel?: string;
  /** FAB 우클릭 메뉴 "위젯 숨기기" 라벨. 미지정 시 기존 한국어 문구. */
  hideWidgetLabel?: string;
  /** 마커의 "모달에서 작성됨" 배지 문구. 미지정 시 기존 한국어 문구. */
  modalBadgeLabel?: string;
  /** 캡처 안내 알약의 제목. 미지정 시 기존 한국어 문구. */
  hintTitle?: string;
  /** 캡처 안내 알약의 본문. 미지정 시 기존 한국어 문구(일부 강조 포함). */
  hintBody?: string;
  /** 제출 성공 토스트 문구. 미지정 시 기존 한국어 문구. */
  submitSuccessLabel?: string;
  /** 제출 실패 토스트의 기본 문구(에러 메시지가 없을 때). 미지정 시 기존 한국어 문구. */
  submitErrorLabel?: string;
  /** 되짚기 패널 제목. 미지정 시 기존 한국어 문구. */
  recapTitleLabel?: string;
  /** 되짚기 패널 닫기 버튼의 aria-label. 미지정 시 기존 한국어 문구. */
  recapCloseAriaLabel?: string;
  /** 되짚기 패널의 복사 직후 문구. 미지정 시 기존 한국어 문구. */
  recapCopiedLabel?: string;
  /** FAB "피드백 목록" 항목 라벨. 미지정 시 기존 한국어 문구. */
  feedbackListLabel?: string;
  /** 저장된 제출 요약 목록. 주면 FAB 에 "피드백 목록" 항목이 켜진다. */
  listEntries?: () => { id: string; label: string; timestamp: number; hasScreenshot?: boolean }[];
  /** 목록에서 한 건 삭제. */
  onRemoveEntry?: (id: string) => void;
  /** 목록 패널 제목. 미지정 시 기존 한국어 문구. */
  feedbackListTitle?: string;
  /** 목록이 비었을 때 문구. */
  feedbackListEmptyLabel?: string;
  /** 목록 항목의 복사 버튼 라벨. */
  feedbackListCopyLabel?: string;
  /** 목록 항목의 복사 직후 문구. */
  feedbackListCopiedLabel?: string;
  /** 목록 항목 삭제 버튼의 aria-label. */
  feedbackListRemoveAriaLabel?: string;
  /** 되짚기 패널의 삭제 버튼 aria-label. */
  recapDeleteAriaLabel?: string;
  /** 목록 패널의 "전체 내보내기" 선택 시 호출. 미지정이면 그 줄이 없다. */
  onExportAll?: () => Promise<{ ok: boolean; message?: string }>;
  /** 내보내기를 지원하는 브라우저인지. false 면 버튼 대신 안내 문구가 뜬다. */
  exportSupported?: boolean;
  /** 내보내기 버튼 라벨. */
  exportLabel?: string;
  /** 내보내기 미지원 안내 문구. */
  exportUnsupportedLabel?: string;
  /** 폴더를 고른 뒤 쓰는 동안 뜨는 문구. */
  exportingLabel?: string;
  /** 내보내기가 끝났을 때 잠깐 뜨는 문구. */
  exportDoneLabel?: string;
  /** 브라우저가 그 폴더를 거절했을 때 뜨는 안내 문구. */
  exportRejectedLabel?: string;
}

/**
 * 기본(호스티드) 어댑터는 모듈 레벨에 한 번만 만든다.
 * 렌더마다 새 인스턴스를 만들면 store 를 의존성으로 받는 effect 들이 매 렌더 재실행된다.
 */
const HOSTED_STORE = createHostedFeedbackStore();

/**
 * 로컬 모드의 FAB 항목 순서(화면에 위→아래로 보이는 순서: 설정·목록·전체복사·피드백).
 * `FabMenu` 가 받은 배열을 뒤집어 렌더링하므로(트리거에 가까운 항목이 배열 앞) 이
 * 목록은 원하는 화면 순서의 역순으로 적어야 한다. 호스티드는 배열 리터럴 순서를
 * 그대로 쓴다 — 여기에 손대도 `place`/`lomelo-*` 의 `[피드백, 수신함, 설정]` 은
 * 바뀌지 않는다.
 */
const LOCAL_FAB_ORDER = ["comment", "copy-all", "feedback-list", "settings"];

// ---------------------------------------------------------------------------
// 라우트별 마커 localStorage 저장/복원
// ---------------------------------------------------------------------------

function loadRouteAnnotations(): Annotation[] {
  const stored = storage.get(KEYS.MARKERS(window.location.pathname));
  if (!stored) return [];
  try {
    return JSON.parse(stored) as Annotation[];
  } catch {
    return [];
  }
}

function saveRouteAnnotations(annotations: Annotation[]): void {
  if (annotations.length === 0) {
    storage.remove(KEYS.MARKERS(window.location.pathname));
  } else {
    storage.set(KEYS.MARKERS(window.location.pathname), JSON.stringify(annotations));
  }
}

/**
 * 마커에 붙는 패널(코멘트 스레드 · 로컬 되짚기)의 화면 좌표.
 *
 * anchor 가능하면 라이브 요소 위치를 쓰고, 아니면 legacy 좌표로 떨어진다.
 * 위/아래는 남은 공간이 넓은 쪽을 고른다 — 아래로 열면 top, 위로 열면 bottom 을
 * 준다(그래야 패널이 실제 높이만큼만 위로 자란다).
 */
function getMarkerPanelAnchor(annotation: Annotation): { left: number; top?: number; bottom?: number } {
  let markerX: number;
  let markerY: number;
  const anchored = annotation.anchorSelector
    ? findBySelector(annotation.anchorSelector)
    : null;
  // 오버레이가 닫혔으면 마커와 같은 규칙으로 트리거 버튼 중앙을 쓴다.
  const triggerAnchored =
    !anchored && annotation.triggerAnchorSelector
      ? findBySelector(annotation.triggerAnchorSelector)
      : null;
  if (anchored) {
    const r = anchored.getBoundingClientRect();
    const rx = annotation.offsetRatioX ?? 0.5;
    const ry = annotation.offsetRatioY ?? 0.5;
    markerX = r.left + r.width * rx;
    markerY = r.top + r.height * ry;
  } else if (triggerAnchored) {
    const r = triggerAnchored.getBoundingClientRect();
    markerX = r.left + r.width / 2;
    markerY = r.top + r.height / 2;
  } else {
    markerX = (annotation.x / 100) * window.innerWidth;
    markerY = annotation.isFixed
      ? annotation.y
      : annotation.y - window.scrollY;
  }

  const left = Math.max(10, Math.min(markerX + 20, window.innerWidth - 360));
  // 마커 위치 기준으로 위/아래 중 공간이 넓은 방향으로 배치
  const spaceBelow = window.innerHeight - markerY;
  const openDown = spaceBelow >= 300;
  return {
    left,
    top: openDown ? Math.max(10, markerY) : undefined,
    bottom: openDown ? undefined : Math.max(10, window.innerHeight - markerY),
  };
}

function taskToAnnotation(task: FeedbackTask): Annotation | null {
  if (!task.feedbackMarker) return null;
  return {
    id: task.id,
    x: task.feedbackMarker.x,
    y: task.feedbackMarker.y,
    comment: task.title.replace(/^\[피드백\]\s*/, ""),
    element: task.feedbackMarker.element || "",
    elementPath: "",
    timestamp: new Date(task.createdAt).getTime(),
    isFixed: task.feedbackMarker.isFixed,
    boundingBox: task.feedbackMarker.boundingBox,
    status: task.status as Annotation["status"],
    anchorSelector: task.feedbackMarker.anchorSelector,
    offsetRatioX: task.feedbackMarker.offsetRatioX,
    offsetRatioY: task.feedbackMarker.offsetRatioY,
    scrollContainerSelector: task.feedbackMarker.scrollContainerSelector,
    triggerAnchorSelector: task.feedbackMarker.triggerAnchorSelector,
    isInModal: task.feedbackMarker.isInModal,
    modalSelector: task.feedbackMarker.modalSelector,
    modalTitle: task.feedbackMarker.modalTitle,
    modalLabel: task.feedbackMarker.modalLabel,
    authorId: task.authorId ?? undefined,
    authorName: task.authorName ?? undefined,
  };
}

export function DebugWidget({
  endpoint,
  getUser,
  onHide,
  onLogout,
  store = HOSTED_STORE,
  popoverFooter,
  popoverPlaceholder,
  popoverSubmitLabel,
  theme = "solid",
  localExtras,
}: DebugWidgetProps) {
  const inboxEnabled = store.capabilities.inbox;
  const [isActive, setIsActive] = useState(false);
  const [annotations, setAnnotations] = useState<Annotation[]>(() => loadRouteAnnotations());
  const [pendingAnnotation, setPendingAnnotation] = useState<PendingAnnotation | null>(null);
  const [pendingExiting, setPendingExiting] = useState(false);
  const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null);
  const [, setHoverPosition] = useState({ x: 0, y: 0 });
  const [animatedMarkers, setAnimatedMarkers] = useState<Set<string>>(new Set());
  const [submitting] = useState(false);
  const [hoveredMarkerId, setHoveredMarkerId] = useState<string | null>(null);
  const [hoveredTargetElement, setHoveredTargetElement] = useState<HTMLElement | null>(null);
  const [showToast, setShowToast] = useState(false);
  const [toastError, setToastError] = useState<string | null>(null);
  const [activeThread, setActiveThread] = useState<string | null>(null);
  const [threadComments, setThreadComments] = useState<Record<string, CommentData[]>>({});
  const [threadLoading, setThreadLoading] = useState(false);
  const [serverTasks, setServerTasks] = useState<FeedbackTask[]>([]);
  const [allServerTasks, setAllServerTasks] = useState<FeedbackTask[]>([]);
  const [showInbox, setShowInbox] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showFeedbackList, setShowFeedbackList] = useState(false);
  const [settings, setSettings] = useState<DebugSettings>(() => loadSettings());
  const [routePath, setRoutePath] = useState(() => window.location.pathname);
  const [hasHydratedServerTasks, setHasHydratedServerTasks] = useState(false);
  const [newNotiCount, setNewNotiCount] = useState(0);
  const [agentUnreadCount, setAgentUnreadCount] = useState(0);
  // 신규 확인 필요(빨간 점): 본인이 작성하지 않은 새 댓글이 달린 피드백 추적
  const [latestCommentByTask, setLatestCommentByTask] = useState<Record<string, string>>({});
  const [taskSeenMap, setTaskSeenMap] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(storage.get(KEYS.TASK_SEEN) ?? "{}") as Record<string, string>;
    } catch {
      return {};
    }
  });
  // TEMP(2026-04): 에이전트 응답 대신 담당자(operator) 응답을 토스트로 표시.
  const [toastAgentReply, setToastAgentReply] = useState<OperatorUnreadComment | null>(null);
  const [agentToastCollapsed, setAgentToastCollapsed] = useState(false);
  const agentToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const popupRef = useRef<AnnotationPopupCSSHandle>(null);
  const recentlyAddedIdRef = useRef<string | null>(null);
  const justSubmittedRef = useRef(false);
  // #1: 오버레이(팝오버/모달)는 클릭 즉시 캡처해 둔다. 제출 전 오버레이가 닫혀도 스크린샷 확보.
  const eagerCaptureRef = useRef<Promise<string | undefined> | null>(null);
  // 길게 눌러(long-press) 캡처가 발생하면, 뒤따르는 click은 무시한다(이중 생성 방지).
  const holdCapturedRef = useRef(false);

  // 피드백 모드 진입 시 캡처 라이브러리를 미리 로드 → 클릭 즉시 캡처의 import 지연(레이스) 완화
  useEffect(() => {
    if (isActive) preloadCapture();
  }, [isActive]);

  // #2: 모달 오프너(트리거) 추적기 설치 — 접근성 트리거 없는 프로그램적 모달의 폴백 라벨용
  useEffect(() => installTriggerTracker(), []);

  // Radix UI (shadcn) 모달과의 pointer-events / dismiss 충돌 방지
  const portalRootRef = useModalOverlayIsolation<HTMLDivElement>();

  // authorName 용: 항상 위젯 로그인 유저 (feedbackerUser)
  const feedbackerUser = useMemo(() => store.getAuthenticatedUser(), [store]);

  // -------------------------------------------------------------------------
  // FAB menu handler
  // -------------------------------------------------------------------------
  const handleFabSelect = useCallback((id: string) => {
    if (id === "comment") {
      toggleActive();
    } else if (id === "inbox") {
      setShowInbox(true);
      // All 탭용 전체 피드백 로드
      store.fetchAllFeedbacks(endpoint, { staleWhileRevalidate: true })
        .then(setAllServerTasks)
        .catch(() => {});
      if (isActive) {
        setIsActive(false);
        document.documentElement.classList.remove("impakers-selecting");
        setHoverInfo(null);
        setPendingAnnotation(null);
      }
    } else if (id === "settings") {
      setShowSettings(true);
    } else if (id === "copy-all") {
      localExtras?.onCopyAll?.();
    } else if (id === "feedback-list") {
      setShowFeedbackList(true);
    }
  }, [isActive, store, localExtras]);

  const handleSettingsChange = useCallback((newSettings: DebugSettings) => {
    setSettings(newSettings);
    saveSettings(newSettings);
  }, []);

  // -------------------------------------------------------------------------
  // Toggle active state
  // -------------------------------------------------------------------------
  const toggleActive = useCallback(() => {
    setIsActive((prev) => {
      const next = !prev;
      if (next) {
        document.documentElement.classList.add("impakers-selecting");
      } else {
        document.documentElement.classList.remove("impakers-selecting");
        setHoverInfo(null);
        setPendingAnnotation(null);
      }
      return next;
    });
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      document.documentElement.classList.remove("impakers-selecting");
    };
  }, []);

  // devtools에서 __impakersDebugSrc($0)로 주입 속성을 확인할 수 있게 한다.
  // id 모드에서는 DOM 속성이 압축돼 있어 눈으로 읽을 수 없다.
  useEffect(() => {
    exposeSourceAttributeHelper();
  }, []);

  // 라우트별 마커 로드 (마운트 시 + 라우트 변경 시)
  useEffect(() => {
    setAnnotations(loadRouteAnnotations());

    // SPA 라우트 변경 감지 (pushState/popstate)
    const handleRouteChange = () => {
      setRoutePath(window.location.pathname);
      setAnnotations(loadRouteAnnotations());
      setPendingAnnotation(null);
      setHoverInfo(null);
    };
    window.addEventListener("popstate", handleRouteChange);

    // Next.js 등 pushState 감지를 위한 패치
    const originalPushState = history.pushState.bind(history);
    history.pushState = (...args) => {
      originalPushState(...args);
      // pushState 후 약간 딜레이를 줘야 pathname이 갱신됨
      setTimeout(handleRouteChange, 50);
    };

    return () => {
      window.removeEventListener("popstate", handleRouteChange);
      history.pushState = originalPushState;
    };
  }, []);

  useEffect(() => {
    // 로컬 모드: 서버 피드백이 없다 — 마커는 localStorage 에서만 온다.
    if (!inboxEnabled) return;

    const cacheKey = store.getFeedbacksCacheKey(routePath);
    const cached = store.getCachedSnapshot<FeedbackTask[]>(cacheKey);
    if (cached) {
      setServerTasks(cached);
      setHasHydratedServerTasks(true);
    }

    const unsubscribe = store.subscribeCache<FeedbackTask[]>(cacheKey, (tasks) => {
      setServerTasks(tasks);
      setHasHydratedServerTasks(true);
    });

    store.fetchFeedbacks(endpoint, routePath, { staleWhileRevalidate: true })
      .then((tasks) => {
        setServerTasks(tasks);
        setHasHydratedServerTasks(true);
      })
      .catch(() => {
        // 서버 로드 실패 → localStorage fallback (이미 로드됨)
      });

    return unsubscribe;
  }, [endpoint, routePath, store, inboxEnabled]);

  // 새 알림 개수: lastSeen 이후 히스토리 이벤트 수
  useEffect(() => {
    if (!inboxEnabled) return;
    const lastSeen = storage.get(KEYS.HISTORY_LAST_SEEN) ?? new Date(0).toISOString();
    store.fetchHistory(endpoint, { since: lastSeen, limit: 100 })
      .then((events) => setNewNotiCount(events.length))
      .catch(() => {});
  }, [endpoint, store, inboxEnabled]);

  const handleHistoryViewed = useCallback(() => {
    storage.set(KEYS.HISTORY_LAST_SEEN, new Date().toISOString());
    setNewNotiCount(0);
    setAgentUnreadCount(0);
    setToastAgentReply(null);
    if (agentToastTimerRef.current) {
      clearTimeout(agentToastTimerRef.current);
      agentToastTimerRef.current = null;
    }
  }, []);

  // 피드백별 "마지막으로 달린 (남이 쓴) 댓글 시각" 수집 → 빨간 점 판단용
  const myId = feedbackerUser?.id != null ? String(feedbackerUser.id) : null;
  const myName = feedbackerUser?.name || null;
  useEffect(() => {
    if (!inboxEnabled) return;
    store.fetchHistory(endpoint, { limit: 100 })
      .then((events) => {
        const map: Record<string, string> = {};
        for (const ev of events) {
          if (ev.action !== "comment_added") continue;
          // 본인이 단 댓글은 알림 대상에서 제외 (actorId 우선, 없으면 이름 fallback)
          const isMine = myId && ev.actorId != null
            ? String(ev.actorId) === myId
            : !!myName && ev.actorName === myName;
          if (isMine) continue;
          const prev = map[ev.taskId];
          if (!prev || new Date(ev.createdAt).getTime() > new Date(prev).getTime()) {
            map[ev.taskId] = ev.createdAt;
          }
        }
        setLatestCommentByTask(map);
      })
      .catch(() => {});
  }, [endpoint, myId, myName, store, inboxEnabled]);

  // 피드백 상세 진입 시 "확인함" 처리 → 해당 피드백 빨간 점 제거
  const handleMarkTaskSeen = useCallback((taskId: string) => {
    setTaskSeenMap((prev) => {
      const next = { ...prev, [taskId]: new Date().toISOString() };
      storage.set(KEYS.TASK_SEEN, JSON.stringify(next));
      return next;
    });
  }, []);

  // 마지막 확인 시점 이후 새 댓글이 있는 피드백 ID 집합
  const attentionTaskIds = useMemo(() => {
    const ids = new Set<string>();
    for (const [taskId, commentAt] of Object.entries(latestCommentByTask)) {
      const seen = taskSeenMap[taskId];
      if (!seen || new Date(commentAt).getTime() > new Date(seen).getTime()) {
        ids.add(taskId);
      }
    }
    return ids;
  }, [latestCommentByTask, taskSeenMap]);

  // 담당자(operator) 응답 폴러 — 새 응답 시 토스트 알림 표시.
  useEffect(() => {
    if (!inboxEnabled) return;
    const handle = store.startOperatorReplyPoller({
      endpoint,
      feedbackUrl: "__all__",
      onOperatorReply: (reply) => {
        store.incrementCommentCount(reply.taskId, 1);
        setLatestCommentByTask((prev) => ({ ...prev, [reply.taskId]: new Date().toISOString() }));
        setAgentUnreadCount((c) => c + 1);
        setToastAgentReply(reply);
        setAgentToastCollapsed(false);
        if (agentToastTimerRef.current) clearTimeout(agentToastTimerRef.current);
        agentToastTimerRef.current = setTimeout(() => {
          setAgentToastCollapsed(true);
        }, 5000);
      },
    });
    return () => {
      handle.stop();
      if (agentToastTimerRef.current) {
        clearTimeout(agentToastTimerRef.current);
        agentToastTimerRef.current = null;
      }
    };
  }, [endpoint, store, inboxEnabled]);

  const handleAgentToastOpenInbox = useCallback(() => {
    setShowInbox(true);
    setToastAgentReply(null);
    setAgentUnreadCount(0);
    store.fetchAllFeedbacks(endpoint, { staleWhileRevalidate: true })
      .then(setAllServerTasks)
      .catch(() => {});
    if (agentToastTimerRef.current) {
      clearTimeout(agentToastTimerRef.current);
      agentToastTimerRef.current = null;
    }
  }, [endpoint, store]);

  const handleAgentToastDismiss = useCallback(() => {
    setAgentToastCollapsed(true);
    if (agentToastTimerRef.current) {
      clearTimeout(agentToastTimerRef.current);
      agentToastTimerRef.current = null;
    }
  }, []);

  const handleAgentToastExpand = useCallback(() => {
    setAgentToastCollapsed(false);
    if (agentToastTimerRef.current) clearTimeout(agentToastTimerRef.current);
    agentToastTimerRef.current = setTimeout(() => {
      setAgentToastCollapsed(true);
    }, 5000);
  }, []);

  useEffect(() => {
    if (!hasHydratedServerTasks) return;
    const serverAnnotations = serverTasks
      .map(taskToAnnotation)
      .filter((annotation): annotation is Annotation => annotation !== null);
    setAnnotations(serverAnnotations);
    saveRouteAnnotations(serverAnnotations);
  }, [serverTasks, hasHydratedServerTasks]);

  // annotations 변경 시 localStorage 저장 (초기 마운트 skip)
  const isInitialMount = useRef(true);
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    saveRouteAnnotations(annotations);
  }, [annotations]);

  // -------------------------------------------------------------------------
  // Ctrl/Cmd+Shift+, — 마우스 없이 피드백 모드 진입/해제
  //
  // 모달이나 필터 Popover 가 열려 있으면 FAB 클릭이 호스트의 dismiss 로 먹혀
  // 피드백을 남길 수 없다. 그래서:
  //   - window 의 **capture** 단계에 붙여 호스트(Radix 등)보다 먼저 가로챈다.
  //   - 포커스가 입력창 안에 있어도 동작한다 (isFeedbackModeShortcut 참고).
  //   - 포커스를 옮기지 않는다. focusin 이 발생하면 Radix DismissableLayer 가
  //     "바깥으로 포커스 이탈"로 보고 오버레이를 닫아버린다.
  // -------------------------------------------------------------------------
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!isFeedbackModeShortcut(e)) return;

      e.preventDefault();
      e.stopPropagation();

      // 우리 패널이 떠 있으면 먼저 정리 — 요소 선택을 가리기 때문
      setShowInbox(false);
      setShowSettings(false);
      setShowFeedbackList(false);
      toggleActive();
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [toggleActive]);

  // Escape key: popover 닫기 → 선택모드 해제 (2단계)
  //
  // capture 단계에서 가로채고, 우리가 처리한 경우에만 전파를 끊는다. 그러지
  // 않으면 호스트 모달(Radix Dialog 등)이 같은 ESC 로 함께 닫혀, 피드백 모드만
  // 끄고 모달은 유지하는 동작이 불가능해진다.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;

      // inbox 열려있으면 닫기
      if (showInbox) {
        e.stopPropagation();
        setShowInbox(false);
        return;
      }

      // pending annotation 있으면 popover 닫기
      if (pendingAnnotation) {
        e.preventDefault();
        e.stopPropagation();
        setPendingExiting(true);
        originalSetTimeout(() => {
          setPendingAnnotation(null);
          setPendingExiting(false);
        }, 150);
        return;
      }

      // 선택 모드면 해제
      if (isActive) {
        e.preventDefault();
        e.stopPropagation();
        setIsActive(false);
        document.documentElement.classList.remove("impakers-selecting");
        setHoverInfo(null);
      }

      // 위 어디에도 해당하지 않으면 전파를 그대로 둔다 — 호스트 모달의 ESC 동작 보존
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [showInbox, pendingAnnotation, isActive]);

  // -------------------------------------------------------------------------
  // Mouse move — hover highlight
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!isActive || pendingAnnotation) return;

    const handleMouseMove = (e: MouseEvent) => {
      const target = (e.composedPath()[0] || e.target) as HTMLElement;
      if (closestCrossingShadow(target, "[data-impakers-debug]")) {
        setHoverInfo(null);
        return;
      }

      const elementUnder = deepElementFromPoint(e.clientX, e.clientY);
      if (!elementUnder || closestCrossingShadow(elementUnder, "[data-impakers-debug]")) {
        setHoverInfo(null);
        return;
      }

      const { name, elementName, path, reactComponents } = identifyElementWithReact(elementUnder);
      const rect = elementUnder.getBoundingClientRect();

      setHoverInfo({ element: name, elementName, elementPath: path, rect, reactComponents });
      setHoverPosition({ x: e.clientX, y: e.clientY });
    };

    document.addEventListener("mousemove", handleMouseMove);
    return () => document.removeEventListener("mousemove", handleMouseMove);
  }, [isActive, pendingAnnotation]);

  // -------------------------------------------------------------------------
  // 한 지점(커서/클릭)에서 피드백 대상 선택 + 오버레이 즉시 캡처
  // 클릭 핸들러와 캡처 단축키(C)가 공유한다.
  // freezeViewport=true(단축키 경로): 모달이 아닌 사라지는 오버레이(툴팁 등)를
  // "지금 보이는 동안" 뷰포트 전체로 프리즈해 둔다.
  // -------------------------------------------------------------------------
  const beginAnnotationAtPoint = useCallback(
    (clientX: number, clientY: number, opts?: { freezeViewport?: boolean }) => {
      const elementUnder = deepElementFromPoint(clientX, clientY);
      if (!elementUnder) return;

      const { name, path, reactComponents } = identifyElementWithReact(elementUnder);
      const rect = elementUnder.getBoundingClientRect();
      const x = (clientX / window.innerWidth) * 100;
      const isFixed = isElementFixed(elementUnder);
      const y = isFixed ? clientY : clientY + window.scrollY;

      // v1.7+ 요소 앵커링 정보 캡처 — 스크롤 구조 무관하게 추적
      const anchorSelector = buildStableSelector(elementUnder) ?? undefined;
      const offsetRatioX =
        rect.width > 0 ? (clientX - rect.left) / rect.width : 0.5;
      const offsetRatioY =
        rect.height > 0 ? (clientY - rect.top) / rect.height : 0.5;
      const scrollContainer = findScrollContainer(elementUnder);
      const scrollContainerSelector =
        buildStableSelector(scrollContainer) ?? undefined;

      // 모달/오버레이 안에서 작성되었는지 캡처 (K3 앵커 견고화 + U2 구분 표시)
      const { isInModal, modalSelector, modalTitle, modalTrigger, modalSourceCandidate, triggerAnchorSelector } =
        detectModalContext(elementUnder);

      // 오버레이(팝오버/모달) 안 피드백이면 "지금"(오버레이가 아직 열린 상태) 즉시 캡처를 시작한다.
      // 제출 시점 캡처는 그 사이 팝오버가 닫혀 실패하므로, 열린 순간의 스크린샷을 확보해 둔다.
      eagerCaptureRef.current = null;
      if (isInModal) {
        const overlayEl = findModalContainer(elementUnder);
        if (overlayEl) {
          eagerCaptureRef.current = captureElement(overlayEl, { quality: 0.5, maxScale: 1 }).catch(() => undefined);
        }
      } else if (opts?.freezeViewport) {
        // 캡처 단축키(C): 모달이 아닌 사라지는 오버레이(role=tooltip 등)는
        // 클릭 시점엔 이미 사라진다. 지금(보이는 동안) 뷰포트 전체를 프리즈.
        eagerCaptureRef.current = captureFullPage().catch(() => undefined);
      }

      const selection = window.getSelection();
      let selectedText: string | undefined;
      if (selection && selection.toString().trim().length > 0) {
        selectedText = selection.toString().trim().slice(0, 500);
      }

      const computedStylesObj = getDetailedComputedStyles(elementUnder);
      const computedStylesStr = getForensicComputedStyles(elementUnder);

      setPendingAnnotation({
        x,
        y,
        clientY,
        element: name,
        elementPath: path,
        selectedText,
        boundingBox: {
          x: rect.left,
          y: isFixed ? rect.top : rect.top + window.scrollY,
          width: rect.width,
          height: rect.height,
        },
        nearbyText: getNearbyText(elementUnder),
        cssClasses: getElementClasses(elementUnder),
        isFixed,
        fullPath: getFullElementPath(elementUnder),
        accessibility: getAccessibilityInfo(elementUnder),
        computedStyles: computedStylesStr,
        computedStylesObj,
        reactComponents: reactComponents ?? undefined,
        sourceFile: detectSourceFile(elementUnder),
        targetElement: elementUnder,
        anchorSelector,
        offsetRatioX,
        offsetRatioY,
        scrollContainerSelector,
        triggerAnchorSelector,
        isInModal,
        modalSelector,
        modalTitle,
        modalTrigger,
        modalSourceCandidate,
      });
      setHoverInfo(null);

      // 비동기 소스맵 resolve (popover 표시 후 업데이트)
      // 여러 후보를 시도하여 node_modules가 아닌 결과를 찾음
      const candidates = detectSourceFileCandidates(elementUnder);
      const chunkCandidates = candidates.filter((c) => c.includes("/chunks/"));
      if (chunkCandidates.length > 0) {
        (async () => {
          for (const candidate of chunkCandidates) {
            try {
              const resolved = await resolveSourceString(candidate);
              if (resolved) {
                setPendingAnnotation((prev) =>
                  prev ? {
                    ...prev,
                    resolvedSource: `${resolved.source}:${resolved.line}`,
                    resolvedName: resolved.name ?? undefined,
                  } : prev
                );
                break; // 첫 성공에서 멈춤
              }
            } catch {
              // 다음 후보 시도
            }
          }
        })();
      }
    },
    [],
  );

  // -------------------------------------------------------------------------
  // Click — select element
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!isActive) return;

    const handleClick = (e: MouseEvent) => {
      if (justSubmittedRef.current) return;
      // 길게 눌러 캡처가 방금 발생했다면, 그 릴리스로 뒤따르는 click은 삼킨다.
      if (holdCapturedRef.current) {
        holdCapturedRef.current = false;
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      const target = (e.composedPath()[0] || e.target) as HTMLElement;

      // 우리 UI 요소 클릭은 무시 (FAB, popup, marker 등)
      if (closestCrossingShadow(target, "[data-impakers-debug]")) return;
      if (closestCrossingShadow(target, "[data-annotation-popup]")) return;
      if (closestCrossingShadow(target, "[data-annotation-marker]")) return;

      // 호스트가 코드로 쏜 click (element.click()) 은 좌표가 0,0 이라 그대로 쓰면
      // 화면 좌상단(=html)이 선택돼 "전체 화면이 잡히는" 것처럼 보인다.
      // Radix MenuItem 이 pointerup 에서 정확히 이 click 을 발생시킨다.
      // 사용자의 진짜 click 이 뒤따라 오므로 여기서는 삼킨다.
      // (detail === 0 은 프로그램적 click / 키보드 활성화. 우리 UI 는 위에서 이미 제외됨)
      if (e.detail === 0) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      // 이미 pending annotation이 있으면 shake로 알림
      if (pendingAnnotation) {
        e.preventDefault();
        e.stopPropagation();
        popupRef.current?.shake();
        return;
      }

      // 인터랙티브 요소 클릭 차단 (피드백 모드에서 네비게이션 방지)
      e.preventDefault();
      e.stopPropagation();

      beginAnnotationAtPoint(e.clientX, e.clientY);
    };

    // Capture phase로 인터셉트
    document.addEventListener("click", handleClick, true);
    return () => document.removeEventListener("click", handleClick, true);
  }, [isActive, pendingAnnotation, beginAnnotationAtPoint]);

  // -------------------------------------------------------------------------
  // 길게 눌러(long-press) 캡처 — 클릭 시 사라지는 오버레이(팝오버/툴팁)용
  // 클릭은 pointerdown+pointerup 이라, 그 사이 호스트 오버레이가 dismiss되어
  // 스크린샷/앵커가 무너진다. 길게 누르는 동안(릴리스 전) 캡처하면 오버레이가
  // 열린 채로 확보된다. pointerdown 을 capture phase에서 가로채 preventDefault
  // 하므로, 호스트가 그 press로 오버레이를 닫거나 포커스를 옮기지 못한다.
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!isActive) return;

    const HOLD_MS = 450;       // 이 시간 이상 누르면 long-press 로 판정
    const MOVE_TOL_PX = 10;    // 이 이상 움직이면 드래그로 보고 취소

    let timer: ReturnType<typeof setTimeout> | null = null;
    let armed = false;
    let startX = 0;
    let startY = 0;

    const disarm = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      armed = false;
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;              // 좌클릭(주 버튼)만
      if (justSubmittedRef.current) return;
      if (pendingAnnotation) return;           // 입력 팝업 떠 있으면 무시
      const target = (e.composedPath()[0] || e.target) as HTMLElement;
      if (closestCrossingShadow(target, "[data-impakers-debug]")) return;
      if (closestCrossingShadow(target, "[data-annotation-popup]")) return;
      if (closestCrossingShadow(target, "[data-annotation-marker]")) return;

      // 호스트가 이 press로 오버레이를 닫거나 포커스를 옮기지 못하게 막는다.
      // (click 이벤트는 별개라 여전히 발생 → 빠른 탭은 기존 클릭 플로우가 처리)
      e.preventDefault();
      e.stopPropagation();

      startX = e.clientX;
      startY = e.clientY;
      armed = true;
      holdCapturedRef.current = false;
      timer = originalSetTimeout(() => {
        timer = null;
        if (!armed) return;
        armed = false;
        holdCapturedRef.current = true;        // 뒤따르는 click 무시
        // 누르고 있는 "지금" 캡처 — 오버레이가 아직 열려 있다.
        beginAnnotationAtPoint(startX, startY, { freezeViewport: true });
      }, HOLD_MS);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!armed) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (dx * dx + dy * dy > MOVE_TOL_PX * MOVE_TOL_PX) disarm();
    };

    // 릴리스(pointerup)도 호스트에 넘기지 않는다.
    //
    // Radix MenuItem 은 pointerup 에서 `currentTarget.click()` 을 직접 호출해
    // 항목을 선택하고 메뉴를 닫는다 (게다가 위에서 pointerdown 을 막았기 때문에
    // Radix 는 "다른 항목으로 옮겨온 릴리스"로 보고 이 경로를 항상 탄다).
    // 그러면 ① 드롭다운이 닫혀 대상 요소가 사라지고 ② 좌표 0,0 짜리 합성 click 이
    // 날아와 엉뚱한 요소가 잡힌다. 전파만 끊으면 브라우저의 진짜 click 은
    // 그대로 발생하므로 우리 선택 플로우는 영향이 없다. (preventDefault 는 하지
    // 않는다 — 일부 브라우저에서 click 합성까지 막힐 수 있다)
    const onPointerUpOrCancel = (e: PointerEvent) => {
      disarm();
      if (e.type !== "pointerup") return;

      const target = (e.composedPath()[0] || e.target) as HTMLElement;
      if (closestCrossingShadow(target, "[data-impakers-debug]")) return;
      if (closestCrossingShadow(target, "[data-annotation-popup]")) return;
      if (closestCrossingShadow(target, "[data-annotation-marker]")) return;

      e.stopPropagation();
    };

    // capture phase — 호스트보다 먼저 인터셉트
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("pointermove", onPointerMove, true);
    document.addEventListener("pointerup", onPointerUpOrCancel, true);
    document.addEventListener("pointercancel", onPointerUpOrCancel, true);
    return () => {
      disarm();
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("pointermove", onPointerMove, true);
      document.removeEventListener("pointerup", onPointerUpOrCancel, true);
      document.removeEventListener("pointercancel", onPointerUpOrCancel, true);
    };
  }, [isActive, pendingAnnotation, beginAnnotationAtPoint]);

  const showErrorToast = useCallback((msg: string) => {
    setToastError(msg);
    originalSetTimeout(() => setToastError(null), 4000);
  }, []);

  // -------------------------------------------------------------------------
  // Submit feedback — annotation comment → server
  // -------------------------------------------------------------------------
  const addAnnotation = useCallback(
    (comment: string) => {
      if (!pendingAnnotation || submitting) return;

      // 동기적으로 수집 가능한 데이터를 먼저 캡처
      const metadata = collectMetadata(getUser);
      const annotation = { ...pendingAnnotation };
      const feedbackUrl = window.location.pathname;

      // 즉시 팝업 닫기 + 마커 표시 (낙관적 UI)
      setPendingExiting(true);
      originalSetTimeout(() => {
        setPendingAnnotation(null);
        setPendingExiting(false);
        setIsActive(false);
        document.documentElement.classList.remove("impakers-selecting");
        justSubmittedRef.current = true;
        setTimeout(() => { justSubmittedRef.current = false; }, 300);
      }, 150);
      window.getSelection()?.removeAllRanges();

      // 백그라운드에서 스크린샷 캡처 + 데이터 수집 + API 전송
      (async () => {
        try {
          const needsSourceResolve = !annotation.resolvedSource && annotation.sourceFile?.includes("/chunks/");

          // 모달/Sheet 안 피드백은 모달 요소를 직접 캡처한다.
          // full-page 캡처(html2canvas on document.body)는 position:fixed 모달을 놓치거나
          // 딤 오버레이만 잡혀 스크린샷이 비어 보이는 한계가 있다. 실패 시 full-page로 폴백.
          // #1: 클릭 시점에 시작해 둔 즉시 캡처가 있으면 우선 사용(그 사이 팝오버가 닫혔어도 확보됨).
          // 없거나 실패하면 제출 시점 캡처로 폴백. scale 1·quality 0.5 = full-page와 동일한 안전 크기.
          const eager = eagerCaptureRef.current;
          eagerCaptureRef.current = null;
          let capturePromise: Promise<string | undefined>;
          if (eager) {
            capturePromise = eager.then((shot) => shot ?? captureFullPage());
          } else {
            const modalEl = annotation.isInModal
              ? findModalContainer(annotation.targetElement ?? null)
              : null;
            capturePromise = modalEl
              ? captureElement(modalEl, { quality: 0.5, maxScale: 1 }).catch(() => captureFullPage())
              : captureFullPage();
          }

          const [screenshot, sourceResolved, routeMatch, modalLabel, sourceAttributes] = await Promise.all([
            capturePromise,
            needsSourceResolve
              ? resolveSourceString(annotation.sourceFile!).catch(() => null)
              : Promise.resolve(null),
            getRouteDebugTargets(feedbackUrl),
            annotation.isInModal
              ? resolveModalLabel(
                annotation.modalSourceCandidate,
                annotation.modalTitle,
                resolveSourceString,
              )
              : Promise.resolve(undefined),
            // 빌드 타임 주입 속성 — 있으면 추론(fiber probe)보다 우선한다
            collectSourceAttributes(annotation.targetElement ?? null).catch(() => ({
              callsites: [],
              definitions: [],
            })),
          ]);

          let resolvedSource = annotation.resolvedSource || annotation.sourceFile || "";
          let resolvedName: string | null = annotation.resolvedName || null;
          if (sourceResolved) {
            resolvedSource = `${sourceResolved.source}:${sourceResolved.line}:${sourceResolved.column}`;
            resolvedName = sourceResolved.name;
          }
          const componentTarget = resolvedSource && !resolvedSource.includes("/chunks/")
            ? buildComponentDebugTarget(resolvedSource, resolvedName)
            : null;
          const attributeTargets = buildSourceAttributeTargets(sourceAttributes);
          const debugTargets = mergeDebugTargets(
            attributeTargets,
            componentTarget ? [componentTarget] : undefined,
            routeMatch?.targets,
          );
          if (debugTargets.length > 0) {
            metadata.debugTargets = debugTargets;
          }
          if (routeMatch?.context) {
            metadata.routeDebug = routeMatch.context;
          }

          // debugInfo 조합 (JSONB로 저장 — 구조화된 형식)
          const elementData: Record<string, unknown> = {};
          if (annotation.element) elementData.selector = annotation.element;
          if (annotation.elementPath) elementData.domPath = annotation.elementPath;
          if (annotation.selectedText) elementData.selectedText = annotation.selectedText;
          if (annotation.reactComponents?.trim()) {
            elementData.reactComponents = annotation.reactComponents;
          } else if (resolvedName) {
            elementData.componentName = resolvedName;
          }
          // 빌드 타임 확정값(호출부)이 있으면 그것이 진짜 "파일 원문"이다.
          // 없을 때만 소스맵 추론값으로 내려간다.
          const primaryCallsite = sourceAttributes.callsites[0];
          if (primaryCallsite) {
            elementData.sourceFile = formatSourceRef(primaryCallsite);
            elementData.sourceFileOrigin = "build-time";
          } else if (resolvedSource && !resolvedSource.includes("/chunks/")) {
            elementData.sourceFile = resolvedSource;
            elementData.sourceFileOrigin = "source-map-inferred";
          }
          if (annotation.cssClasses) elementData.cssClasses = annotation.cssClasses;
          if (annotation.nearbyText) elementData.nearbyText = annotation.nearbyText;
          if (annotation.accessibility) elementData.accessibility = annotation.accessibility;

          const consoleData: Record<string, unknown> = {};
          if (metadata.consoleErrors?.length) {
            consoleData.errors = metadata.consoleErrors.slice(-10).map((e) => e.slice(0, 200));
          }
          if (metadata.consoleLogs?.length) {
            const recentLogs = metadata.consoleLogs
              .filter((l) => l.level === "error" || l.level === "warn")
              .slice(-10);
            if (recentLogs.length > 0) {
              consoleData.logs = recentLogs.map((l) => ({ level: l.level, message: l.message.slice(0, 200) }));
            }
          }

          const users: Record<string, unknown> = {};
          if (metadata.feedbackerUser) users.feedbackerUser = metadata.feedbackerUser;
          if (metadata.serviceUser) users.serviceUser = metadata.serviceUser;
          if (metadata.jwtClaims) users.jwtClaims = metadata.jwtClaims;

          const debugInfoJson: Record<string, unknown> = {
            comment,
            ...(debugTargets.length > 0 ? { debugTargets } : {}),
            ...(Object.keys(elementData).length > 0 ? { element: elementData } : {}),
            ...(Object.keys(consoleData).length > 0 ? { console: consoleData } : {}),
            environment: {
              url: metadata.url,
              timestamp: metadata.timestamp,
              browser: metadata.browser,
              viewport: metadata.viewport,
              pixelRatio: metadata.pixelRatio,
              language: metadata.language,
            },
            ...(metadata.performance && Object.keys(metadata.performance).length > 0
              ? { performance: metadata.performance }
              : {}),
            ...(Object.keys(users).length > 0 ? { users } : {}),
          };

          const { title, description } = splitCommentIntoTitle(comment);

          const result = await store.submitFeedback(endpoint, {
            title,
            description,
            priority: "medium",
            metadata,
            debugInfo: debugInfoJson,
            debug_info: debugInfoJson,
            screenshot,
            feedbackUrl,
            feedbackMarker: {
              x: annotation.x,
              y: annotation.y,
              isFixed: annotation.isFixed || false,
              element: annotation.element,
              boundingBox: annotation.boundingBox,
              anchorSelector: annotation.anchorSelector,
              offsetRatioX: annotation.offsetRatioX,
              offsetRatioY: annotation.offsetRatioY,
              scrollContainerSelector: annotation.scrollContainerSelector,
              triggerAnchorSelector: annotation.triggerAnchorSelector,
              isInModal: annotation.isInModal,
              modalSelector: annotation.modalSelector,
              modalTitle: annotation.modalTitle,
              modalTrigger: annotation.modalTrigger,
              modalLabel,
            },
            authorName: feedbackerUser?.name || undefined,
            authorId: feedbackerUser?.id ? String(feedbackerUser.id) : undefined,
          });

          if (typeof window !== "undefined") {
            window.dispatchEvent(
              new CustomEvent("impakers-debug:feedback-submit", {
                detail: {
                  taskId: result.taskId || undefined,
                  marker: {
                    x: annotation.x,
                    y: annotation.y,
                    isFixed: annotation.isFixed || false,
                  },
                },
              }),
            );
          }

          // 성공 토스트
          setShowToast(true);
          originalSetTimeout(() => setShowToast(false), 3000);

          // 로컬 모드: 서버 task 가 없으니 마커를 직접 남긴다.
          // (annotations 변경 → saveRouteAnnotations 가 localStorage 에 영속화한다)
          //
          // 어댑터가 id 를 줬으면 **그것을 쓴다** — 어댑터가 같은 id 로 제출 원문을
          // 보관해 두므로, 여기서 새 id 를 뽑으면 마커와 원문의 연결이 끊긴다.
          const localMarkerId = inboxEnabled ? null : (result.taskId || `local-${Date.now()}`);
          if (localMarkerId) {
            setAnnotations((prev) => [
              ...prev,
              {
                id: localMarkerId,
                x: annotation.x,
                y: annotation.y,
                comment,
                element: annotation.element,
                elementPath: annotation.elementPath,
                timestamp: Date.now(),
                selectedText: annotation.selectedText,
                boundingBox: annotation.boundingBox,
                isFixed: annotation.isFixed,
                anchorSelector: annotation.anchorSelector,
                offsetRatioX: annotation.offsetRatioX,
                offsetRatioY: annotation.offsetRatioY,
                scrollContainerSelector: annotation.scrollContainerSelector,
                triggerAnchorSelector: annotation.triggerAnchorSelector,
                isInModal: annotation.isInModal,
                modalSelector: annotation.modalSelector,
                modalTitle: annotation.modalTitle,
                modalLabel,
              },
            ]);
          }

          const newTaskId = result.taskId || localMarkerId;
          recentlyAddedIdRef.current = newTaskId;
          originalSetTimeout(() => { recentlyAddedIdRef.current = null; }, 300);
          originalSetTimeout(() => {
            if (!newTaskId) return;
            setAnimatedMarkers((prev) => new Set(prev).add(newTaskId));
          }, 250);
        } catch (err: any) {
          const msg = err?.message || localExtras?.submitErrorLabel || "피드백 전송 실패";
          showErrorToast(msg);
          console.error("[@impakers/debug] 피드백 전송 실패:", err);
        }
      })();
    },
    [pendingAnnotation, submitting, endpoint, feedbackerUser, showErrorToast, store, inboxEnabled, localExtras],
  );

  const cancelAnnotation = useCallback(() => {
    eagerCaptureRef.current = null; // 취소 시 즉시-캡처 결과 폐기
    setPendingExiting(true);
    originalSetTimeout(() => {
      setPendingAnnotation(null);
      setPendingExiting(false);
      setIsActive(false);
      document.documentElement.classList.remove("impakers-selecting");
      justSubmittedRef.current = true;
      setTimeout(() => { justSubmittedRef.current = false; }, 300);
    }, 150);
  }, []);

  // -------------------------------------------------------------------------
  // Marker click → open comment thread
  // -------------------------------------------------------------------------
  const handleMarkerClick = useCallback((annotation: Annotation) => {
    const newId = annotation.id;
    setActiveThread((prev) => {
      if (prev === newId) return null;
      return newId;
    });
  }, []);

  useEffect(() => {
    if (!activeThread) return;
    if (!inboxEnabled) return;

    const cacheKey = store.getCommentsCacheKey(activeThread);
    const cached = store.getCachedSnapshot<FeedbackComment[]>(cacheKey);
    if (cached) {
      setThreadComments((prev) => ({ ...prev, [activeThread]: cached }));
      setThreadLoading(false);
    } else {
      setThreadLoading(true);
    }

    const unsubscribe = store.subscribeCache<FeedbackComment[]>(cacheKey, (comments) => {
      setThreadComments((prev) => ({ ...prev, [activeThread]: comments }));
      setThreadLoading(false);
    });

    store.fetchComments(endpoint, activeThread, { staleWhileRevalidate: true })
      .then(() => setThreadLoading(false))
      .catch(() => setThreadLoading(false));
    return unsubscribe;
  }, [activeThread, endpoint, store, inboxEnabled]);

  const handleThreadReply = useCallback(async (taskId: string, content: string, screenshot?: string, file?: File) => {
    const authorName = feedbackerUser?.name || "익명";
    const authorId = feedbackerUser?.id ? String(feedbackerUser.id) : undefined;

    // 업로드 전에 임시 코멘트를 먼저 띄운다 — 첨부 업로드 중에도 전송 사실이 보이도록.
    const tempId = store.addPendingComment(taskId, {
      content,
      authorName,
      authorId,
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
          fileResult = await store.uploadFile(endpoint, file, "comment", taskId);
        } catch (uploadErr: any) {
          const msg = uploadErr?.message || "파일 업로드 실패";
          showErrorToast(msg);
          console.error("[@impakers/debug] 파일 업로드 실패:", uploadErr);
          // 파일 업로드 실패해도 텍스트/스크린샷 코멘트는 전송
        }
      }

      await store.postComment(endpoint, taskId, content, authorName, authorId, screenshot, fileResult, tempId);
    } catch (err: any) {
      const msg = err?.message || "코멘트 전송 실패";
      showErrorToast(msg);
      console.error("[@impakers/debug] 코멘트 전송 실패:", err);
    } finally {
      releaseGuard();
    }
  }, [feedbackerUser, endpoint, showErrorToast, store]);

  const handleThreadClose = useCallback(() => {
    setActiveThread(null);
  }, []);

  /**
   * 로컬 모드에서 항목 하나를 지운다.
   *
   * 저장소에서만 지우면 마커(핀)가 화면에 남아, 눌러도 되짚기 패널이 뜨지 않는
   * 유령 핀이 된다(원문이 없으면 LocalRecap 이 아무것도 그리지 않는다). 저장소와
   * 마커를 같은 자리에서 함께 지워야 대칭이 맞는다.
   *
   * `annotations` 변경은 기존 effect 가 이미 localStorage 에 영속화하므로
   * 여기서 saveRouteAnnotations 를 다시 부르지 않는다(이중 저장).
   */
  const handleRemoveLocalEntry = useCallback((id: string) => {
    localExtras?.onRemoveEntry?.(id);
    setAnnotations((prev) => prev.filter((a) => a.id !== id));
    setActiveThread((current) => (current === id ? null : current));
  }, [localExtras]);

  // v1.8: 메신저 스타일 읽음 마킹 — 본 코멘트 ID들을 서버에 read 처리
  const handleMarkCommentsRead = useCallback(async (taskId: string, commentIds: string[]) => {
    const readerId = feedbackerUser?.id ? String(feedbackerUser.id) : null;
    const readerName = feedbackerUser?.name || null;
    if (!readerId || !readerName) return; // 익명: 마킹 생략
    if (commentIds.length === 0) return;
    try {
      await store.markCommentsRead(endpoint, taskId, commentIds, { id: readerId, name: readerName });
    } catch (err) {
      console.error("[@impakers/debug] 코멘트 읽음 마킹 실패:", err);
    }
  }, [feedbackerUser, endpoint, store]);

  // -------------------------------------------------------------------------
  // Marker hover — show element outline
  // -------------------------------------------------------------------------
  const handleMarkerHover = useCallback((annotation: Annotation | null) => {
    if (!annotation) {
      setHoveredMarkerId(null);
      setHoveredTargetElement(null);
      return;
    }
    setHoveredMarkerId(annotation.id);

    // 1) anchor selector로 직접 요소 찾기 (가장 정확)
    if (annotation.anchorSelector) {
      const found = findBySelector(annotation.anchorSelector);
      if (found instanceof HTMLElement) {
        setHoveredTargetElement(found);
        return;
      }
    }

    // 1-b) 드롭다운/팝오버가 닫혀 있으면 마커가 걸려 있는 트리거를 하이라이트
    if (annotation.triggerAnchorSelector) {
      const trigger = findBySelector(annotation.triggerAnchorSelector);
      if (trigger instanceof HTMLElement) {
        setHoveredTargetElement(trigger);
        return;
      }
    }

    // 2) bounding box + elementFromPoint 폴백
    if (annotation.boundingBox) {
      const bb = annotation.boundingBox;
      const centerX = bb.x + bb.width / 2;
      const centerY = annotation.isFixed
        ? bb.y + bb.height / 2
        : bb.y + bb.height / 2 - window.scrollY;
      const el = deepElementFromPoint(centerX, centerY);
      if (el) {
        const elRect = el.getBoundingClientRect();
        const widthRatio = elRect.width / bb.width;
        const heightRatio = elRect.height / bb.height;
        if (widthRatio >= 0.5 && heightRatio >= 0.5) {
          setHoveredTargetElement(el);
          return;
        }
      }
    }
    setHoveredTargetElement(null);
  }, []);

  // -------------------------------------------------------------------------
  // Popup positioning
  // -------------------------------------------------------------------------
  const getPopupPosition = useCallback(() => {
    if (!pendingAnnotation) return { left: 0, top: 0 };

    const markerX = (pendingAnnotation.x / 100) * window.innerWidth;
    const markerY = pendingAnnotation.isFixed
      ? pendingAnnotation.y
      : pendingAnnotation.y - window.scrollY;

    const left = Math.max(160, Math.min(window.innerWidth - 160, markerX));

    if (markerY > window.innerHeight - 290) {
      return { left, bottom: window.innerHeight - markerY + 20 };
    }
    return { left, top: markerY + 20 };
  }, [pendingAnnotation]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  if (typeof document === "undefined") return null;

  const popupPos = getPopupPosition();
  const hoveredRect = hoveredTargetElement?.getBoundingClientRect();

  // FAB menu items
  const fabItems: FabMenuItem[] = [
    {
      id: "comment",
      label: localExtras?.commentLabel || "피드백",
      active: isActive,
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
        </svg>
      ),
    },
    {
      id: "inbox",
      label: "수신함",
      badge: newNotiCount || undefined,
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
          <path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z" />
        </svg>
      ),
    },
    {
      id: "settings",
      label: localExtras?.settingsLabel || "설정",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
        </svg>
      ),
    },
    {
      id: "copy-all",
      label: localExtras?.copyAllLabel || "전체 복사",
      badge: localExtras?.pendingCount || undefined,
      icon: localExtras?.copyAllIcon ?? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
        </svg>
      ),
    },
    {
      id: "feedback-list",
      label: localExtras?.feedbackListLabel || "피드백 목록",
      badge: localExtras?.pendingCount || undefined,
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="8" y1="6" x2="21" y2="6" />
          <line x1="8" y1="12" x2="21" y2="12" />
          <line x1="8" y1="18" x2="21" y2="18" />
          <line x1="3" y1="6" x2="3.01" y2="6" />
          <line x1="3" y1="12" x2="3.01" y2="12" />
          <line x1="3" y1="18" x2="3.01" y2="18" />
        </svg>
      ),
    },
    // 로컬 모드(capabilities.inbox === false)에는 수신함이 없다.
    // 반대로 "전체 복사"·"피드백 목록"은 로컬 부가 기능이 주어졌을 때만 있다.
  ].filter((item) => (item.id !== "inbox" || inboxEnabled) && (item.id !== "copy-all" || !!localExtras) && (item.id !== "feedback-list" || !!localExtras?.listEntries));

  // 로컬 모드에서만 순서를 다시 잡는다. 배열 리터럴 자체를 재정렬하면 호스티드
  // 순서(`[피드백, 수신함, 설정]`)까지 조용히 바뀌므로 여기서만 갈아 끼운다.
  // localExtras 가 없으면 orderedFabItems === fabItems 라 호스티드는 무영향.
  const orderedFabItems = localExtras
    ? LOCAL_FAB_ORDER.map((id) => fabItems.find((item) => item.id === id)).filter(
      (item): item is FabMenuItem => !!item,
    )
    : fabItems;

  // Inbox items from local annotations
  const currentPath = routePath;
  // 설정에 따라 마커 필터링
  const currentUserName = feedbackerUser?.name || null;
  const visibleAnnotations = useMemo(() => {
    return annotations
      .filter((a) => {
        const task = serverTasks.find((t) => t.id === a.id);
        if (settings.hideDoneMarkers && (a.status === "done" || a.status === "resolved")) return false;
        if (settings.showOnlyMine && task?.authorName && currentUserName && task.authorName !== currentUserName) return false;
        return true;
      })
      .map((annotation) =>
        mergeMarkerAuthor(annotation, serverTasks.find((task) => task.id === annotation.id)),
      );
  }, [annotations, serverTasks, settings.hideDoneMarkers, settings.showOnlyMine, currentUserName]);

  const toInboxItem = (task: FeedbackTask, fallbackUrl: string): InboxItem => ({
    id: task.id,
    title: task.title || "피드백",
    description: task.description ?? undefined,
    status: task.status,
    priority: task.priority,
    authorName: task.authorName || "익명",
    authorId: task.authorId ?? null,
    feedbackUrl: task.feedbackUrl || fallbackUrl,
    createdAt: task.createdAt,
    startedAt: task.startedAt,
    completedAt: task.completedAt,
    commentCount: task.commentCount || 0,
    screenshot: task.screenshotUrl,
    isInModal: task.feedbackMarker?.isInModal,
    modalLabel: task.feedbackMarker?.modalLabel,
    modalTitle: task.feedbackMarker?.modalTitle,
    modalTrigger: task.feedbackMarker?.modalTrigger,
  });

  const allInboxItems: InboxItem[] = serverTasks.map((t) => toInboxItem(t, currentPath));
  const allRouteItems: InboxItem[] = allServerTasks.map((t) => toInboxItem(t, ""));

  return createPortal(
    // accent를 커스텀 프로퍼티로 내려 hover 하이라이트·포커스 링이 마커 색을 따라가게 한다.
    // 커스텀 프로퍼티는 containing block을 만들지 않으므로 자손 fixed 요소에 영향이 없다
    // (backdrop-filter/transform 과 다름 — 그래서 글래스는 말단 서피스에만 건다).
    <div
      ref={portalRootRef}
      data-impakers-debug=""
      style={{ "--impakers-accent": settings.markerColor } as CSSProperties}
    >
      {/* FAB Menu */}
      <FabMenu
        items={orderedFabItems}
        triggerAriaLabel={localExtras?.fabAriaLabel}
        hideWidgetLabel={localExtras?.hideWidgetLabel}
        onSelect={handleFabSelect}
        onHide={onHide}
        onDoubleTap={toggleActive}
        hasUnread={newNotiCount > 0 || agentUnreadCount > 0}
        agentUnreadCount={agentUnreadCount}
        leftSlot={
          toastAgentReply ? (
            agentToastCollapsed ? (
              <button
                type="button"
                onClick={handleAgentToastExpand}
                aria-label={`미확인 피드백 응답 ${agentUnreadCount}개`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "6px 10px",
                  height: 28,
                  borderRadius: 14,
                  background: "#18181b",
                  color: "#fff",
                  border: "1px solid #27272a",
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: "pointer",
                  boxShadow: "0 4px 12px rgba(0,0,0,0.35)",
                  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
                }}
                data-impakers-debug=""
                data-impakers-fab=""
              >
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    minWidth: 16,
                    height: 16,
                    padding: "0 4px",
                    borderRadius: 8,
                    background: "#ef4444",
                    fontSize: 10,
                    fontWeight: 700,
                  }}
                >
                  {agentUnreadCount > 99 ? "99+" : agentUnreadCount}
                </span>
                새 응답
              </button>
            ) : (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "10px 12px",
                  borderRadius: 12,
                  background: "#18181b",
                  color: "#fff",
                  border: "1px solid #27272a",
                  boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
                  maxWidth: 260,
                  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
                  fontSize: 12,
                  lineHeight: 1.4,
                }}
                data-impakers-debug=""
                data-impakers-fab=""
              >
                <span
                  style={{
                    flex: 1,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  담당자가 응답했습니다
                </span>
                <button
                  type="button"
                  onClick={handleAgentToastOpenInbox}
                  style={{
                    background: "#3f3f46",
                    color: "#fff",
                    border: "none",
                    borderRadius: 6,
                    padding: "5px 9px",
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                    fontFamily: "inherit",
                  }}
                >
                  피드백 보기 →
                </button>
                <button
                  type="button"
                  onClick={handleAgentToastDismiss}
                  aria-label="닫기"
                  style={{
                    background: "transparent",
                    color: "#a1a1aa",
                    border: "none",
                    padding: 2,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                  }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            )
          ) : null
        }
      />

      {/* Inbox Panel */}
      {showInbox && inboxEnabled && (
        <InboxPanel
          pageItems={allInboxItems}
          allItems={allRouteItems}
          currentPath={currentPath}
          serviceName={getServiceName() || undefined}
          endpoint={endpoint}
          currentUserName={feedbackerUser?.name || "익명"}
          currentUserId={feedbackerUser?.id ? String(feedbackerUser.id) : undefined}
          onClose={() => setShowInbox(false)}
          onHistoryViewed={handleHistoryViewed}
          newNotiCount={newNotiCount}
          attentionTaskIds={attentionTaskIds}
          onItemSeen={handleMarkTaskSeen}
          onError={showErrorToast}
          theme={theme}
        />
      )}

      {/* Settings Panel */}
      {showSettings && (
        <SettingsPanel
          settings={settings}
          onChange={handleSettingsChange}
          onClose={() => setShowSettings(false)}
          onLogout={onLogout}
          theme={theme}
          hideAccount={!!localExtras?.hideAccount}
          languageSettings={localExtras?.languageSettings}
          clearAllSettings={
            localExtras?.onClearAll
              ? {
                count: localExtras.pendingCount ?? 0,
                label: localExtras.clearAllLabel || "전체 피드백 삭제",
                onClear: localExtras.onClearAll,
              }
              : undefined
          }
          panelLabels={localExtras?.panelLabels}
          shortcutHints={localExtras?.shortcutHints}
          hideShowOnlyMine={!!localExtras?.hideShowOnlyMine}
        />
      )}

      {/* 피드백 목록 패널 (로컬 모드 전용) */}
      {showFeedbackList && localExtras?.listEntries && (
        <FeedbackList
          entries={localExtras.listEntries()}
          getEntryText={localExtras.getEntryText}
          getEntryScreenshot={localExtras.getEntryScreenshot ?? ((): null => null)}
          onRemove={handleRemoveLocalEntry}
          onClose={() => setShowFeedbackList(false)}
          theme={theme}
          {...(localExtras.feedbackListTitle ? { title: localExtras.feedbackListTitle } : {})}
          {...(localExtras.feedbackListEmptyLabel ? { emptyLabel: localExtras.feedbackListEmptyLabel } : {})}
          {...(localExtras.feedbackListCopyLabel ? { copyLabel: localExtras.feedbackListCopyLabel } : {})}
          {...(localExtras.feedbackListCopiedLabel ? { copiedLabel: localExtras.feedbackListCopiedLabel } : {})}
          {...(localExtras.feedbackListRemoveAriaLabel ? { removeAriaLabel: localExtras.feedbackListRemoveAriaLabel } : {})}
          {...(localExtras.onExportAll ? { onExportAll: localExtras.onExportAll } : {})}
          {...(localExtras.exportSupported !== undefined ? { exportSupported: localExtras.exportSupported } : {})}
          {...(localExtras.exportLabel ? { exportLabel: localExtras.exportLabel } : {})}
          {...(localExtras.exportUnsupportedLabel ? { exportUnsupportedLabel: localExtras.exportUnsupportedLabel } : {})}
          {...(localExtras.exportingLabel ? { exportingLabel: localExtras.exportingLabel } : {})}
          {...(localExtras.exportDoneLabel ? { exportDoneLabel: localExtras.exportDoneLabel } : {})}
          {...(localExtras.exportRejectedLabel ? { exportRejectedLabel: localExtras.exportRejectedLabel } : {})}
        />
      )}

      {/* 캡처 안내 (피드백 모드 · 입력 팝업 없을 때) */}
      {isActive && !pendingAnnotation && (
        <div
          data-impakers-debug=""
          style={{
            position: "fixed",
            bottom: 20,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 100000,
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 14px",
            borderRadius: 999,
            background: "rgba(24,24,27,0.92)",
            color: "#fff",
            border: "1px solid #3f3f46",
            boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
            fontSize: 12,
            fontWeight: 500,
            lineHeight: 1,
            whiteSpace: "nowrap",
            pointerEvents: "none",
            fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          }}
        >
          <span>{localExtras?.hintTitle || "피드백 클릭"}</span>
          <span style={{ color: "#71717a" }}>·</span>
          {/* 오버라이드는 평문 한 줄로 받는다 — 어느 언어나 같은 자리에서 강조가
              성립하지 않으므로, 굵게 처리는 기본(한국어) 문구에만 남긴다. */}
          <span style={{ color: "#d4d4d8" }}>
            {localExtras?.hintBody
              ? localExtras.hintBody
              : <>클릭하면 사라지는 화면은 커서를 떼지 말고 <b style={{ color: "#fff" }}>꾹 눌러</b> 캡처하세요</>}
          </span>
        </div>
      )}

      {/* Hover highlight + tooltip */}
      {isActive && (
        <>
          {/* Hover highlight box */}
          {hoverInfo?.rect && !pendingAnnotation && (
            <div
              className={`${styles.hoverHighlight} ${styles.enter}`}
              style={{
                left: hoverInfo.rect.left,
                top: hoverInfo.rect.top,
                width: hoverInfo.rect.width,
                height: hoverInfo.rect.height,
              }}
            />
          )}


          {/* Selected element outline (when hovering marker) */}
          {hoveredRect && hoveredMarkerId && (
            <div
              className={`${styles.singleSelectOutline} ${styles.enter}`}
              style={{
                left: hoveredRect.left,
                top: hoveredRect.top,
                width: hoveredRect.width,
                height: hoveredRect.height,
              }}
            />
          )}

          {/* Pending annotation element outline */}
          {pendingAnnotation?.targetElement && (() => {
            const r = pendingAnnotation.targetElement!.getBoundingClientRect();
            return (
              <div
                className={`${styles.singleSelectOutline} ${styles.enter}`}
                style={{ left: r.left, top: r.top, width: r.width, height: r.height }}
              />
            );
          })()}
        </>
      )}

      {/* Markers layer (single fixed layer; 각 마커가 자체 viewport 좌표를 계산) */}
      <div className={styles.fixedMarkersLayer} data-impakers-debug="" style={{ display: settings.markersVisible ? undefined : "none" }}>
        {visibleAnnotations.map((annotation, i) => (
          <AnnotationMarker
            key={annotation.id}
            annotation={annotation}
            layerIndex={i}
            isAnimated={animatedMarkers.has(annotation.id)}
            isHovered={hoveredMarkerId === annotation.id}
            isDeleting={false}
            markerClickBehavior="edit"
            modalBadgeLabel={localExtras?.modalBadgeLabel}
            accentColor={settings.markerColor}
            isMine={Boolean(
              feedbackerUser && (
                (feedbackerUser.id != null && annotation.authorId === String(feedbackerUser.id)) ||
                (!annotation.authorId &&
                  Boolean(feedbackerUser.name) &&
                  annotation.authorName === feedbackerUser.name)
              ),
            )}
            onHover={() => handleMarkerHover(annotation)}
            onHoverEnd={() => handleMarkerHover(null)}
            onClick={() => handleMarkerClick(annotation)}
            onContextMenu={() => {}}
          />
        ))}

        {/* Pending marker */}
        {pendingAnnotation && (
          <PendingMarker
            x={pendingAnnotation.x}
            y={pendingAnnotation.clientY}
            isMultiSelect={false}
            accentColor={settings.markerColor}
          />
        )}
      </div>

      {/* Annotation popup */}
      {pendingAnnotation && (
        <AnnotationPopupCSS
          ref={popupRef}
          element={pendingAnnotation.resolvedSource || pendingAnnotation.resolvedName || pendingAnnotation.element}
          selectedText={pendingAnnotation.selectedText}
          isExiting={pendingExiting}
          footer={popoverFooter}
          {...(popoverPlaceholder ? { placeholder: popoverPlaceholder } : {})}
          {...(popoverSubmitLabel ? { submitLabel: popoverSubmitLabel } : {})}
          {...(localExtras?.cancelLabel ? { cancelLabel: localExtras.cancelLabel } : {})}
          style={{
            position: "fixed",
            left: popupPos.left,
            ...("top" in popupPos ? { top: popupPos.top } : {}),
            ...("bottom" in popupPos ? { bottom: (popupPos as any).bottom } : {}),
            transform: "translateX(-50%)",
            zIndex: 100001,
          }}
          onSubmit={addAnnotation}
          onCancel={cancelAnnotation}
        />
      )}

      {/* Comment thread — 로컬 모드에는 코멘트 자체가 없다(불러오지도 보내지도 못함) */}
      {activeThread && inboxEnabled && (() => {
        const annotation = annotations.find((a) => a.id === activeThread);
        const taskData = serverTasks.find((task) => task.id === activeThread);
        if (!annotation) return null;

        const { left: threadLeft, top: threadTop, bottom: threadBottom } = getMarkerPanelAnchor(annotation);

        const task: ThreadTask = {
          id: annotation.id,
          title: taskData?.title || annotation.comment || "피드백",
          status: taskData?.status || "todo",
          authorName: taskData?.authorName || undefined,
          authorId: taskData?.authorId ?? undefined,
          createdAt: taskData?.createdAt || new Date(annotation.timestamp).toISOString(),
          comments: threadComments[annotation.id] || [],
        };

        return (
          <CommentThread
            task={task}
            currentUserName={feedbackerUser?.name || "익명"}
            currentUserId={feedbackerUser?.id ? String(feedbackerUser.id) : undefined}
            left={threadLeft}
            top={threadTop}
            bottom={threadBottom}
            loading={threadLoading}
            onClose={handleThreadClose}
            onReply={handleThreadReply}
            onMarkRead={handleMarkCommentsRead}
            onError={showErrorToast}
            theme={theme}
          />
        );
      })()}

      {/* 로컬 모드: 코멘트 대신 제출했던 원문을 되짚어 보여 준다 */}
      {activeThread && !inboxEnabled && localExtras && (() => {
        const annotation = annotations.find((a) => a.id === activeThread);
        if (!annotation) return null;
        // 보관 한도를 넘겨 잘렸거나 다른 세션에서 남긴 마커 — 조용히 아무것도 띄우지 않는다.
        const text = localExtras.getEntryText(activeThread);
        if (!text) return null;

        const { left, top, bottom } = getMarkerPanelAnchor(annotation);

        return (
          <LocalRecap
            text={text}
            left={left}
            top={top}
            bottom={bottom}
            {...(localExtras.recapCopyLabel ? { copyLabel: localExtras.recapCopyLabel } : {})}
            {...(localExtras.recapTitleLabel ? { title: localExtras.recapTitleLabel } : {})}
            {...(localExtras.recapCloseAriaLabel ? { closeAriaLabel: localExtras.recapCloseAriaLabel } : {})}
            {...(localExtras.recapCopiedLabel ? { copiedLabel: localExtras.recapCopiedLabel } : {})}
            {...(localExtras.getEntryScreenshot ? { screenshot: localExtras.getEntryScreenshot(activeThread) } : {})}
            {...(localExtras.onRemoveEntry ? { onDelete: (): void => handleRemoveLocalEntry(activeThread) } : {})}
            {...(localExtras.recapDeleteAriaLabel ? { deleteAriaLabel: localExtras.recapDeleteAriaLabel } : {})}
            onClose={handleThreadClose}
          />
        );
      })()}

      {/* 성공 토스트 */}
      {showToast && (
        <div className={styles.toast} data-impakers-debug="">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <span>
            {localExtras?.submitSuccessLabel || "피드백 생성이 완료되었습니다"}
          </span>
        </div>
      )}

      {/* 에러 토스트 */}
      {toastError && (
        <div className={`${styles.toast} ${styles.toastError}`} data-impakers-debug="">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
          <span>{toastError}</span>
        </div>
      )}
    </div>,
    document.body,
  );
}
