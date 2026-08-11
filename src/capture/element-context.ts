export interface ElementContext {
  element: string;
  selectedText?: string;
  nearbyText?: string;
  cssClasses?: string;
  accessibility?: string;
  selector?: string;
}

function nearbyText(element: Element): string | undefined {
  const parentText = element.parentElement?.textContent?.replace(/\s+/g, " ").trim() ?? "";
  const ownText = element.textContent?.replace(/\s+/g, " ").trim() ?? "";
  const text = parentText.replace(ownText, "").trim() || element.nextElementSibling?.textContent?.replace(/\s+/g, " ").trim();
  return text ? text.slice(0, 240) : undefined;
}

export function collectElementContext(element: Element): ElementContext {
  const ariaLabel = element.getAttribute("aria-label");
  const role = element.getAttribute("role");
  const id = element.id ? `#${element.id}` : "";
  const className = typeof (element as HTMLElement).className === "string" ? (element as HTMLElement).className.trim() : "";
  return {
    element: element.tagName.toLowerCase(),
    selectedText: element.textContent?.replace(/\s+/g, " ").trim() || undefined,
    nearbyText: nearbyText(element),
    cssClasses: className || undefined,
    accessibility: [ariaLabel && `aria-label=${ariaLabel}`, role && `role=${role}`].filter(Boolean).join(", ") || undefined,
    selector: id || element.tagName.toLowerCase(),
  };
}
