import type { SourceReference } from "../prompt/build-prompt";

const callsiteAttribute = "data-imp-o";
const definitionAttribute = "data-imp";

const manifestUrl = "/_next/static/chunks/impakers-debug-src-manifest.json";

async function sourceManifest(): Promise<Record<string, string>> {
  try {
    const response = await fetch(manifestUrl, { cache: "force-cache" });
    const data = await response.json() as { files?: Record<string, string> };
    return data.files ?? {};
  } catch { return {}; }
}

function parse(raw: string | null, manifest: Record<string, string>): SourceReference | undefined {
  if (!raw) return undefined;
  const match = raw.match(/^(.*):(\d+):(\d+)$/);
  if (!match) return undefined;
  const file = match[1].includes("/") || match[1].includes(".") ? match[1] : manifest[match[1]];
  return file ? { file, line: Number(match[2]), column: Number(match[3]) } : undefined;
}

/** Reads only build-time source attributes. No attribute means no confirmed source. */
export async function collectConfirmedSource(element: Element): Promise<{ callsite?: SourceReference; definition?: SourceReference } | undefined> {
  const sourceElement = element.closest(`[${callsiteAttribute}], [${definitionAttribute}]`);
  if (!sourceElement) return undefined;
  const manifest = await sourceManifest();
  const callsite = parse(sourceElement.getAttribute(callsiteAttribute), manifest);
  const definition = parse(sourceElement.getAttribute(definitionAttribute), manifest);
  return callsite || definition ? { callsite, definition } : undefined;
}
