"use client";

import { useEffect, useState } from "react";

// =============================================================================
// FAB 크기 — 반응형
// =============================================================================
//
// FAB의 겉모습(버튼·아이콘 크기)은 CSS 미디어 쿼리가 정한다. 첫 페인트부터
// 맞아야 하기 때문이다. 하지만 메뉴 정렬, leftSlot 위치, 드래그 클램프는 좌표를
// 직접 계산해야 해서 JS도 현재 크기를 알아야 한다.
//
// !!! 주의 !!!
// 아래 값들은 `styles/_tokens.scss`의 $fab-desktop-min / $fab-size / $fab-size-lg
// 와 반드시 같아야 한다. 한쪽만 고치면 데스크톱에서 메뉴가 FAB과 어긋난다.
// =============================================================================

/** styles/_tokens.scss의 `$fab-desktop-min` */
export const FAB_DESKTOP_MIN_WIDTH = 768;

/** styles/_tokens.scss의 `$fab-size` / `$fab-size-lg` */
export const FAB_SIZE = { base: 44, desktop: 48 } as const;

/**
 * 현재 뷰포트에 적용된 FAB 지름(px).
 *
 * SSR과 첫 렌더에서는 모바일 크기를 돌려준다 — 서버에서는 뷰포트를 알 수 없고,
 * 겉모습은 어차피 CSS가 맞춰주므로 좌표 계산만 마운트 직후 따라잡으면 된다.
 */
export function useFabSize(): number {
  const [size, setSize] = useState<number>(FAB_SIZE.base);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;

    const query = window.matchMedia(`(min-width: ${FAB_DESKTOP_MIN_WIDTH}px)`);
    const apply = () => setSize(query.matches ? FAB_SIZE.desktop : FAB_SIZE.base);

    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);

  return size;
}
