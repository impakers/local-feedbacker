// =============================================================================
// @impakers/debug — Environment Info Collector
// =============================================================================

import type { FeedbackMetadata, FeedbackUser } from "./types";
import { getAuthenticatedUser } from "./api";

// ---------------------------------------------------------------------------
// Console capture (에러 최근 20개, 일반 로그 최근 50개)
// ---------------------------------------------------------------------------

const MAX_ERRORS = 20;
const MAX_LOGS = 50;
const recentConsoleErrors: string[] = [];
const recentConsoleLogs: { level: string; message: string; timestamp: number }[] = [];
let consolePatched = false;

function formatArgs(args: unknown[]): string {
  return args.map((a) => {
    if (a instanceof Error) return `${a.message}\n${a.stack?.split("\n").slice(0, 3).join("\n")}`;
    if (typeof a === "object" && a !== null) {
      try { return JSON.stringify(a).slice(0, 300); } catch { return String(a); }
    }
    return String(a);
  }).join(" ");
}

function pushLog(level: string, message: string) {
  recentConsoleLogs.push({ level, message: message.slice(0, 500), timestamp: Date.now() });
  if (recentConsoleLogs.length > MAX_LOGS) recentConsoleLogs.shift();
}

function installConsoleCapture() {
  if (consolePatched || typeof window === "undefined") return;
  consolePatched = true;

  const originalError = console.error;
  const originalWarn = console.warn;
  const originalLog = console.log;

  console.error = (...args: unknown[]) => {
    const msg = formatArgs(args);
    recentConsoleErrors.push(msg.slice(0, 500));
    if (recentConsoleErrors.length > MAX_ERRORS) recentConsoleErrors.shift();
    pushLog("error", msg);
    originalError.apply(console, args);
  };

  console.warn = (...args: unknown[]) => {
    const msg = formatArgs(args);
    recentConsoleErrors.push(`[warn] ${msg}`.slice(0, 500));
    if (recentConsoleErrors.length > MAX_ERRORS) recentConsoleErrors.shift();
    pushLog("warn", msg);
    originalWarn.apply(console, args);
  };

  console.log = (...args: unknown[]) => {
    pushLog("log", formatArgs(args));
    originalLog.apply(console, args);
  };

  // 글로벌 에러도 캡처
  window.addEventListener("error", (e) => {
    const msg = `${e.message} (${e.filename}:${e.lineno})`;
    recentConsoleErrors.push(msg.slice(0, 500));
    if (recentConsoleErrors.length > MAX_ERRORS) recentConsoleErrors.shift();
    pushLog("error", msg);
  });

  window.addEventListener("unhandledrejection", (e) => {
    const msg = `Unhandled Promise: ${e.reason}`;
    recentConsoleErrors.push(msg.slice(0, 500));
    if (recentConsoleErrors.length > MAX_ERRORS) recentConsoleErrors.shift();
    pushLog("error", msg);
  });
}

// 모듈 로드 시 바로 설치
installConsoleCapture();


// ---------------------------------------------------------------------------
// Browser parsing
// ---------------------------------------------------------------------------

function parseBrowser(ua: string): string {
  const edge = ua.match(/Edg\/(\d+[\d.]*)/);
  if (edge) return `Edge ${edge[1]}`;

  const chrome = ua.match(/Chrome\/(\d+[\d.]*)/);
  if (chrome && !ua.includes("Edg/") && !ua.includes("OPR/")) return `Chrome ${chrome[1]}`;

  const firefox = ua.match(/Firefox\/(\d+[\d.]*)/);
  if (firefox) return `Firefox ${firefox[1]}`;

  const safari = ua.match(/Version\/(\d+[\d.]*).*Safari/);
  if (safari) return `Safari ${safari[1]}`;

  const opera = ua.match(/OPR\/(\d+[\d.]*)/);
  if (opera) return `Opera ${opera[1]}`;

  return ua;
}

// ---------------------------------------------------------------------------
// Cookie parsing (민감 정보 필터링)
// ---------------------------------------------------------------------------

const SENSITIVE_COOKIE_PATTERNS = [
  /session/i, /csrf/i, /xsrf/i, /secret/i, /password/i, /key/i,
];

function parseCookies(): Record<string, string> {
  if (typeof document === "undefined") return {};
  const cookies: Record<string, string> = {};
  try {
    document.cookie.split(";").forEach((c) => {
      const [key, ...rest] = c.trim().split("=");
      if (!key) return;
      const name = key.trim();
      // 민감 쿠키는 값 마스킹
      const isSensitive = SENSITIVE_COOKIE_PATTERNS.some((p) => p.test(name));
      cookies[name] = isSensitive ? "[masked]" : decodeURIComponent(rest.join("=")).slice(0, 200);
    });
  } catch {
    // cookie 접근 불가
  }
  return cookies;
}

// ---------------------------------------------------------------------------
// JWT decode (클라이언트 프로젝트의 JWT 토큰을 찾아서 claims 추출)
// ---------------------------------------------------------------------------

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = payload + "==".slice(0, (4 - (payload.length % 4)) % 4);
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

