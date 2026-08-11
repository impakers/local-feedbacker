"use client";

import { useSyncExternalStore } from "react";

/**
 * 단일 글로벌 스크롤/리사이즈 리스너.
 * 매 rAF로 throttle된 tick 카운터를 제공하여,
 * 모든 마커가 같은 프레임에 위치를 재계산하도록 한다.
 */

type Listener = () => void;

let tick = 0;
let rafScheduled = false;
const listeners = new Set<Listener>();
let installed = false;

function notify() {
  rafScheduled = false;
  tick = (tick + 1) % Number.MAX_SAFE_INTEGER;
  listeners.forEach((l) => l());
}

function schedule() {
  if (rafScheduled) return;
  rafScheduled = true;
  requestAnimationFrame(notify);
}

/**
 * Sheet/Drawer처럼 화면 밖에서 진입하는 오버레이는 열림 직후 첫 계산 때 앵커가
 * viewport 밖에 있을 수 있다. 애니메이션·트랜지션이 끝난 뒤 한 번 더 위치를 계산한다.
 */
export function subscribeToLayoutSettlement(onSettled: () => void): () => void {
  const eventTypes = ["animationend", "transitionend"] as const;
  for (const eventType of eventTypes) {
    document.addEventListener(eventType, onSettled, true);
  }
  return () => {
    for (const eventType of eventTypes) {
      document.removeEventListener(eventType, onSettled, true);
    }
  };
}

function install() {
  if (installed) return;
  installed = true;
  // capture phase로 등록해야 내부 스크롤 컨테이너의 scroll 이벤트도 잡힘
  document.addEventListener("scroll", schedule, { capture: true, passive: true });
  window.addEventListener("resize", schedule, { passive: true });
  // ResizeObserver: 콘텐츠 사이즈 변화도 추적
  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(schedule);
    ro.observe(document.documentElement);
    if (document.body) ro.observe(document.body);
  }
  // MutationObserver: 모달/오버레이가 열리거나 닫히면(포털 노드 추가/삭제, data-state 토글)
  // 마커가 앵커를 다시 해석하도록 tick 발생. rAF throttle이 있어 대량 변경도 프레임당 1회로 병합됨.
  if (typeof MutationObserver !== "undefined" && document.body) {
    const mo = new MutationObserver(schedule);
    mo.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      // 모달 열림 신호로 흔한 속성만 관찰(style/class 잡음 회피)
      attributeFilter: ["data-state", "aria-hidden", "aria-modal", "open", "hidden"],
    });
  }
  subscribeToLayoutSettlement(schedule);
}

function subscribe(listener: Listener): () => void {
  if (typeof window !== "undefined") install();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): number {
  return tick;
}

function getServerSnapshot(): number {
  return 0;
}

/**
 * 마커가 viewport 위치를 다시 계산하도록 트리거하는 훅.
 * 반환값(tick)은 의존성으로 사용할 수 있다.
 */
export function useViewportTick(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
