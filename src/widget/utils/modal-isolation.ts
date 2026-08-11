import { useEffect, useRef, type RefObject } from "react";

/**
 * Radix UI (shadcn/ui) DismissableLayer 와의 충돌을 방지하는 훅.
 *
 * 두 가지 메커니즘 때문에 모달 오버레이 위에 있는 우리 위젯이 사실상 조작 불가가 된다:
 *
 *   1) body.style.pointerEvents = "none"
 *      Radix 의 modal dialog/menu 가 열리면 body 에 직접 심어서 바깥 요소의 hit-test 를 막음.
 *      포털된 우리 위젯은 body 자식이므로 CSS 레벨에서 클릭을 받지 못함.
 *
 *   2) document.addEventListener("pointerdown" / "click" / "focusin")
 *      DismissableLayer 가 document 에 직접 네이티브 리스너를 붙여 "외부 클릭/포커스"를
 *      감지하고 모달을 닫는다. 위젯 클릭이 여기에 걸리면 클릭이 모달 닫기로 귀결됨.
 *
 * 이 훅은 위젯의 포털 루트 엘리먼트에 ref 로 붙어서 두 문제 모두 해소한다:
 *
 *   (A) ref 엘리먼트에 `pointer-events: auto` 를 강제 → (1) 우회.
 *
 *   (B) **document** 레벨 (포털 루트가 아님!) 에 네이티브 bubble 리스너 등록.
 *       - 타겟이 `[data-impakers-debug]` 하위면 `stopImmediatePropagation` 호출.
 *       - React 18/19 의 event delegation 은 root container(대개 body 또는 root container
 *         div)에 부착되므로, 이벤트가 document 에 도달할 때면 React 합성이벤트는 이미
 *         처리된 상태. 따라서 우리 document 리스너는 위젯 자체 동작을 깨지 않는다.
 *       - 만약 포털 루트 엘리먼트 자체에 리스너를 붙여 stopPropagation 하면 React root 의
 *         delegate(body 등)에 이벤트가 도달하기 전에 끊겨 위젯 내부 버튼의 합성이벤트가
 *         아예 발화하지 않는다 (이전 버전의 회귀 버그).
 *       - `stopImmediatePropagation` 은 같은 target(document) 에 등록된 뒤순위 리스너
 *         (Radix 의 dismissal 리스너)까지 차단한다. 위젯이 먼저 mount 되므로 Radix
 *         보다 먼저 등록되고, bubble 에서도 먼저 호출된다.
 */
export function useModalOverlayIsolation<T extends HTMLElement = HTMLElement>(): RefObject<T | null> {
  const ref = useRef<T>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // (A) body 의 pointer-events: none 을 회피
    el.style.pointerEvents = "auto";

    // (B) document 레벨에서 Radix dismissal 만 선별 차단
    const handle = (e: Event) => {
      const target = e.target as Element | null;
      if (
        target &&
        typeof (target as Element).closest === "function" &&
        (target as Element).closest("[data-impakers-debug]")
      ) {
        // 같은 target(document) 에 등록된 Radix 의 pointerdown/focusin/click 리스너를 차단.
        // React 의 delegate 는 root container(body) 단계에서 이미 처리되었으므로 안전.
        e.stopImmediatePropagation();
      }
    };

    // Radix DismissableLayer 가 document 에 붙이는 이벤트들:
    //   - pointerdown  : 기본 dismiss 감지
    //   - click        : touch pointerType 의 fallback (once 리스너)
    //   - focusin      : focus-outside 기반 dismiss + FocusScope 의 포커스 탈출 감지
    const types = ["pointerdown", "click", "focusin"] as const;

    for (const t of types) document.addEventListener(t, handle);
    return () => {
      for (const t of types) document.removeEventListener(t, handle);
    };
  }, []);

  return ref;
}
