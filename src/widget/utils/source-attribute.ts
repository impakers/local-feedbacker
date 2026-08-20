// =============================================================================
// 빌드 타임 주입 속성 → 소스 위치 읽기
// =============================================================================
//
// jsx-source-loader가 심어둔 data 속성을 클릭한 요소에서 거슬러 올라가며 읽는다.
// fiber probe와 달리 추론이 아니라 빌드 시점에 확정된 값이므로 프로덕션에서도
// 그대로 신뢰할 수 있다.
//
//   data-imp-o  호출부 — 그 컴포넌트를 사용한 파일. 우리가 원하는 "파일 원문"
//   data-imp    정의부 — 이 DOM 태그를 물리적으로 작성한 파일(shadcn 등)
//
// 값은 "<token>:<line>:<col>" 형식이고 token은 두 가지다:
//   - webpack 빌드: 6자리 파일 ID → manifest로 경로를 되찾는다
//   - Turbopack 빌드: 경로 원문(플러그인이 못 돌아 manifest가 없다)
// =============================================================================

import type { DebugTarget } from "../core/types";

const SRC_MANIFEST_URL = "/_next/static/chunks/local-feedbacker-src-manifest.json";

export const ATTR_DEFINITION = "data-imp";
export const ATTR_CALLSITE = "data-imp-o";

/** 조상 탐색 상한 — 이보다 위는 레이아웃/셸이라 디버깅에 도움이 안 된다 */
const MAX_ANCESTORS = 30;
/** 각 종류별로 유지할 후보 수 */
const MAX_REFS = 4;

interface SrcManifest {
  version: 1;
  files: Record<string, string>;
}

export interface SourceRef {
  file: string;
  line: number;
  column: number;
  /** 클릭한 요소로부터 몇 단계 위인지 (0 = 클릭한 요소 자신) */
  depth: number;
}

export interface SourceAttributeResult {
  /** 호출부 — 가까운 순 */
  callsites: SourceRef[];
  /** 정의부 — 가까운 순 */
  definitions: SourceRef[];
}

let manifestPromise: Promise<SrcManifest | null> | null = null;
let manifestFailed = false;

async function loadSrcManifest(): Promise<SrcManifest | null> {
  if (manifestFailed) return null;
  if (manifestPromise) return manifestPromise;

  manifestPromise = (async () => {
    try {
      const res = await fetch(SRC_MANIFEST_URL, { cache: "force-cache" });
      if (!res.ok) {
        manifestFailed = true;
        return null;
      }
      const json = await res.json();
      if (!json || typeof json !== "object" || typeof (json as SrcManifest).files !== "object") {
        manifestFailed = true;
        return null;
      }
      return json as SrcManifest;
    } catch {
      manifestFailed = true;
      return null;
    }
  })();

  return manifestPromise;
}

/**
 * "<token>:<line>:<col>" 파싱. token이 경로인지 ID인지는 형태로 구분한다.
 * 경로에는 `/`나 확장자 `.`이 들어가고, ID는 6자리 base36이라 둘 다 없다.
 */
function parseAttributeValue(raw: string, manifest: SrcManifest | null): SourceRef | null {
  const match = raw.match(/^(.*):(\d+):(\d+)$/);
  if (!match) return null;

  const [, token, lineStr, columnStr] = match;
  if (!token) return null;

  const isPath = token.includes("/") || token.includes(".");
  const file = isPath ? token : manifest?.files?.[token];
  // manifest가 아직 안 왔거나 항목이 없으면 버린다 — ID만 넘겨봐야 쓸모없다
  if (!file) return null;

  return {
    file,
    line: Number.parseInt(lineStr, 10),
    column: Number.parseInt(columnStr, 10),
    depth: 0,
  };
}

/**
 * 클릭한 요소에서 조상 방향으로 올라가며 주입 속성을 수집한다.
 *
 * 같은 파일이 여러 번 나오면 가장 가까운 것만 남긴다 — 하나의 컴포넌트가
 * 여러 DOM 레벨을 만들면 동일 경로가 반복되기 때문.
 */
