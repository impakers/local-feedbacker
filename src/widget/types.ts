// =============================================================================
// Shared Types
// =============================================================================

export type Annotation = {
  id: string;
  x: number; // % of viewport width
  y: number; // px from top of document (absolute) OR viewport (if isFixed)
  comment: string;
  element: string;
  elementPath: string;
  timestamp: number;
  selectedText?: string;
  boundingBox?: { x: number; y: number; width: number; height: number };
  nearbyText?: string;
  cssClasses?: string;
  nearbyElements?: string;
  computedStyles?: string;
  fullPath?: string;
  accessibility?: string;
  isMultiSelect?: boolean; // true if created via drag selection
  isFixed?: boolean; // true if element has fixed/sticky positioning (marker stays fixed)
  // v1.7+ element anchoring — 스크롤 구조와 무관하게 요소를 추적
  anchorSelector?: string; // CSS selector that can re-find the element via querySelector
  offsetRatioX?: number; // 0-1, click offset within the element's bounding box (horizontal)
  offsetRatioY?: number; // 0-1, click offset within the element's bounding box (vertical)
  scrollContainerSelector?: string; // best-effort selector for the actual scroll container
  // v1.9+ 드롭다운/팝오버가 닫혀 앵커가 사라졌을 때 마커를 걸 트리거 버튼
  triggerAnchorSelector?: string;
  // v1.8+ modal context — 모달/오버레이 안에서 작성되었는지 (앵커 견고화 + 인박스 구분 표시)
  isInModal?: boolean;
  modalSelector?: string; // 모달 컨테이너 재탐색용 안정 셀렉터
  modalTitle?: string; // 원본 소스 파일을 찾지 못했을 때의 DialogTitle 폴백
  modalSourceCandidate?: string; // 소스맵 원본 경로 해석용 런타임 후보 (서버 미전송)
  modalLabel?: string; // 원본 파일명 또는 DialogTitle — 인박스 표시용
  reactComponents?: string; // React component hierarchy (e.g. "<App> <Dashboard> <Button>")
  sourceFile?: string; // Source file path from React _debugSource (dev mode only, e.g. "src/Button.tsx:42")
  drawingIndex?: number; // Index of linked draw stroke (if any)
  elementBoundingBoxes?: Array<{
    x: number;
    y: number;
    width: number;
    height: number;
  }>; // Individual bounding boxes for multi-select hover highlighting

  // Annotation kind (defaults to "feedback" when undefined — backward compat)
  kind?: "feedback" | "placement" | "rearrange";

  // Structured data for placement annotations
  placement?: {
    componentType: string;
    width: number;
    height: number;
    scrollY: number;
    text?: string;
  };

  // Structured data for rearrange annotations
  rearrange?: {
    selector: string;
    label: string;
    tagName: string;
    originalRect: { x: number; y: number; width: number; height: number };
    currentRect: { x: number; y: number; width: number; height: number };
  };

  // Protocol fields (added when syncing to server)
  sessionId?: string;
  url?: string;
  intent?: AnnotationIntent;
  severity?: AnnotationSeverity;
  status?: AnnotationStatus;
  thread?: ThreadMessage[];
  createdAt?: string;
  updatedAt?: string;
  resolvedAt?: string;
  resolvedBy?: "human" | "agent";
  authorId?: string;
  authorName?: string;

  // Local-only sync tracking (not sent to server)
  _syncedTo?: string; // Session ID this annotation was synced to
};

// -----------------------------------------------------------------------------
// Annotation Enums
// -----------------------------------------------------------------------------

export type AnnotationIntent = "fix" | "change" | "question" | "approve";
export type AnnotationSeverity = "blocking" | "important" | "suggestion";
export type AnnotationStatus = "todo" | "pending" | "acknowledged" | "resolved" | "dismissed" | "done" | "in_progress";

// -----------------------------------------------------------------------------
// Session
// -----------------------------------------------------------------------------

export type Session = {
  id: string;
  url: string;
  status: SessionStatus;
  createdAt: string;
  updatedAt?: string;
  projectId?: string;
  metadata?: Record<string, unknown>;
};

export type SessionStatus = "active" | "approved" | "closed";

export type SessionWithAnnotations = Session & {
  annotations: Annotation[];
};

// -----------------------------------------------------------------------------
// Thread Messages
// -----------------------------------------------------------------------------

export type ThreadMessage = {
  id: string;
  role: "human" | "agent";
  content: string;
  timestamp: number;
};
