// =============================================================================
// @impakers/debug — DOM Screenshot Utilities
// =============================================================================
// html2canvas-pro 사용 (oklab/oklch/lab/lch/color-mix 네이티브 지원)

/**
 * html2canvas 가 잘못 렌더링하는 스타일을 복제 문서에서 무력화한다.
 *
 *  - animation/transition: `animation` 이 걸린 요소를 "초기 키프레임"(opacity 0, scale)
 *    상태로 그려 모달이 반투명/뭉개져 보이는 문제 (Tailwind animate-in 포함).
 *  - box-shadow: 큰 그림자(예: 0 24px 60px)를 카드 위로 어두운 그라데이션처럼 번지게 그려
 *    스크린샷이 전체적으로 어둡게 나오는 문제.
 *  - filter/backdrop-filter: 유사하게 캡처가 어둡거나 깨지는 케이스 예방.
 *
 * 모두 스크린샷 충실도와 무관한 장식 효과이므로 캡처 시에만 제거한다(실 DOM은 그대로).
 */
function sanitizeClonedDocForCapture(clonedDoc: Document): void {
  const style = clonedDoc.createElement("style");
  style.textContent =
    "*,*::before,*::after{animation:none!important;animation-duration:0s!important;transition:none!important;box-shadow:none!important;filter:none!important;backdrop-filter:none!important}";
  (clonedDoc.head || clonedDoc.documentElement).appendChild(style);
}

// html2canvas-pro 동적 import를 1회만 수행하도록 메모이즈. 오버레이(팝오버/모달)를
// 클릭 즉시 캡처할 때 import 지연으로 오버레이가 닫히기 전에 캡처를 놓치는 레이스를 줄인다.
type Html2Canvas = (typeof import("html2canvas-pro"))["default"];
let html2canvasLoader: Promise<Html2Canvas> | null = null;
function loadHtml2canvas(): Promise<Html2Canvas> {
  if (!html2canvasLoader) {
    html2canvasLoader = import("html2canvas-pro").then((m) => m.default);
  }
  return html2canvasLoader;
}

/** html2canvas-pro 번들을 미리 로드해 둔다(위젯 mount/피드백 모드 진입 시 호출). */
export function preloadCapture(): void {
  if (typeof window === "undefined") return;
  void loadHtml2canvas().catch(() => {});
}

/**
 * DOM 요소를 JPEG base64 이미지로 캡처
 */
export async function captureElement(
  el: HTMLElement,
  options: { quality?: number; maxScale?: number } = {},
): Promise<string> {
  const { quality = 0.7, maxScale = 2 } = options;
  const html2canvas = await loadHtml2canvas();
  const canvas = await html2canvas(el, {
    useCORS: true,
    allowTaint: true,
    scale: Math.min(window.devicePixelRatio, maxScale),
    logging: false,
    onclone: (doc: Document) => sanitizeClonedDocForCapture(doc),
  });
  return canvas.toDataURL("image/jpeg", quality);
}

/**
 * 전체 화면(viewport)을 JPEG base64 이미지로 캡처
 * debug UI 요소를 숨긴 상태로 캡처
 */
export async function captureFullPage(
  options: { quality?: number; hideSelectors?: string[] } = {},
): Promise<string | undefined> {
  const { quality = 0.5, hideSelectors = [] } = options;
  const defaultSelectors = ["[data-impakers-debug]", "[data-annotation-popup]", "[data-annotation-marker]"];
  const allSelectors = [...defaultSelectors, ...hideSelectors];
  const hiddenEls = document.querySelectorAll(allSelectors.join(", "));

  try {
    hiddenEls.forEach((el) => (el as HTMLElement).style.visibility = "hidden");

    const html2canvas = await loadHtml2canvas();
    const canvas = await html2canvas(document.body, {
      useCORS: true,
      allowTaint: true,
      scale: 1,
      logging: false,
      width: window.innerWidth,
      height: window.innerHeight,
      onclone: (doc: Document) => sanitizeClonedDocForCapture(doc),
    });
    return canvas.toDataURL("image/jpeg", quality);
  } catch (err) {
    // 조용히 삼키면 스크린샷 누락 원인을 추적할 수 없다.
    console.warn("[@impakers/debug] 전체 화면 캡처 실패 — 스크린샷 없이 제출됩니다:", err);
    return undefined;
  } finally {
    hiddenEls.forEach((el) => (el as HTMLElement).style.visibility = "");
  }
}