export async function collectSourceAttributes(
  element: Element | null
): Promise<SourceAttributeResult> {
  const empty: SourceAttributeResult = { callsites: [], definitions: [] };
  if (!element || typeof document === "undefined") return empty;

  // 속성 자체가 하나도 없으면 manifest를 받아올 이유가 없다
  if (!element.closest(`[${ATTR_CALLSITE}], [${ATTR_DEFINITION}]`)) return empty;

  const manifest = await loadSrcManifest();

  const callsites: SourceRef[] = [];
  const definitions: SourceRef[] = [];
  const seenCallsite = new Set<string>();
  const seenDefinition = new Set<string>();

  let current: Element | null = element;
  let depth = 0;

  while (current && depth < MAX_ANCESTORS) {
    const pairs: Array<[string, SourceRef[], Set<string>]> = [
      [ATTR_CALLSITE, callsites, seenCallsite],
      [ATTR_DEFINITION, definitions, seenDefinition],
    ];

    for (const [attr, bucket, seen] of pairs) {
      if (bucket.length >= MAX_REFS) continue;
      const raw = current.getAttribute(attr);
      if (!raw) continue;
      const ref = parseAttributeValue(raw, manifest);
      if (!ref || seen.has(ref.file)) continue;
      seen.add(ref.file);
      bucket.push({ ...ref, depth });
    }

    current = current.parentElement;
    depth++;
  }

  return { callsites, definitions };
}

/**
 * 수집 결과를 DebugTarget으로 변환한다.
 *
 * confidence 서열이 중요하다 — 호출부는 route-page(0.95)보다 위여야 임지안이
 * 페이지 전체가 아니라 실제 원문부터 연다.
 */
export function buildSourceAttributeTargets(result: SourceAttributeResult): DebugTarget[] {
  const targets: DebugTarget[] = [];

  result.callsites.forEach((ref, index) => {
    targets.push({
      kind: "component-callsite",
      file: ref.file,
      line: ref.line,
      column: ref.column,
      label: index === 0 ? "클릭한 요소가 작성된 위치" : "상위 호출부",
      // 가장 가까운 호출부가 최우선. 위로 갈수록 낮춘다
      confidence: Math.max(0.8, 1 - index * 0.05),
      reason: "build-time-source-attribute",
    });
  });

  result.definitions.forEach((ref, index) => {
    targets.push({
      kind: "component-definition",
      file: ref.file,
      line: ref.line,
      column: ref.column,
      label: index === 0 ? "요소를 렌더한 컴포넌트 정의" : "상위 컴포넌트 정의",
      // 정의부는 shadcn 같은 공용 컴포넌트인 경우가 많아 호출부보다 낮다
      confidence: Math.max(0.6, 0.9 - index * 0.05),
      reason: "build-time-source-attribute",
    });
  });

  return targets;
}

/** `file:line:col` 문자열 — elementData.sourceFile 등 기존 형식과 맞춘다 */
export function formatSourceRef(ref: SourceRef): string {
  return `${ref.file}:${ref.line}:${ref.column}`;
}

/**
 * 개발자 편의용 전역 헬퍼.
 * id 모드에서는 DOM 속성이 압축돼 있어 devtools로 눈으로 읽을 수 없다.
 *
 *   __impakersDebugSrc($0)  // → { callsites: [...], definitions: [...] }
 */
export function exposeSourceAttributeHelper(): void {
  if (typeof window === "undefined") return;
  (window as unknown as Record<string, unknown>).__impakersDebugSrc = (el: Element) =>
    collectSourceAttributes(el);
}

/** 테스트용 — 모듈 레벨 manifest 캐시 초기화 */
export function __resetSrcManifestCache(): void {
  manifestPromise = null;
  manifestFailed = false;
}
