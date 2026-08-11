/**
 * 피드백을 남긴 요소가 모달/오버레이(다이얼로그·시트·드로어) 안에 있는지 감지한다.
 *
 * 두 가지 용도:
 *   1) 인박스/마커에서 "모달에서 작성" vs "페이지에서 작성" 구분 표시 (U2)
 *   2) 모달 컨텍스트를 마커에 저장해 두어, 앵커 재해석 시 참고 (K3)
 */
import { buildStableSelector } from "./stable-selector";
import {
  findNearestComponentSource,
  formatSourceLocation,
  getSourceLocation,
} from "./source-location";

export interface ModalContext {
  /** 요소가 모달/오버레이 안에서 작성되었는지 */
  isInModal: boolean;
  /** 모달 컨테이너를 다시 찾기 위한 안정 셀렉터 (best-effort) */
  modalSelector?: string;
  /** 모달의 접근 가능한 제목 — 원본 파일 경로를 해석하지 못했을 때 표시용 */
  modalTitle?: string;
  /** 모달을 연 트리거(버튼)의 레이블 — 인박스 경로 표시용 ({페이지} > {트리거} > {제목}) */
  modalTrigger?: string;
  /** 원본 파일로 변환할 수 있는 소스 위치 후보. 빌드 경로 자체는 표시하지 않는다. */
  modalSourceCandidate?: string;
  /**
   * 드롭다운/팝오버처럼 닫히면 사라지는 오버레이의 **트리거 버튼** 셀렉터.
   * 오버레이가 닫혀 원래 앵커를 찾을 수 없을 때 마커를 여기에 건다.
   */
  triggerAnchorSelector?: string;
}

function normalizeLabel(value: string | null | undefined): string | undefined {
  const normalized = value?.replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, 80) : undefined;
}

/** 원본 소스 파일명만 허용한다. Next/Vite 등의 번들 산출물 경로는 표시하지 않는다. */
export function getOriginalSourceFileName(source: string | undefined): string | undefined {
  if (!source) return undefined;
  const file = source.replace(/:\d+(?::\d+)?$/, "").replace(/\\/g, "/");
  if (
    file.includes("/_next/") ||
    file.includes("/.next/") ||
    file.includes("/chunks/") ||
    file.includes("node_modules/") ||
    file.includes("webpack-internal:") ||
    file.includes("turbopack:")
  ) {
    return undefined;
  }
  const name = file.split("/").filter(Boolean).pop();
  return name && /\.[cm]?[jt]sx?$/.test(name) ? name : undefined;
}

type SourceResolver = (candidate: string) => Promise<{ source: string } | null>;

/** 원본 파일을 확인할 수 있을 때만 파일명을, 그 외에는 DialogTitle을 사용한다. */
export async function resolveModalLabel(
  sourceCandidate: string | undefined,
  modalTitle: string | undefined,
  resolveSource: SourceResolver,
): Promise<string | undefined> {
  const directSourceFile = getOriginalSourceFileName(sourceCandidate);
  if (directSourceFile) return directSourceFile;

  if (sourceCandidate) {
    const resolved = await resolveSource(sourceCandidate).catch(() => null);
    const resolvedSourceFile = getOriginalSourceFileName(resolved?.source);
    if (resolvedSourceFile) return resolvedSourceFile;
  }

  return modalTitle;
}

/** DialogTitle/aria-labelledby 기반의 사람 친화적인 폴백 레이블 */
export function getModalTitle(modal: Element): string | undefined {
  const labelledBy = modal.getAttribute("aria-labelledby");
  if (labelledBy) {
    const label = labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent)
      .filter((text): text is string => Boolean(text))
      .join(" ");
    const normalized = normalizeLabel(label);
    if (normalized) return normalized;
  }

  const title = modal.querySelector(
    "[data-radix-dialog-title], [data-radix-alert-dialog-title], [data-slot='dialog-title'], h1, h2, h3, h4, h5, h6",
  );
  return normalizeLabel(title?.textContent);
}

const MENU_ITEM_SELECTOR =
  '[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="option"]';

