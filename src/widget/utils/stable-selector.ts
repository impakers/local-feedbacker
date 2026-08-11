/**
 * Builds a CSS selector string that can be used with document.querySelector
 * to re-locate the same DOM element later, even after re-renders.
 *
 * Priority:
 *   1. Stable attributes (data-testid, data-test, id) — if present and unique
 *   2. Combination of tag + stable attribute or short class path
 *   3. Fallback: structural path with :nth-of-type from document root
 *
 * Returns null if no reasonable selector can be built (e.g. <html>, <body>).
 */

const STABLE_ATTRS = ["data-testid", "data-test", "data-qa", "data-cy"];

function isLikelyStableId(id: string): boolean {
  // Reject ids that look auto-generated (CSS-in-JS, Radix, etc.)
  if (!id) return false;
  if (id.length > 40) return false;
  if (/^(radix|mui|emotion|chakra|headlessui)-/i.test(id)) return false;
  if (/^:r[0-9a-z]+:$/i.test(id)) return false; // React useId
  if (/^[a-z0-9]{16,}$/i.test(id)) return false; // pure hash
  return true;
}

function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/([ "#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, "\\$1");
}

function isUnique(root: ParentNode, selector: string): boolean {
  try {
    return root.querySelectorAll(selector).length === 1;
  } catch {
    return false;
  }
}

function attrSelector(el: Element): string | null {
  for (const attr of STABLE_ATTRS) {
    const value = el.getAttribute(attr);
    if (value) return `[${attr}="${cssEscape(value)}"]`;
  }
  return null;
}

function idSelector(el: Element): string | null {
  const id = el.id;
  if (!id || !isLikelyStableId(id)) return null;
  return `#${cssEscape(id)}`;
}

function nthOfTypeIndex(el: Element): number {
  const parent = el.parentElement;
  if (!parent) return 1;
  let i = 0;
  for (const sibling of parent.children) {
    if (sibling.tagName === el.tagName) {
      i += 1;
      if (sibling === el) return i;
    }
  }
  return 1;
}

function stepSelector(el: Element): string {
  const attr = attrSelector(el);
  if (attr) return `${el.tagName.toLowerCase()}${attr}`;

  const id = idSelector(el);
  if (id) return id;

  return `${el.tagName.toLowerCase()}:nth-of-type(${nthOfTypeIndex(el)})`;
}

export function buildStableSelector(el: Element | null): string | null {
  if (!el || !(el instanceof Element)) return null;
  if (el === document.documentElement || el === document.body) return null;

  const root: Document | ShadowRoot =
    (el.getRootNode() as Document | ShadowRoot) ?? document;

  // Fast path: stable attribute that's unique in the root
  const attr = attrSelector(el);
  if (attr && isUnique(root, attr)) return attr;

  // Fast path: stable id that's unique
  const id = idSelector(el);
  if (id && isUnique(root, id)) return id;

  // Build up a path with nth-of-type
  const parts: string[] = [];
  let current: Element | null = el;
  while (current && current !== document.documentElement) {
    parts.unshift(stepSelector(current));
    const joined = parts.join(" > ");
    if (isUnique(root, joined)) return joined;
    current = current.parentElement;
    if (!current || current.tagName === "BODY") {
      // Try prefixing with body
      const withBody = `body > ${parts.join(" > ")}`;
      if (isUnique(root, withBody)) return withBody;
      break;
    }
  }

  const final = parts.join(" > ");
  return final || null;
}

/**
 * 위젯 자신의 UI 는 앵커가 될 수 없다.
 *
 * 오버레이가 닫히면 `body > div:nth-of-type(N)` 같은 위치 기반 셀렉터의 N 이
 * 밀리면서, 저장된 앵커가 body 로 portal 된 **우리 위젯**에 매칭될 수 있다.
 * 그러면 마커가 자기 자신을 앵커로 삼아 매 tick 조금씩 이동하는(= 좌상단으로
 * 수렴하는) 되먹임이 생긴다.
 */
function isWidgetOwnElement(el: Element): boolean {
  return typeof el.closest === "function" && Boolean(el.closest("[data-impakers-debug]"));
}

/**
 * Finds an element using a stable selector string.
 * Searches both the main document and any open shadow roots.
 */
export function findBySelector(selector: string | null | undefined): Element | null {
  if (!selector) return null;
  try {
    const direct = document.querySelector(selector);
    if (direct && !isWidgetOwnElement(direct)) return direct;
  } catch {
    return null;
  }
  // 첫 매칭이 없거나 위젯 내부였음 → 문서 전체 + 열린 shadow root 를 훑는다
  const stack: Array<Document | ShadowRoot> = [document];
  const visited = new Set<ShadowRoot>();
  while (stack.length) {
    const root = stack.shift()!;
    try {
      for (const found of root.querySelectorAll(selector)) {
        if (!isWidgetOwnElement(found)) return found;
      }
    } catch {
      return null;
    }
    root.querySelectorAll("*").forEach((el) => {
      const sr = (el as Element & { shadowRoot?: ShadowRoot | null }).shadowRoot;
      if (sr && !visited.has(sr)) {
        visited.add(sr);
        stack.push(sr);
      }
    });
  }
  return null;
}
