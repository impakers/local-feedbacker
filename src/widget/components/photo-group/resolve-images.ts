/**
 * 코멘트 첨부 이미지 목록 복원.
 *
 * OS는 image_url(첫 장) + image_urls(전체)를 함께 내려준다.
 * - 신버전 응답: imageUrls 그대로 사용 (그룹 사진)
 * - 구버전 응답/구버전 행: imageUrls 가 없어 imageUrl 한 장으로 폴백
 * - 낙관적 임시 코멘트가 쓰는 "loading..." 자리표시자는 제외
 */
export function resolveImages(c: {
  imageUrl?: string;
  imageUrls?: readonly string[];
}): string[] {
  const list = (c.imageUrls ?? []).filter((u) => !!u && u !== "loading...");
  if (list.length > 0) return [...list];
  return c.imageUrl && c.imageUrl !== "loading..." ? [c.imageUrl] : [];
}