function findAndDecodeJwt(): Record<string, unknown> | null {
  if (typeof window === "undefined") return null;

  // localStorage에서 JWT 찾기 (일반적인 키 패턴)
  const jwtKeys = ["token", "access_token", "accessToken", "auth_token", "authToken", "jwt", "id_token", "idToken"];

  for (const key of jwtKeys) {
    try {
      const val = localStorage.getItem(key);
      if (val) {
        // JSON으로 감싸져 있을 수 있음
        const unwrapped = val.startsWith('"') ? JSON.parse(val) : val;
        const decoded = decodeJwtPayload(unwrapped);
        if (decoded) {
          // 민감 정보 제거하고 안전한 claims만 반환
          const safe: Record<string, unknown> = {};
          const safeKeys = ["sub", "email", "name", "role", "roles", "org", "iat", "exp", "aud", "iss", "user_id", "user_role"];
          for (const k of safeKeys) {
            if (k in decoded) safe[k] = decoded[k];
          }
          return Object.keys(safe).length > 0 ? safe : null;
        }
      }
    } catch {
      continue;
    }
  }

  // 쿠키에서도 찾기
  try {
    const cookies = document.cookie.split(";");
    for (const c of cookies) {
      const [, ...rest] = c.trim().split("=");
      const val = rest.join("=");
      const decoded = decodeJwtPayload(val);
      if (decoded && decoded.sub) {
        const safe: Record<string, unknown> = {};
        const safeKeys = ["sub", "email", "name", "role", "roles", "org", "iat", "exp"];
        for (const k of safeKeys) {
          if (k in decoded) safe[k] = decoded[k];
        }
        return Object.keys(safe).length > 0 ? safe : null;
      }
    }
  } catch {
    // ignore
  }

  return null;
}

// ---------------------------------------------------------------------------
// Page performance
// ---------------------------------------------------------------------------

function safeRound(val: number): number | undefined {
  const n = Math.round(val);
  return isNaN(n) || !isFinite(n) ? undefined : n;
}

function getPagePerformance(): Record<string, number> {
  if (typeof performance === "undefined") return {};
  const metrics: Record<string, number> = {};

  try {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    if (nav) {
      const pageLoad = safeRound(nav.loadEventEnd - nav.startTime);
      const domLoaded = safeRound(nav.domContentLoadedEventEnd - nav.startTime);
      const ttfb = safeRound(nav.responseStart - nav.requestStart);
      if (pageLoad) metrics.pageLoadTime = pageLoad;
      if (domLoaded) metrics.domContentLoaded = domLoaded;
      if (ttfb) metrics.ttfb = ttfb;
    }

    const fcp = performance.getEntriesByName("first-contentful-paint")[0];
    if (fcp) {
      const v = safeRound(fcp.startTime);
      if (v) metrics.firstContentfulPaint = v;
    }

    const mem = (performance as any).memory;
    if (mem) {
      const used = safeRound(mem.usedJSHeapSize / 1024 / 1024);
      const total = safeRound(mem.totalJSHeapSize / 1024 / 1024);
      if (used) metrics.usedJSHeapMB = used;
      if (total) metrics.totalJSHeapMB = total;
    }
  } catch {
    // ignore
  }

  return metrics;
}

// ---------------------------------------------------------------------------
// Main collector
// ---------------------------------------------------------------------------

export function collectMetadata(
  getUser?: () => FeedbackUser | null,
): FeedbackMetadata {
  const metadata: FeedbackMetadata = {
    url: window.location.href,
    timestamp: new Date().toISOString(),
    browser: parseBrowser(navigator.userAgent),
    userAgent: navigator.userAgent,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    pixelRatio: window.devicePixelRatio,
    language: navigator.language,
    referrer: document.referrer,
    cookies: parseCookies(),
    jwtClaims: findAndDecodeJwt() ?? undefined,
    consoleErrors: recentConsoleErrors.length > 0 ? [...recentConsoleErrors] : undefined,
    consoleLogs: recentConsoleLogs.length > 0 ? [...recentConsoleLogs] : undefined,
    performance: getPagePerformance(),
  };

  // 서비스 유저 (getUser 콜백 — 실제 서비스에 로그인한 유저)
  let serviceUser: FeedbackUser | null = null;
  if (getUser) {
    try {
      serviceUser = getUser();
    } catch {
      // ignore
    }
  }

  // 피드배커 유저 (위젯 로그인 유저)
  const feedbackerUser = getAuthenticatedUser();

  // 하위 호환: metadata.user는 서비스 유저 우선, 없으면 피드배커 유저
  const resolvedUser = serviceUser || feedbackerUser;
  if (resolvedUser) {
    metadata.user = {
      ...resolvedUser,
      id: String(resolvedUser.id),
      name: String(resolvedUser.name || ""),
    };
  }

  // 두 유저 모두 별도 저장
  if (serviceUser) {
    metadata.serviceUser = {
      ...serviceUser,
      id: String(serviceUser.id),
      name: String(serviceUser.name || ""),
    };
  }
  if (feedbackerUser) {
    metadata.feedbackerUser = {
      ...feedbackerUser,
      id: String(feedbackerUser.id),
      name: String(feedbackerUser.name || ""),
    };
  }

  return metadata;
}
