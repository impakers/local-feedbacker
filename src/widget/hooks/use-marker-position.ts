"use client";

import { useMemo } from "react";
import type { Annotation } from "../types";
import { findBySelector } from "../utils/stable-selector";
import { findModalContainer, resolveOverlayTitle } from "../utils/modal-context";
import { useViewportTick } from "./use-viewport-tick";

export type MarkerPosition = {
  /** 뷰포트 기준 x (px) */
  x: number;
  /** 뷰포트 기준 y (px) */
  y: number;
  /** 마커가 현재 화면에 표시되어야 하는지 */
  visible: boolean;
  /** 위치 계산 모드: anchor(요소 기준) | trigger(오버레이 트리거 기준) | legacy(좌표 기준) */
  mode: "anchor" | "trigger" | "legacy-fixed" | "legacy-doc";
};

/**
 * 모달/Sheet/Popover 등 body-portal 오버레이에서 작성된 마커의 앵커가
 * "작성 당시 그 모달" 안에 있는지 검증한다.
 *
 * Radix 오버레이는 <body>로 portal되고 안정적 식별자가 없어(자동 id는 거부됨)
 * 앵커가 위치 기반 셀렉터(div:nth-of-type…)로 잡힌다. 원래 오버레이가 닫히고
 * 다른 오버레이가 열리면 같은 위치 셀렉터가 엉뚱한 오버레이의 요소에 매칭돼
 * 마커가 그쪽으로 새는 문제가 있다.
 *
 * 그래서 isInModal 마커는 "앵커를 감싼 현재 모달"이 작성 당시 모달과 동일할 때만 유효하다고 본다.
 * 판별 우선순위:
 *   1) modalTitle(DialogTitle) — 같은 portal 위치에 뜨는 여러 Dialog(제목만 다름)를 구분하는
 *      유일하게 신뢰 가능한 신호. (셀렉터는 body>div:nth-of-type(N)으로 전부 동일해서 무력)
 *   2) modalSelector — 제목이 없는 오버레이(Popover 등)용 폴백.
 * 판별 정보가 전혀 없으면(구버전 마커) 검증을 생략한다.
 */
export function isAnchorInCapturedModal(el: Element, annotation: Annotation): boolean {
  if (!annotation.isInModal) return true;
  if (!annotation.modalTitle && !annotation.modalSelector) return true; // 구버전: 검증 생략
  const liveModal = findModalContainer(el);
  if (!liveModal) return false; // 모달에서 작성됐는데 앵커가 모달 밖 → 잘못 매칭
  if (annotation.modalTitle) {
    return resolveOverlayTitle(liveModal, el) === annotation.modalTitle;
  }
  return findBySelector(annotation.modalSelector!) === liveModal;
}

/** 오래된 selector가 다른 포털 요소를 가리키면 그 경계로 마커를 숨기지 않는다. */
export function shouldClipMarkerToContainer(
  container: Element,
  anchor: Element,
  x: number,
  y: number,
): boolean {
  if (!container.contains(anchor)) return false;
  const rect = container.getBoundingClientRect();
  return x < rect.left || x > rect.right || y < rect.top || y > rect.bottom;
}

/**
 * 마커의 viewport 좌표를 계산한다.
 *
 * 우선순위:
 *   1. annotation.anchorSelector로 요소를 다시 찾고, getBoundingClientRect + offsetRatio로 위치 계산
 *   2. 앵커가 사라졌고 triggerAnchorSelector가 있으면(드롭다운/팝오버) 트리거 버튼 중앙
 *   3. annotation.isFixed가 true면 (x% * innerWidth, y) — 뷰포트 좌표
 *   4. 기본: (x% * innerWidth, y - window.scrollY) — 문서 좌표를 viewport로 변환
 */
