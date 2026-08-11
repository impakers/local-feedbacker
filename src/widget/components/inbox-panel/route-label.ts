export interface ModalRouteParts {
  /** 모달을 연 트리거(버튼) 레이블 */
  modalTrigger?: string;
  /** 모달의 DialogTitle */
  modalTitle?: string;
  /** 구버전 폴백: 원본 파일명 또는 DialogTitle */
  modalLabel?: string;
}

/**
 * 피드백 경로 문자열을 만든다.
 * 모달 안 피드백이면 "{페이지} > {DialogTrigger} > {DialogTitle}" 형태로 표시한다.
 * 트리거/제목이 없으면 있는 세그먼트만, 둘 다 없고 modalLabel만 있으면 그것으로 폴백.
 */
export function formatFeedbackRoute(
  feedbackUrl: string,
  isInModal: boolean | undefined,
  modal: ModalRouteParts = {},
): string {
  if (!isInModal) return feedbackUrl;
  const segments = [feedbackUrl];
  if (modal.modalTrigger) segments.push(modal.modalTrigger);
  const last = modal.modalTitle || modal.modalLabel;
  if (last) segments.push(last);
  return segments.join(" > ");
}

/**
 * 페이지를 뺀 모달 경로만 "{DialogTrigger} > {DialogTitle}" 로 만든다. ('이 페이지' 탭용)
 * 트리거/제목 중 있는 것만 이어붙인다.
 */
export function formatModalPath(modal: ModalRouteParts = {}): string {
  const segments: string[] = [];
  if (modal.modalTrigger) segments.push(modal.modalTrigger);
  const last = modal.modalTitle || modal.modalLabel;
  if (last) segments.push(last);
  return segments.join(" > ");
}

/**
 * 모달 종류 라벨. DialogTitle이 있으면 진짜 모달('모달'),
 * 제목 없이 트리거만이면 팝오버/드롭다운 성격의 '버튼'으로 본다.
 */
export function modalTypeLabel(modal: ModalRouteParts = {}): "모달" | "버튼" {
  return modal.modalTitle ? "모달" : "버튼";
}