/** 드롭다운/셀렉트처럼 "선택한 항목"이 곧 이름이 되는 오버레이인지 */
function isMenuLikeOverlay(modal: Element): boolean {
  const role = modal.getAttribute("role");
  if (role === "menu" || role === "listbox") return true;
  if (modal.hasAttribute("data-radix-menu-content")) return true;
  return (
    modal.hasAttribute("data-radix-popper-content-wrapper") &&
    Boolean(modal.querySelector('[role="menu"], [role="listbox"]'))
  );
}

/** 클릭한 지점이 속한 메뉴 항목의 라벨 */
function getMenuItemLabel(target: Element | null, modal: Element): string | undefined {
  if (!target || typeof target.closest !== "function") return undefined;
  const item = target.closest(MENU_ITEM_SELECTOR);
  if (!item || !modal.contains(item)) return undefined;
  return normalizeLabel(item.getAttribute("aria-label") || item.textContent);
}

/**
 * 인박스 경로("{트리거} › {이름}")에 쓸 오버레이 이름.
 *
 * Dialog/Sheet 는 DialogTitle 을 쓰지만, 드롭다운/셀렉트는 **선택한 항목**이
 * 사람이 읽는 이름이다. (메뉴의 aria-labelledby 는 트리거를 가리켜서 그대로 쓰면
 * 경로가 "트리거 › 트리거"가 된다)
 *
 * 마커 앵커 검증(use-marker-position)도 반드시 이 함수를 써야 작성 시점 값과
 * 같은 기준으로 비교된다.
 */
export function resolveOverlayTitle(modal: Element, target: Element | null): string | undefined {
  if (isMenuLikeOverlay(modal)) return getMenuItemLabel(target, modal);
  return getModalTitle(modal);
}

/** 상호작용 요소(버튼/링크/역할)의 조상까지 올라가 사람이 읽을 라벨을 찾는다. */
function getInteractiveLabel(el: Element | null): string | undefined {
  let current: Element | null = el;
  let depth = 0;
  while (current && depth < 8) {
    if (current instanceof HTMLElement) {
      const tag = current.tagName.toLowerCase();
      const role = current.getAttribute("role");
      const interactive =
        tag === "button" ||
        tag === "a" ||
        tag === "summary" ||
        role === "button" ||
        role === "menuitem" ||
        role === "tab" ||
        role === "link" ||
        current.hasAttribute("aria-haspopup");
      if (interactive) {
        const label = normalizeLabel(current.getAttribute("aria-label") || current.textContent);
        if (label) return label;
      }
    }
    current = current.parentElement;
    depth += 1;
  }
  return undefined;
}

// #2: 프로그램적으로 여는 모달(접근성 트리거 없음)을 위해, "모달 밖에서 클릭한 마지막
// 상호작용 요소"(=모달 오프너 후보)를 추적한다. 모달 안 클릭/위젯 클릭은 기록하지 않아
// 오프너가 덮이지 않는다. 휴리스틱이므로 가끔 부정확할 수 있다.
interface LastTriggerClick {
  readonly label: string;
  readonly at: number;
}
let lastTriggerClick: LastTriggerClick | null = null;
let triggerTrackerInstalled = false;
/** 오프너 클릭으로 인정하는 최대 경과 시간(ms) — 너무 오래된 클릭은 오탐 방지 위해 무시. */
const TRIGGER_RECENCY_MS = 30_000;

/** 모달 오프너 추적기 설치(위젯 mount 시 1회). 정리 함수를 반환한다. */
export function installTriggerTracker(): () => void {
  if (typeof document === "undefined" || triggerTrackerInstalled) return () => {};
  triggerTrackerInstalled = true;
  const handler = (e: Event) => {
    const target = e.target as Element | null;
    if (!target || typeof target.closest !== "function") return;
    if (target.closest("[data-impakers-debug]")) return; // 위젯 UI 클릭 제외(피드백 모드 등)
    if (findModalContainer(target)) return; // 이미 모달 안 클릭은 오프너 아님
    const label = getInteractiveLabel(target);
    if (label) lastTriggerClick = { label, at: Date.now() };
  };
  document.addEventListener("pointerdown", handler, true); // 캡처 단계로 조기 기록
  return () => {
    document.removeEventListener("pointerdown", handler, true);
    triggerTrackerInstalled = false;
  };
}

