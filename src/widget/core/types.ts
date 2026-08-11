// =============================================================================
// @impakers/debug — Shared Types
// =============================================================================

/** 피드백 우선순위 */
export type FeedbackPriority = "low" | "medium" | "high" | "urgent";

/** 피드백 카테고리 */
export type FeedbackCategory = "bug" | "feature" | "improvement" | "other";

/** 클라이언트 프로젝트에서 제공하는 로그인 사용자 정보 */
export interface FeedbackUser {
  id: string | number;
  name: string;
  email?: string;
  phone?: string;
  role?: string;
}

/** 코딩 에이전트가 우선 열어볼 디버깅 타겟 */
export interface DebugTarget {
  /**
   * 타겟 종류
   * - component-callsite: 빌드 타임 주입으로 확정된 "그 요소가 작성된 파일"(가장 정확)
   * - component-definition: 요소를 렌더한 컴포넌트 정의 파일(shadcn 등 공용일 수 있음)
   * - component: fiber probe + 소스맵 추론값(폴백, 불안정)
   */
  kind:
    | "route-page"
    | "route-layout"
    | "component"
    | "component-callsite"
    | "component-definition";
  /** 프로젝트 기준 파일 경로 */
  file: string;
  /** 1-indexed line */
  line?: number;
  /** 0-indexed column */
  column?: number;
  /** 사람이 읽기 쉬운 레이블 */
  label?: string;
  /** 0~1 confidence */
  confidence: number;
  /** 타겟이 선택된 근거 */
  reason: string;
}

/** 라우트 매칭 컨텍스트 */
export interface RouteDebugContext {
  /** 실제 현재 pathname */
  pathname: string;
  /** 매칭된 라우트 패턴 */
  matchedRoute?: string;
  /** 매칭 근거 */
  source?: "next-route-manifest";
}

/** 자동 수집되는 환경 정보 */
export interface FeedbackMetadata {
  url: string;
  timestamp: string;
  browser: string;
  userAgent: string;
  viewport: string;
  pixelRatio: number;
  language: string;
  referrer: string;
  user?: FeedbackUser;
  /** 쿠키 (민감 정보 제외) */
  cookies?: Record<string, string>;
  /** JWT 디코딩된 claims (있는 경우) */
  jwtClaims?: Record<string, unknown>;
  /** 최근 콘솔 에러 (최대 20개) */
  consoleErrors?: string[];
  /** 최근 콘솔 로그 (에러/경고/일반, 최대 50개) */
  consoleLogs?: { level: string; message: string; timestamp: number }[];
  /** 페이지 성능 메트릭 */
  performance?: Record<string, number>;
  /** 디버깅 에이전트가 우선적으로 열 파일 타겟 */
  debugTargets?: DebugTarget[];
  /** 라우트 기반 타겟 매칭 컨텍스트 */
  routeDebug?: RouteDebugContext;
  /** 실제 서비스에 로그인한 유저 (getUser 콜백) */
  serviceUser?: FeedbackUser;
  /** 피드백 위젯에 로그인한 유저 */
  feedbackerUser?: FeedbackUser;
}

/** 피드백 제출 데이터 */
export interface FeedbackPayload {
  title: string;
  description: string;
  priority: FeedbackPriority;
  category?: FeedbackCategory;
  metadata: FeedbackMetadata;
  screenshot?: string; // base64
}

/** 파일 업로드 결과 */
export interface FileUploadResult {
  url: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  fileSource: "supabase" | "google_drive";
}

/** 인증 응답 (레거시 — 시크릿 코드 인증) */
export interface AuthResponse {
  token: string;
  serviceName: string;
  expiresAt: string;
}

// =============================================================================
// 유저 인증 (회원가입/로그인)
// =============================================================================

/** 인증 상태 */
export type AuthState =
  | "unauthenticated"
  | "logged_in_no_service"
  | "logged_in_with_service";

/** 연결된 서비스 정보 */
export interface LinkedService {
  serviceId: string;
  serviceName: string;
  role: "admin" | "member";
}

/** 회원가입 요청 */
export interface SignupRequest {
  email: string;
  password: string;
  name: string;
  phone?: string;
}

/** 로그인 요청 */
export interface LoginRequest {
  email: string;
  password: string;
}

/** 유저 인증 응답 (회원가입/로그인) */
export interface UserAuthResponse {
  token: string;
  user: {
    id: string;
    name: string;
    email: string;
    phone?: string;
  };
  services: LinkedService[];
  expiresAt: string;
}

/** 서비스 연결 응답 */
export interface LinkServiceResponse {
  service: LinkedService;
  services: LinkedService[];
}

/** 외부 패키지가 재사용할 수 있는 안전한 인증 컨텍스트 */
export interface ImpakersDebugAuthContext {
  authState: AuthState;
  token: string | null;
  user: {
    id: string;
    name: string;
    /** 의도적으로 raw email은 노출하지 않는다. */
    emailHash?: string;
  } | null;
  activeService: {
    id: string;
    name: string;
  } | null;
}

/** @impakers/telemetry 등 외부 패키지용 안정 인증 컨텍스트 */
export interface ImpakersAuthContext {
  authState: AuthState;
  token: string | null;
  user: {
    id: string;
    name?: string;
    /** 의도적으로 raw email은 노출하지 않는다. */
    emailHash?: string;
  } | null;
  service: {
    id: string;
    name?: string;
  } | null;
}

/** 기본 엔드포인트 (endpoint prop 미설정 시 fallback) */
export const DEFAULT_ENDPOINT = "https://os.impakers.club/api/external/feedback";

/**
 * 읽기 패널(수신함·스레드·설정)의 서피스 재질.
 *
 * - `"solid"` (기본값) — 기존 불투명 흰 카드. 미지정 시 항상 이 값이므로
 *   이미 배포된 호스티드 클라이언트의 겉모습은 한 픽셀도 바뀌지 않는다.
 * - `"light-glass"` — 냉백 판유리(블러·상단 캐치라이트). 호스트 앱이 명시적으로
 *   켜야만 적용된다.
 *
 * FAB·팝오버·마커·토스트는 이 값과 무관하게 항상 기존 다크 글래스를 유지한다.
 * 컨트롤을 반투명하게 만들면 밝은 호스트 앱 위에서 비활성처럼 읽히기 때문이다
 * (styles/_tokens.scss 의 Dark glass 주석 참고).
 */
export type DebugWidgetTheme = "solid" | "light-glass";

/** ImpakersDebugProvider props */
export interface ImpakersDebugConfig {
  /** 임패커스 OS 피드백 API 엔드포인트 (미설정 시 os.impakers.club 사용) */
  endpoint?: string;
  /** 현재 로그인 사용자 정보를 반환하는 콜백 (선택, 하위 호환) */
  getUser?: () => FeedbackUser | null;
  /** 멀티서비스 유저일 때 활성 서비스 지정 */
  activeServiceId?: string;
  /** 읽기 패널 재질. 미지정 시 `"solid"` — 기존 동작 그대로. */
  theme?: DebugWidgetTheme;
}
