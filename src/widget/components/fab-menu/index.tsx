"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { IconImpakersOrbit } from "../icons";
import { useFabSize } from "../../utils/fab-size";
import styles from "./styles.module.scss";

export interface FabMenuItem {
  id: string;
  icon: React.ReactNode;
  label: string;
  badge?: number;
  active?: boolean;
}

/**
 * hover 동안의 별빛 속도 배수. 쉴 때는 느리게 돌다가 다가가면 살아난다.
 *
 * CSS 애니메이션은 **쉴 때 기준(느린 duration)** 으로 걸려 있고, 여기서 배속만
 * 올린다. duration을 갈아서는 못 바꾼다 — 진행률이 `경과시간 / duration`으로
 * 다시 계산돼 혜성이 엉뚱한 자리로 순간이동한다. playbackRate는 현재 위치를
 * 보존하므로 흐름이 끊기지 않는다.
 */
const ORBIT_HOVER_RATE = 2;

/** 속도가 계단처럼 바뀌지 않게 이만큼에 걸쳐 배수를 옮긴다 */
const ORBIT_RATE_RAMP_MS = 380;

export interface FabMenuProps {
  items: FabMenuItem[];
  onSelect: (id: string) => void;
  onHide?: () => void;
  /** FAB 더블클릭/더블탭 시 호출 (피드백 모드 바로 진입) */
  onDoubleTap?: () => void;
  /** 확인하지 않은 알림이 있으면 FAB에 dot 표시 */
  hasUnread?: boolean;
  /** 에이전트 응답 등 미확인 수. 0보다 크면 FAB 우상단에 숫자 배지 표시. */
  agentUnreadCount?: number;
  /** FAB 왼쪽에 렌더링할 슬롯 (에이전트 응답 토스트 등). FAB 위치를 따라다님. */
  leftSlot?: React.ReactNode;
  /** 트리거 버튼의 aria-label. 미지정 시 기존 한국어 문구. */
  triggerAriaLabel?: string;
  /** 우클릭 메뉴 "위젯 숨기기" 라벨. 미지정 시 기존 한국어 문구. */
  hideWidgetLabel?: string;
}