/** 최근(임계 이내) 기록된 모달 오프너 라벨. */
function getRecentTriggerLabel(): string | undefined {
  if (!lastTriggerClick) return undefined;
  if (Date.now() - lastTriggerClick.at > TRIGGER_RECENCY_MS) return undefined;
  return lastTriggerClick.label;
}

/**
 * 모달을 연 트리거(버튼) **엘리먼트**를 찾는다.
 *
 * Radix는 트리거에 aria-controls={모달 id}, 모달 컨텐츠에 id를 부여하므로 그 관계로
 * 역추적한다. 없으면 펼쳐진 dialog/menu/listbox 트리거를 쓴다.
 * 최근-클릭 휴리스틱은 여기서 쓰지 않는다 — 라벨 표시라면 몰라도, 마커를 걸 앵커로는
 * 틀린 버튼을 잡을 위험이 있다.
 */
export function getModalTriggerElement(modal: Element): Element | null {
  const id = modal.id;
  if (id) {
    const escaped =
      typeof CSS !== "undefined" && typeof CSS.escape === "function" ? CSS.escape(id) : id;
    try {
      const byControls = document.querySelector(`[aria-controls="${escaped}"]`);
      if (byControls) return byControls;
    } catch {
      // 잘못된 셀렉터 — 아래 폴백으로
    }
  }
  return document.querySelector(
    '[aria-haspopup="dialog"][aria-expanded="true"], [aria-haspopup="menu"][aria-expanded="true"], [aria-haspopup="listbox"][aria-expanded="true"]',
  );
}

/**
 * 모달을 연 트리거(버튼)의 접근성 레이블을 찾는다.
 * 못 찾으면 최근 클릭한 오프너 라벨(폴백)을 쓴다.
 */
export function getModalTrigger(modal: Element): string | undefined {
  const trigger = getModalTriggerElement(modal);
  if (!trigger) return getRecentTriggerLabel(); // 프로그램적 모달 폴백
  return normalizeLabel(trigger.getAttribute("aria-label") || trigger.textContent);
}

function getModalSourceCandidate(modal: HTMLElement): string | undefined {
  const result = getSourceLocation(modal);
  const location = result.found ? result : findNearestComponentSource(modal);
  return location.found && location.source
    ? formatSourceLocation(location.source, "path")
    : undefined;
}

/** 드롭다운/셀렉트처럼 떠 있는 레이어인지 (본문 흐름에 있는 role=menu 내비게이션과 구분) */
function isFloatingLayer(el: HTMLElement): boolean {
  if (typeof window === "undefined") return false;
  const position = window.getComputedStyle(el).position;
  return position === "fixed" || position === "absolute";
}

/** 시맨틱하게 명확한 모달 컨테이너인지 (role=dialog, aria-modal, <dialog>, Radix/shadcn 등) */
function isSemanticModal(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.tagName === "DIALOG" && (el as HTMLDialogElement).open) return true;

  const role = el.getAttribute("role");
  if (role === "dialog" || role === "alertdialog") return true;
  if (el.getAttribute("aria-modal") === "true") return true;

  // Radix / shadcn (Dialog·Sheet·Drawer 모두 dialog content로 렌더)
  if (el.hasAttribute("data-radix-dialog-content")) return true;
  if (el.hasAttribute("data-radix-alert-dialog-content")) return true;
  // Vaul drawer
  if (el.hasAttribute("data-vaul-drawer")) return true;
  // Headless UI
  if (el.hasAttribute("data-headlessui-state") && el.getAttribute("role") === "dialog") return true;

  // 팝오버 계열(드롭다운·컨텍스트 메뉴·셀렉트)도 body로 portal되는 오버레이다.
  // Popover는 role=dialog라 위에서 걸리지만 Menu는 role=menu, Select는 role=listbox라
  // 별도로 인정하지 않으면 "페이지에서 작성"으로 기록돼 ① 인박스 경로가 비고
  // ② 앵커 소실 시 마커를 숨기는 보호(K3)도 걸리지 않는다.
  if (el.hasAttribute("data-radix-menu-content")) return true;
  if (el.hasAttribute("data-radix-popper-content-wrapper")) return true;
  if ((role === "menu" || role === "listbox") && isFloatingLayer(el)) return true;

  return false;
}

