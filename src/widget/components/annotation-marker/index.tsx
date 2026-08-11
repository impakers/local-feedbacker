import { Annotation } from "../../types";
import { useMarkerPosition } from "../../hooks/use-marker-position";
import styles from "./styles.module.scss";

// =============================================================================
// AnnotationMarker
// =============================================================================

/** 완료 마커는 상태와 무관하게 회색으로 죽인다. */
const DONE_MARKER_COLOR = "#9ca3af"; // gray

/** 할 일 마커: 선택 색을 흰색과 섞어 만드는 연한 톤의 비율(0~1). 값이 클수록 연해진다. */
export const TODO_TINT_AMOUNT = 0.45;

/** hex 색을 흰색 쪽으로 amount(0~1)만큼 섞어 연한 색을 만든다. */
export function lightenHex(hex: string, amount: number): string {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!match) return hex;
  const int = parseInt(match[1], 16);
  const mix = (channel: number) => Math.round(channel + (255 - channel) * amount);
  const r = mix((int >> 16) & 0xff);
  const g = mix((int >> 8) & 0xff);
  const b = mix(int & 0xff);
  const toHex = (channel: number) => channel.toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * 상태별 마커 색. 할 일 = 선택 색의 연한 톤, 진행중 = 선택한 진한 색, 완료 = 회색.
 * 선택 색(accentColor)은 설정 패널의 마커 색상으로 결정된다.
 */
export function getMarkerColor(status: Annotation["status"] | string, accentColor: string): string {
  if (status === "done" || status === "resolved") return DONE_MARKER_COLOR;
  if (status === "in_progress") return accentColor;
  if (status === "todo") return lightenHex(accentColor, TODO_TINT_AMOUNT);
  return accentColor;
}

type MarkerLabelOptions = {
  isMine: boolean;
  authorId?: string;
  authorName?: string;
  index: number;
};

type MarkerAuthorSource = {
  authorId?: string | null;
  authorName?: string | null;
};

/**
 * Older local markers may not contain author metadata. Hydrate those fields
 * from the matching server task before rendering the marker label.
 */
export function mergeMarkerAuthor(
  annotation: Annotation,
  task?: MarkerAuthorSource,
): Annotation {
  return {
    ...annotation,
    authorId: annotation.authorId?.trim() || task?.authorId?.trim() || undefined,
    authorName: annotation.authorName?.trim() || task?.authorName?.trim() || undefined,
  };
}

export function getMarkerLabel({ isMine, authorId, authorName, index }: MarkerLabelOptions): string {
  const normalizedAuthorId = authorId?.trim();
  const normalizedAuthorName = authorName?.trim();
  const authorInitial = normalizedAuthorName
    ? Array.from(normalizedAuthorName)[0]
    : normalizedAuthorId
      ? Array.from(normalizedAuthorId)[0]
      : undefined;

  return !isMine && authorInitial ? authorInitial : String(index + 1);
}

type AnnotationMarkerProps = {
  annotation: Annotation;
  layerIndex: number;
  isAnimated: boolean;
  isHovered: boolean;
  accentColor: string;
  /** 현재 위젯 로그인 유저가 작성한 피드백이면 소유 링을 표시 */
  isMine?: boolean;
  markerClickBehavior: "edit" | "delete";
  /** "모달에서 작성됨" 배지 문구. 미지정 시 기존 한국어 문구. */
  modalBadgeLabel?: string;
  onHover: () => void;
  onHoverEnd: () => void;
  onClick: () => void;
  onContextMenu?: () => void;
  isDeleting?: boolean;
};

export function AnnotationMarker({
  annotation,
  layerIndex,
  isAnimated,
  isHovered,
  accentColor,
  isMine = false,
  modalBadgeLabel = "모달에서 작성됨",
  onHover,
  onHoverEnd,
  onClick,
}: AnnotationMarkerProps) {
  const animClass = !isAnimated ? styles.enter : "";
  const isDone = annotation.status === "done" || annotation.status === "resolved";
  const isInProgress = annotation.status === "in_progress";
  // 색 = 상태(할 일=선택색 연한 톤, 진행중=선택한 진한 색, 완료=회색). 소유 여부는 링으로 구분.
  const markerColor = getMarkerColor(annotation.status, accentColor);
  const isInModal = annotation.isInModal === true;
  const markerLabel = getMarkerLabel({
    isMine,
    authorId: annotation.authorId,
    authorName: annotation.authorName,
    index: layerIndex,
  });

  const pos = useMarkerPosition(annotation);
  if (!pos.visible) return null;

  return (
    <div
      className={`${styles.marker} ${animClass} ${isHovered ? styles.hovered : ""} ${isDone ? styles.done : ""} ${isInProgress ? styles.inProgress : ""} ${isMine ? styles.mine : ""}`}
      data-annotation-marker
      style={{
        left: pos.x,
        top: pos.y,
        backgroundColor: markerColor,
        animationDelay: `${layerIndex * 20}ms`,
        // 소유 링 색 = 유저가 고른 마커 색(자기 정체성 색). 상태 색과 별개 채널.
        ["--mine-ring" as string]: accentColor,
      }}
      onMouseEnter={onHover}
      onMouseLeave={onHoverEnd}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <span className={styles.markerLabel}>{markerLabel}</span>

      {isInModal && (
        <span className={styles.modalBadge} title={modalBadgeLabel} aria-label={modalBadgeLabel} />
      )}

      {isHovered && (annotation.authorName || annotation.comment) && (
        <div className={`${styles.markerTooltip} ${styles.enter}`}>
          {annotation.authorName && (
            <span className={styles.markerAuthor}>{annotation.authorName}</span>
          )}
          {annotation.comment && (
            <span className={styles.markerNote}>{annotation.comment}</span>
          )}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// PendingMarker
// =============================================================================

type PendingMarkerProps = {
  x: number;
  y: number;
  isMultiSelect: boolean;
  accentColor: string;
};

export function PendingMarker({ x, y, accentColor }: PendingMarkerProps) {
  return (
    <div
      className={`${styles.pending} ${styles.enter}`}
      data-annotation-marker
      style={{
        left: `${x}%`,
        top: y,
        backgroundColor: accentColor,
      }}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
        <line x1="12" y1="5" x2="12" y2="19" />
        <line x1="5" y1="12" x2="19" y2="12" />
      </svg>
    </div>
  );
}
