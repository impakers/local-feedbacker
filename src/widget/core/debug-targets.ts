import type { DebugTarget, RouteDebugContext } from "./types";

const NEXT_ROUTE_MANIFEST_URL = "/_next/static/chunks/local-feedbacker-route-manifest.json";

type RouteFileKind = "page" | "layout";

interface NextRouteManifestFile {
  kind: RouteFileKind;
  file: string;
}

interface NextRouteManifestEntry {
  route: string;
  segments: string[];
  files: NextRouteManifestFile[];
}

interface NextRouteManifest {
  version: 1;
  entries: NextRouteManifestEntry[];
}

interface RouteMatchResult {
  targets: DebugTarget[];
  context: RouteDebugContext;
}

let manifestPromise: Promise<NextRouteManifest | null> | null = null;
let manifestFailed = false;

function normalizePathname(pathname: string): string {
  if (!pathname || pathname === "/") return "/";
  return pathname.endsWith("/") ? pathname.slice(0, -1) || "/" : pathname;
}

function splitPathname(pathname: string): string[] {
  const normalized = normalizePathname(pathname);
  if (normalized === "/") return [];
  return normalized
    .slice(1)
    .split("/")
    .map((segment) => decodeURIComponent(segment))
    .filter(Boolean);
}

function isDynamicSegment(segment: string): boolean {
  return /^\[[^\]]+\]$/.test(segment);
}

function isCatchAllSegment(segment: string): boolean {
  return /^\[\.\.\.[^\]]+\]$/.test(segment);
}

function isOptionalCatchAllSegment(segment: string): boolean {
  return /^\[\[\.\.\.[^\]]+\]\]$/.test(segment);
}

function scoreRouteMatch(routeSegments: string[], pathnameSegments: string[]): number | null {
  let routeIndex = 0;
  let pathIndex = 0;
  let score = 0;

  while (routeIndex < routeSegments.length) {
    const routeSegment = routeSegments[routeIndex];

    if (isOptionalCatchAllSegment(routeSegment)) {
      score += 1;
      pathIndex = pathnameSegments.length;
      routeIndex += 1;
      break;
    }

    if (isCatchAllSegment(routeSegment)) {
      if (pathIndex >= pathnameSegments.length) return null;
      score += 2;
      pathIndex = pathnameSegments.length;
      routeIndex += 1;
      break;
    }

    const pathSegment = pathnameSegments[pathIndex];
    if (pathSegment === undefined) return null;

    if (isDynamicSegment(routeSegment)) {
      score += 5;
      routeIndex += 1;
      pathIndex += 1;
      continue;
    }

    if (routeSegment !== pathSegment) return null;

    score += 20;
    routeIndex += 1;
    pathIndex += 1;
  }

  if (routeIndex !== routeSegments.length) return null;
  if (pathIndex !== pathnameSegments.length) return null;

  return score;
}

async function loadNextRouteManifest(): Promise<NextRouteManifest | null> {
  if (manifestFailed) return null;
  if (manifestPromise) return manifestPromise;

  manifestPromise = (async () => {
    try {
      const res = await fetch(NEXT_ROUTE_MANIFEST_URL, { cache: "force-cache" });
      if (!res.ok) {
        manifestFailed = true;
        return null;
      }
      const json = await res.json();
      if (!json || typeof json !== "object" || !Array.isArray((json as NextRouteManifest).entries)) {
        manifestFailed = true;
        return null;
      }
      return json as NextRouteManifest;
    } catch {
      manifestFailed = true;
      return null;
    }
  })();

  return manifestPromise;
}

function buildRouteTargets(entry: NextRouteManifestEntry): DebugTarget[] {
  const pageTarget = entry.files.find((file) => file.kind === "page");
  const layoutTargets = entry.files.filter((file) => file.kind === "layout");
  const targets: DebugTarget[] = [];

  if (pageTarget) {
    targets.push({
      kind: "route-page",
      file: pageTarget.file,
      label: "Current page route",
      // 빌드 타임 주입으로 얻은 호출부(component-callsite)가 더 정확하므로
      // 그 아래에 오도록 1 → 0.95로 둔다. 주입이 없으면 여전히 최상위다.
      confidence: 0.95,
      reason: "matched-current-url",
    });
  }

  layoutTargets.forEach((layout, index) => {
    targets.push({
      kind: "route-layout",
      file: layout.file,
      label: index === layoutTargets.length - 1 ? "Nearest layout" : "Ancestor layout",
      // route-page(0.95)보다 아래를 유지한다
      confidence: Math.max(0.7, 0.9 - index * 0.08),
      reason: "matched-layout-chain",
    });
  });

  return targets;
}

export async function getRouteDebugTargets(pathname?: string): Promise<RouteMatchResult | null> {
  if (typeof window === "undefined") return null;
  const currentPathname = pathname ?? window.location.pathname;

  const manifest = await loadNextRouteManifest();
  if (!manifest) return null;

  const pathnameSegments = splitPathname(currentPathname);
  let bestEntry: NextRouteManifestEntry | null = null;
  let bestScore = -1;

  for (const entry of manifest.entries) {
    const score = scoreRouteMatch(entry.segments, pathnameSegments);
    if (score === null) continue;
    if (score > bestScore) {
      bestScore = score;
      bestEntry = entry;
    }
  }

  if (!bestEntry) return null;

  return {
    targets: buildRouteTargets(bestEntry),
    context: {
      pathname: normalizePathname(currentPathname),
      matchedRoute: bestEntry.route,
      source: "next-route-manifest",
    },
  };
}

export function mergeDebugTargets(...groups: Array<DebugTarget[] | undefined>): DebugTarget[] {
  const merged: DebugTarget[] = [];
  const seen = new Set<string>();

  groups.forEach((group) => {
    group?.forEach((target) => {
      const key = `${target.kind}:${target.file}:${target.line ?? ""}:${target.column ?? ""}`;
      if (seen.has(key)) return;
      seen.add(key);
      merged.push(target);
    });
  });

  return merged.sort((a, b) => b.confidence - a.confidence);
}