export function useMarkerPosition(annotation: Annotation): MarkerPosition {
  const tick = useViewportTick();

  return useMemo(() => {
    void tick; // tick은 useMemo 무효화 트리거
    if (typeof window === "undefined") {
      return { x: 0, y: 0, visible: false, mode: "legacy-doc" };
    }

    // 1) anchor selector로 요소 위치 계산
    if (annotation.anchorSelector) {
      const el = findBySelector(annotation.anchorSelector);
      // 앵커가 다른 오버레이의 요소로 잘못 매칭되면(포털 위치 셀렉터 충돌) 무효 처리
      if (el && isAnchorInCapturedModal(el, annotation)) {
        const rect = el.getBoundingClientRect();
        // 요소가 0크기로 접혀 있으면 anchor가 무효화 — fallback으로 넘어감
        if (rect.width > 0 || rect.height > 0) {
          const rx = annotation.offsetRatioX ?? 0.5;
          const ry = annotation.offsetRatioY ?? 0.5;
          const x = rect.left + rect.width * rx;
          const y = rect.top + rect.height * ry;
          const vw = window.innerWidth;
          const vh = window.innerHeight;
          // 요소가 뷰포트 밖이면 마커도 숨김 (가장자리 인디케이터는 후속 작업)
          let visible =
            rect.bottom > 0 && rect.top < vh && rect.right > 0 && rect.left < vw;
          // 스크롤 컨테이너(패널/모달 등) 밖으로 스크롤된 지점이면 숨김 → 컨테이너 밖에 떠 있는 문제 방지
          if (visible && annotation.scrollContainerSelector) {
            const container = findBySelector(annotation.scrollContainerSelector);
            if (
              container &&
              container !== document.scrollingElement &&
              container !== document.documentElement &&
              container !== document.body
            ) {
              if (shouldClipMarkerToContainer(container, el, x, y)) {
                visible = false;
              }
            }
          }
          return { x, y, visible, mode: "anchor" };
        }
      }
      // 1-b) 드롭다운/팝오버가 닫혀 앵커가 사라졌다면 트리거 버튼에 마커를 건다.
      // 메뉴 항목은 메뉴를 열기 전에는 DOM 에 없어서, 그대로 두면 피드백이 남아
      // 있다는 사실 자체가 화면에서 사라진다.
      const trigger = annotation.triggerAnchorSelector
        ? findBySelector(annotation.triggerAnchorSelector)
        : null;
      if (trigger) {
        const rect = trigger.getBoundingClientRect();
        if (rect.width > 0 || rect.height > 0) {
          const x = rect.left + rect.width / 2;
          const y = rect.top + rect.height / 2;
          const visible =
            rect.bottom > 0 &&
            rect.top < window.innerHeight &&
            rect.right > 0 &&
            rect.left < window.innerWidth;
          return { x, y, visible, mode: "trigger" };
        }
      }

      // 앵커를 못 찾거나 0크기: 모달 등 동적 컨테이너에서 작성된 마커라면
      // 잘못된 레거시 좌표로 엉뚱하게 띄우지 말고 숨긴다. 컨테이너가 다시 나타나면
      // (MutationObserver tick) 재해석되어 복원된다. (K3)
      if (annotation.isInModal) {
        return { x: 0, y: 0, visible: false, mode: "anchor" };
      }
    }

    // 2) legacy fixed: y는 viewport 좌표
    if (annotation.isFixed) {
      const x = (annotation.x / 100) * window.innerWidth;
      const y = annotation.y;
      return { x, y, visible: true, mode: "legacy-fixed" };
    }

    // 3) legacy document: y는 문서 좌표 → viewport로 변환
    const x = (annotation.x / 100) * window.innerWidth;
    const y = annotation.y - window.scrollY;
    const visible = y > -50 && y < window.innerHeight + 50;
    return { x, y, visible, mode: "legacy-doc" };
  }, [
    tick,
    annotation.anchorSelector,
    annotation.offsetRatioX,
    annotation.offsetRatioY,
    annotation.isFixed,
    annotation.x,
    annotation.y,
    annotation.scrollContainerSelector,
    annotation.triggerAnchorSelector,
    annotation.isInModal,
    annotation.modalSelector,
    annotation.modalTitle,
  ]);
}
