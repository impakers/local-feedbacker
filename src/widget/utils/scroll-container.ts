/**
 * Utilities for finding scroll containers of elements.
 */

function isScrollable(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const style = window.getComputedStyle(el);
  const overflow = style.overflow + style.overflowX + style.overflowY;
  if (!/(auto|scroll|overlay)/.test(overflow)) return false;
  return el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth;
}

/**
 * Finds the nearest ancestor that actually scrolls.
 * Returns document.scrollingElement (usually <html>) if no scrollable ancestor found.
 */
export function findScrollContainer(el: Element | null): Element {
  let current: Element | null = el?.parentElement ?? null;
  while (current && current !== document.body && current !== document.documentElement) {
    if (isScrollable(current)) return current;
    current = current.parentElement;
  }
  return document.scrollingElement || document.documentElement;
}

/**
 * Collects all scrollable ancestors of an element, up to and including
 * document.scrollingElement. Useful for attaching scroll listeners.
 */
export function getScrollAncestors(el: Element | null): Element[] {
  const result: Element[] = [];
  let current: Element | null = el?.parentElement ?? null;
  while (current && current !== document.body && current !== document.documentElement) {
    if (isScrollable(current)) result.push(current);
    current = current.parentElement;
  }
  const root = document.scrollingElement || document.documentElement;
  if (root && !result.includes(root)) result.push(root);
  return result;
}
