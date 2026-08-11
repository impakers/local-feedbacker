"use client";

import { useCallback, useEffect, useState } from "react";
import { resolveImages } from "./resolve-images";
import styles from "./styles.module.scss";

export { resolveImages };

/**
 * 코멘트 첨부 사진을 한 덩어리(그룹 사진)로 보여준다.
 *
 * - 1장: 기존 단일 첨부와 동일한 모양
 * - 2·4장: 2열 격자 / 그 외: 3열 격자 (정사각 크롭)
 * - 6장 초과분은 마지막 칸에 "+N" — 라이트박스에서 좌우로 전부 넘겨볼 수 있다
 *
 * OS는 image_url(첫 장) + image_urls(전체)를 함께 내려주므로,
 * 호출부는 `resolveImages()`로 구버전 응답(단일)과 신버전(그룹)을 같은 배열로 다룬다.
 */
export interface PhotoGroupProps {
  images: string[];
  /** 그리드 클릭이 상위(피드백 카드 선택 등)로 번지지 않게 할 때 */
  stopPropagation?: boolean;
}

const MAX_TILES = 6;

export function PhotoGroup({ images, stopPropagation }: PhotoGroupProps) {
  const [index, setIndex] = useState<number | null>(null);
  const list = images.filter(Boolean);

  const close = useCallback(() => setIndex(null), []);
  const step = useCallback(
    (delta: number) =>
      setIndex((cur) => (cur === null ? cur : (cur + delta + list.length) % list.length)),
    [list.length],
  );

  useEffect(() => {
    if (index === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); close(); }
      if (e.key === "ArrowRight") step(1);
      if (e.key === "ArrowLeft") step(-1);
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [index, close, step]);

  if (list.length === 0) return null;

  const open = (e: React.MouseEvent, i: number) => {
    if (stopPropagation) e.stopPropagation();
    setIndex(i);
  };

  const tiles = list.slice(0, MAX_TILES);
  const overflow = list.length - tiles.length;

  return (
    <>
      {list.length === 1 ? (
        <div className={styles.single} onClick={(e) => open(e, 0)}>
          <img src={list[0]} alt="attachment" />
        </div>
      ) : (
        <div
          className={`${styles.grid} ${list.length === 2 || list.length === 4 ? styles.cols2 : styles.cols3}`}
        >
          {tiles.map((src, i) => (
            <div key={`${src}-${i}`} className={styles.tile} onClick={(e) => open(e, i)}>
              <img src={src} alt={`attachment ${i + 1}`} />
              {i === tiles.length - 1 && overflow > 0 && (
                <span className={styles.more}>+{overflow}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {index !== null && (
        <div
          className={styles.lightbox}
          onClick={(e) => { e.stopPropagation(); close(); }}
          data-impakers-debug=""
        >
          <img src={list[index]} alt="enlarged" onClick={(e) => e.stopPropagation()} />
          <button
            className={styles.close}
            onClick={(e) => { e.stopPropagation(); close(); }}
            type="button"
          >
            &times;
          </button>
          {list.length > 1 && (
            <>
              <button
                className={`${styles.nav} ${styles.prev}`}
                onClick={(e) => { e.stopPropagation(); step(-1); }}
                type="button"
                aria-label="이전 사진"
              >
                &#8249;
              </button>
              <button
                className={`${styles.nav} ${styles.next}`}
                onClick={(e) => { e.stopPropagation(); step(1); }}
                type="button"
                aria-label="다음 사진"
              >
                &#8250;
              </button>
              <div className={styles.counter}>
                {index + 1} / {list.length}
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