/**
 * 시맨틱 신호가 없는 커스텀 모달 대비 폴백:
 * position:fixed + 상당한 z-index + 뷰포트의 큰 영역을 덮는 오버레이(사이드 모달/드로어 포함).
 */
function isOverlayLikeModal(el: Element): boolean {
  if (typeof window === "undefined" || !(el instanceof HTMLElement)) return false;
  const style = window.getComputedStyle(el);
  if (style.position !== "fixed") return false;
  const z = parseInt(style.zIndex, 10);
  if (!Number.isFinite(z) || z < 40) return false;

  const rect = el.getBoundingClientRect();
  const coversWidth = rect.width >= window.innerWidth * 0.6;
  const coversHeight = rect.height >= window.innerHeight * 0.6;
  // 일반 모달(넓고 김) 또는 사이드 모달/드로어(한 축이 뷰포트를 크게 덮음)
  return coversWidth || coversHeight;
}

/**
 * 요소의 조상을 거슬러 올라가며 모달 컨테이너 엘리먼트를 찾아 반환한다.
 * 위젯 자신([data-impakers-debug]) 내부 요소면 모달로 보지 않는다(null).
 *
 * 스크린샷 캡처 대상 선정 등, 모달 "엘리먼트" 자체가 필요한 곳에서 사용한다.
 */
export function findModalContainer(el: Element | null): HTMLElement | null {
  let current: Element | null = el;
  let depth = 0;
  while (current && current !== document.body && current !== document.documentElement && depth < 30) {
    if (current instanceof HTMLElement && current.closest("[data-impakers-debug]")) {
      // 위젯 내부 요소는 모달 판정에서 제외
      return null;
    }
    if (isSemanticModal(current) || isOverlayLikeModal(current)) {
      return current as HTMLElement;
    }
    current = current.parentElement;
    depth += 1;
  }
  return null;
}

/**
 * 닫히면 DOM 에서 사라지는 "떠 있는" 오버레이인지 — 드롭다운·셀렉트·팝오버·툴팁.
 *
 * Dialog/Sheet 와 구분하는 이유: 이들은 사용자가 의도적으로 다시 여는 화면이라
 * 마커를 내부에 두는 편이 정확하다. 반면 팝오버 계열은 클릭 한 번에 사라지고
 * 트리거와의 관계(aria-controls/aria-haspopup)가 명시적이라, 닫힌 동안 마커를
 * 트리거에 걸어두는 편이 실용적이다.
 */
function isTransientOverlay(modal: Element): boolean {
  if (isMenuLikeOverlay(modal)) return true;
  if (modal.getAttribute("role") === "tooltip") return true;
  // Radix Popover 는 role=dialog 지만 popper wrapper 안에 렌더된다 (Dialog 는 아님)
  return (
    typeof modal.closest === "function" &&
    Boolean(modal.closest("[data-radix-popper-content-wrapper]"))
  );
}

/**
 * 요소의 조상을 거슬러 올라가며 모달 컨텍스트(구분 표시·앵커 재해석용)를 수집한다.
 */
export function detectModalContext(el: Element | null): ModalContext {
  const modal = findModalContainer(el);
  if (!modal) return { isInModal: false };
  return {
    isInModal: true,
    modalSelector: buildStableSelector(modal) ?? undefined,
    modalTitle: resolveOverlayTitle(modal, el),
    modalTrigger: getModalTrigger(modal),
    modalSourceCandidate: getModalSourceCandidate(modal),
    triggerAnchorSelector: isTransientOverlay(modal)
      ? buildStableSelector(getModalTriggerElement(modal)) ?? undefined
      : undefined,
  };
}
