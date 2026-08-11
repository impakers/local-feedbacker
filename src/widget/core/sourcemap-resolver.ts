// =============================================================================
// @impakers/debug — Runtime Source Map Resolver
// =============================================================================
//
// 번들된 파일의 위치(line, column)를 소스맵을 통해 원본 소스 파일 경로로 변환.
//
// 조건: 클라이언트 프로젝트에서 nosources-source-map 또는
//   productionBrowserSourceMaps: true 설정이 필요.
//   nosources-source-map 권장 (소스코드 노출 없이 파일 경로+라인 resolve 가능)
//
// 플로우:
//   1. 번들 파일 URL + line + column 받음
//   2. {파일}.map 을 fetch (캐싱)
//   3. @jridgewell/trace-mapping으로 원본 위치 resolve
//

import { AnyMap, originalPositionFor } from "@jridgewell/trace-mapping";

// 소스맵 캐시 (URL → TraceMap)
type SourceMapInstance = ReturnType<typeof AnyMap>;
const cache = new Map<string, SourceMapInstance | null>();
// 실패한 URL은 재시도하지 않음
const failedUrls = new Set<string>();

/**
 * JS 파일 내의 //# sourceMappingURL= 코멘트에서 소스맵 URL을 추출
 */
async function getSourceMapUrlFromBundle(bundleUrl: string): Promise<string | null> {
  try {
    const res = await fetch(bundleUrl, { cache: "force-cache" });
    if (!res.ok) return null;
    const text = await res.text();
    // 마지막 sourceMappingURL 코멘트 찾기
    const match = text.match(/\/\/[#@]\s*sourceMappingURL\s*=\s*(\S+)\s*$/m);
    if (!match) return null;
    const mapRef = match[1];
    // 절대 URL이면 그대로, 상대 경로면 번들 URL 기준으로 resolve
    if (mapRef.startsWith("http")) return mapRef;
    const base = bundleUrl.substring(0, bundleUrl.lastIndexOf("/") + 1);
    return base + mapRef;
  } catch {
    return null;
  }
}

/**
 * 소스맵을 fetch하고 AnyMap으로 파싱 (캐싱)
 * Turbopack에서는 JS 파일명과 .map 파일명이 다를 수 있으므로
 * {파일}.map 실패 시 JS 내 sourceMappingURL 코멘트를 파싱하여 재시도
 */
async function loadSourceMap(bundleUrl: string): Promise<SourceMapInstance | null> {
  if (cache.has(bundleUrl)) return cache.get(bundleUrl) ?? null;
  if (failedUrls.has(bundleUrl)) return null;

  // 1차: {파일}.map 시도
  const directMapUrl = bundleUrl.endsWith(".map") ? bundleUrl : `${bundleUrl}.map`;
  try {
    const res = await fetch(directMapUrl, { cache: "force-cache" });
    if (res.ok) {
      const rawMap = await res.json();
      const traceMap = new AnyMap(rawMap);
      cache.set(bundleUrl, traceMap);
      return traceMap;
    }
  } catch {
    // 1차 실패 시 폴백
  }

  // 2차: JS 파일에서 sourceMappingURL 추출 (Turbopack은 .js와 .map 파일명이 다름)
  const actualMapUrl = await getSourceMapUrlFromBundle(bundleUrl);
  if (actualMapUrl) {
    try {
      const res = await fetch(actualMapUrl, { cache: "force-cache" });
      if (res.ok) {
        const rawMap = await res.json();
        const traceMap = new AnyMap(rawMap);
        cache.set(bundleUrl, traceMap);
        return traceMap;
      }
    } catch {
      // 2차 실패
    }
  }

  failedUrls.add(bundleUrl);
  cache.set(bundleUrl, null);
  return null;
}

/** resolve 결과 */
export interface ResolvedSource {
  /** 원본 소스 파일 경로 (예: src/components/Dashboard.tsx) */
  source: string;
  /** 원본 라인 번호 */
  line: number;
  /** 원본 컬럼 번호 */
  column: number;
  /** 원본 심볼 이름 (있으면) */
  name: string | null;
}

/**
 * 번들 파일의 위치를 원본 소스 위치로 변환
 *
 * @param bundlePath - 번들 파일 경로 (예: _next/static/chunks/app-layout_abc123.js)
 * @param line - 번들 파일의 라인 번호
 * @param column - 번들 파일의 컬럼 번호
 * @returns 원본 소스 위치 또는 null
 */
export async function resolveSourcePosition(
  bundlePath: string,
  line: number,
  column: number,
): Promise<ResolvedSource | null> {
  // 상대 경로를 절대 URL로 변환
  let bundleUrl: string;
  try {
    if (bundlePath.startsWith("http")) {
      bundleUrl = bundlePath;
    } else {
      bundleUrl = new URL(bundlePath, window.location.origin).href;
    }
  } catch {
    return null;
  }

  const traceMap = await loadSourceMap(bundleUrl);
  if (!traceMap) return null;

  try {
    const pos = originalPositionFor(traceMap, { line, column });
    if (!pos.source) return null;

    // webpack:///나 turbopack:/// 접두사 제거
    let source = pos.source;
    source = source.replace(/^webpack:\/\/\//, "");
    source = source.replace(/^turbopack:\/\/\//, "");
    source = source.replace(/^\[project\]\//, "");
    source = source.replace(/^\.\//, "");

    // node_modules 경로는 무시
    if (source.includes("node_modules/")) return null;

    return {
      source,
      line: pos.line ?? 0,
      column: pos.column ?? 0,
      name: pos.name ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * 소스 파일 문자열 (예: "_next/static/chunks/app_abc.js:23484:23")을 파싱하여
 * 원본 소스 위치로 resolve
 */
export async function resolveSourceString(
  sourceStr: string,
): Promise<ResolvedSource | null> {
  if (!sourceStr) return null;

  // "파일:라인:컬럼" 형식 파싱
  const match = sourceStr.match(/^(.+):(\d+):(\d+)$/);
  if (!match) return null;

  const [, filePath, lineStr, colStr] = match;
  const line = parseInt(lineStr, 10);
  const column = parseInt(colStr, 10);

  if (isNaN(line) || isNaN(column)) return null;

  return resolveSourcePosition(filePath, line, column);
}

/**
 * 소스맵 사용 가능 여부를 확인 (첫 번째 청크 파일의 .map 존재 확인)
 */
export async function isSourceMapAvailable(): Promise<boolean> {
  if (typeof document === "undefined") return false;

  // 페이지의 script 태그에서 첫 번째 청크 파일 찾기
  const scripts = document.querySelectorAll("script[src]");
  for (const script of scripts) {
    const src = (script as HTMLScriptElement).src;
    if (src.includes("/chunks/") || src.includes("/_next/")) {
      try {
        const res = await fetch(`${src}.map`, { method: "HEAD", cache: "force-cache" });
        return res.ok;
      } catch {
        continue;
      }
    }
  }

  return false;
}