export function FabMenu({ items, onSelect, onHide, onDoubleTap, hasUnread, agentUnreadCount, leftSlot, triggerAriaLabel, hideWidgetLabel }: FabMenuProps) {
  const [expanded, setExpanded] = useState(false);
  const [closing, setClosing] = useState(false);
  const [position, setPosition] = useState({ right: 24, bottom: 24 });
  const [showContextMenu, setShowContextMenu] = useState<{ x: number; y: number } | null>(null);

  // 겉모습은 CSS가 정하지만 아래 좌표 계산에는 실제 지름이 필요하다.
  const fabSize = useFabSize();

  const fabRef = useRef<HTMLButtonElement>(null);
  const dragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const dragOffset = useRef({ x: 0, y: 0 });
  const hasMoved = useRef(false);
  const lastTapTime = useRef(0);

  // 별빛 속도 조절 (오빗 아이콘). 지금 배수를 들고 있어야 hover를 빠르게
  // 들락거려도 진행 중인 램프에서 이어받는다.
  const orbitRate = useRef(1);
  const orbitRaf = useRef(0);

  const rampOrbitRate = useCallback((to: number) => {
    const flows = fabRef.current?.querySelectorAll("[data-orbit-flow]");
    // getAnimations 미지원 브라우저에서는 그냥 원래 속도로 계속 흐른다.
    if (!flows?.length || typeof flows[0].getAnimations !== "function") return;

    cancelAnimationFrame(orbitRaf.current);
    const from = orbitRate.current;
    const start = performance.now();

    const step = (now: number) => {
      const p = Math.min(1, (now - start) / ORBIT_RATE_RAMP_MS);
      const eased = 1 - (1 - p) ** 3; // ease-out — 바로 반응하고 끝에서 안착
      orbitRate.current = from + (to - from) * eased;

      flows.forEach((el) => {
        // playbackRate는 현재 위치를 보존한다. 매 프레임 조금씩 바꾸므로
        // 구현 오차가 있어도 눈에 띄지 않는다.
        el.getAnimations().forEach((anim) => {
          anim.playbackRate = orbitRate.current;
        });
      });

      if (p < 1) orbitRaf.current = requestAnimationFrame(step);
    };

    orbitRaf.current = requestAnimationFrame(step);
  }, []);

  useEffect(() => () => cancelAnimationFrame(orbitRaf.current), []);

  // Drag
  const handleFabPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button === 2) return;
    dragging.current = true;
    hasMoved.current = false;
    const btn = fabRef.current;
    if (!btn) return;
    btn.setPointerCapture(e.pointerId);
    const rect = btn.getBoundingClientRect();
    dragStart.current = { x: e.clientX, y: e.clientY };
    dragOffset.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  const handleFabPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    if (Math.abs(e.clientX - dragStart.current.x) > 3 || Math.abs(e.clientY - dragStart.current.y) > 3) {
      hasMoved.current = true;
    }
    if (!hasMoved.current) return;
    setPosition({
      right: Math.max(8, Math.min(window.innerWidth - e.clientX - (fabSize - dragOffset.current.x), window.innerWidth - (fabSize + 8))),
      bottom: Math.max(8, Math.min(window.innerHeight - e.clientY - (fabSize - dragOffset.current.y), window.innerHeight - (fabSize + 8))),
    });
  }, [fabSize]);

  const handleFabPointerUp = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    fabRef.current?.releasePointerCapture(e.pointerId);
    dragging.current = false;
    if (!hasMoved.current) {
      const now = Date.now();
      const isDoubleTap = now - lastTapTime.current < 350;
      lastTapTime.current = now;

      if (isDoubleTap && onDoubleTap) {
        // 더블탭 → 바로 피드백 모드 진입
        if (expanded) closeMenu();
        onDoubleTap();
        return;
      }

      if (expanded) {
        closeMenu();
      } else {
        setExpanded(true);
      }
    }
  }, [expanded, onDoubleTap]);

  const closeMenu = useCallback(() => {
    setClosing(true);
    setTimeout(() => { setExpanded(false); setClosing(false); }, 150);
  }, []);

  // Context menu
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setShowContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  // Outside click
  useEffect(() => {
    if (!expanded && !showContextMenu) return;
    const handler = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest("[data-impakers-fab]")) return;
      if (showContextMenu) { setShowContextMenu(null); return; }
      if (expanded) closeMenu();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [expanded, showContextMenu, closeMenu]);

  return (
    <>
      {/* 메뉴 아이템 — FAB 위에 고정 위치 */}
      {(expanded || closing) && (
        <div
          className={styles.menuItems}
          style={{
            position: "fixed",
            right: position.right + (fabSize - 40) / 2, // 메뉴(40px)를 FAB 가운데 정렬
            bottom: position.bottom + fabSize + 8, // FAB 위로 8px gap
          }}
          data-impakers-debug=""
          data-impakers-fab=""
        >
          {[...items].reverse().map((item, i) => (
            <button
              key={item.id}
              className={`${styles.menuItem} ${item.active ? styles.active : ""} ${closing ? styles.menuItemClosing : ""}`}
              style={{ animationDelay: closing ? `${i * 30}ms` : `${(items.length - 1 - i) * 40}ms` }}
              onClick={(e) => { e.stopPropagation(); onSelect(item.id); closeMenu(); }}
              type="button"
              data-impakers-fab=""
              data-impakers-debug=""
            >
              {item.icon}
              <span className={styles.tooltip}>{item.label}</span>
              {item.badge && item.badge > 0 ? (
                <span className={styles.badge}>{item.badge > 99 ? "99+" : item.badge}</span>
              ) : null}
            </button>
          ))}
        </div>
      )}

      {/* Left-of-FAB slot (에이전트 응답 토스트 등). FAB 위치를 따라다님. */}
      {leftSlot && (
        <div
          style={{
            position: "fixed",
            right: position.right + fabSize + 10, // FAB 너비 + 10px gap
            bottom: position.bottom,
            zIndex: 2147483646,
            pointerEvents: "auto",
          }}
          data-impakers-debug=""
          data-impakers-fab=""
        >
          {leftSlot}
        </div>
      )}

      {/* Main FAB — 항상 같은 위치 */}
      <button
        ref={fabRef}
        className={styles.fab}
        style={{ position: "fixed", right: position.right, bottom: position.bottom }}
        onPointerDown={handleFabPointerDown}
        onPointerMove={handleFabPointerMove}
        onPointerUp={handleFabPointerUp}
        onContextMenu={handleContextMenu}
        onMouseEnter={() => rampOrbitRate(ORBIT_HOVER_RATE)}
        onMouseLeave={() => rampOrbitRate(1)}
        type="button"
        aria-label={triggerAriaLabel || "피드백 메뉴"}
        data-impakers-debug=""
        data-impakers-fab=""
      >
        <IconImpakersOrbit expanded={expanded} pulsing={hasUnread} />
        {hasUnread && agentUnreadCount === 0 && <span className={styles.unreadDot} />}
        {agentUnreadCount && agentUnreadCount > 0 ? (
          <span className={styles.fabBadge}>
            {agentUnreadCount > 99 ? "99+" : agentUnreadCount}
          </span>
        ) : null}
      </button>

      {/* Context menu */}
      {showContextMenu && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 2147483647 }}
          onMouseDown={() => setShowContextMenu(null)}
          data-impakers-debug=""
          data-impakers-fab=""
        >
          <div
            className={styles.contextMenu}
            style={{ position: "fixed", left: showContextMenu.x, top: showContextMenu.y, zIndex: 2147483647 }}
            onMouseDown={(e) => e.stopPropagation()}
            data-impakers-fab=""
          >
            <button
              className={styles.contextMenuItem}
              onMouseDown={(e) => { e.stopPropagation(); setShowContextMenu(null); onHide?.(); }}
              type="button"
            >
              {hideWidgetLabel || "위젯 숨기기"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
