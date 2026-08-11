// =============================================================================
// @impakers/debug — Authentication
// =============================================================================
//
// 유저 인증 (회원가입/로그인) + 레거시 시크릿 코드 인증 지원
// 토큰은 localStorage에 저장되며, 피드백 전송 시 Authorization 헤더로 전달
//

import type {
  AuthResponse,
  AuthState,
  ImpakersAuthContext,
  ImpakersDebugAuthContext,
  LinkedService,
  LinkServiceResponse,
  LoginRequest,
  SignupRequest,
  UserAuthResponse,
} from "./types";
import { storage, KEYS } from "./storage";

// =============================================================================
// Stored Data Types
// =============================================================================

/** 레거시 토큰 데이터 */
interface StoredLegacyTokenData {
  token: string;
  serviceName: string;
  expiresAt: string;
}

/** 유저 토큰 데이터 */
interface StoredUserData {
  token: string;
  userId: string;
  userName: string;
  userEmail: string;
  userPhone?: string;
  services: LinkedService[];
  activeServiceId?: string;
  /** 도메인 → serviceId 매핑 (서비스별 인증코드 검증 기록) */
  domainServiceMap?: Record<string, string>;
  expiresAt: string;
}

// =============================================================================
// Internal Helpers
// =============================================================================

function loadUserData(): StoredUserData | null {
  const data = storage.get(KEYS.USER_DATA);
  if (!data) return null;
  try {
    const parsed: StoredUserData = JSON.parse(data) as StoredUserData;
    if (new Date(parsed.expiresAt) < new Date()) {
      storage.remove(KEYS.USER_DATA);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function loadLegacyData(): StoredLegacyTokenData | null {
  const data = storage.get(KEYS.LEGACY_TOKEN_DATA);
  if (!data) return null;
  try {
    const parsed: StoredLegacyTokenData = JSON.parse(data) as StoredLegacyTokenData;
    if (new Date(parsed.expiresAt) < new Date()) {
      storage.remove(KEYS.LEGACY_TOKEN_DATA);
      storage.remove(KEYS.LEGACY_TOKEN);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function getCurrentDomain(): string {
  if (typeof window === "undefined") return "";
  return window.location.hostname;
}

/** 현재 도메인에 매핑된 serviceId 반환 */
function getDomainServiceId(userData: StoredUserData): string | null {
  const domain = getCurrentDomain();
  if (!domain || !userData.domainServiceMap) return null;
  return userData.domainServiceMap[domain] ?? null;
}

function saveUserData(data: StoredUserData): void {
  storage.set(KEYS.USER_DATA, JSON.stringify(data));
  dispatchAuthChange();
}

/**
 * 인증 상태 변경을 외부 패키지(@impakers/telemetry 등)에 알린다.
 * 컴파일 타임 의존성 없이 window CustomEvent로만 결합한다.
 */
export const IMPAKERS_DEBUG_AUTH_CHANGE_EVENT = "impakers-debug:auth-change";

export function dispatchAuthChange(): void {
  if (typeof window === "undefined") return;
  const context = getImpakersDebugAuthContext();
  const detail =
    context.token && context.user
      ? {
          clientId: context.user.id,
          clientName: context.user.name ?? "",
          token: context.token,
        }
      : null;
  window.dispatchEvent(new CustomEvent(IMPAKERS_DEBUG_AUTH_CHANGE_EVENT, { detail }));
}

// =============================================================================
// Token Loading (하위 호환)
// =============================================================================

/** 로컬스토리지에서 토큰 로드 (유저 토큰 우선, 레거시 폴백) */
export function loadToken(): string | null {
  const userData = loadUserData();
  if (userData) return userData.token;

  const legacy = loadLegacyData();
  if (legacy) return legacy.token;

  return null;
}

/** 토큰이 유효한지 확인 */
export function isAuthenticated(): boolean {
  return loadToken() !== null;
}

/** 저장된 서비스 이름 (현재 도메인 기준) */
export function getServiceName(): string | null {
  const userData = loadUserData();
  if (userData) {
    // 현재 도메인에 매핑된 서비스 우선
    const domainServiceId = getDomainServiceId(userData);
    if (domainServiceId) {
      const service = userData.services.find((s) => s.serviceId === domainServiceId);
      if (service) return service.serviceName;
    }
    return null;
  }

  // 레거시 폴백
  const legacy = loadLegacyData();
  return legacy?.serviceName ?? null;
}

// =============================================================================
// Auth State Machine
// =============================================================================

/** 현재 인증 상태 (3단계) — 유저 로그인 필수, 도메인별 서비스 구분 */
export function getAuthState(): AuthState {
  const userData = loadUserData();
  if (!userData) return "unauthenticated";

  // 현재 도메인에 연결된 서비스가 있는지 확인
  const domainServiceId = getDomainServiceId(userData);
  if (domainServiceId) {
    // 해당 서비스가 아직 유효한지 (services 목록에 존재하는지) 확인
    if (userData.services.some((s) => s.serviceId === domainServiceId)) {
      return "logged_in_with_service";
    }
  }

  return "logged_in_no_service";
}

// =============================================================================
// User Data Access
// =============================================================================

/** 저장된 유저 정보 */
export function getStoredUser(): { userId: string; userName: string; userEmail: string; userPhone?: string } | null {
  const userData = loadUserData();
  if (!userData) return null;
  return {
    userId: userData.userId,
    userName: userData.userName,
    userEmail: userData.userEmail,
    userPhone: userData.userPhone,
  };
}

/** 연결된 서비스 목록 */
export function getLinkedServices(): LinkedService[] {
  const userData = loadUserData();
  return userData?.services ?? [];
}

/** 현재 활성 서비스 ID (현재 도메인 기준) */
export function getActiveServiceId(): string | null {
  const userData = loadUserData();
  if (!userData) return null;
  return getDomainServiceId(userData);
}

/** 외부 패키지(@impakers/telemetry 등)가 재사용할 안정적인 인증 컨텍스트 */
export function getImpakersDebugAuthContext(): ImpakersDebugAuthContext {
  const userData = loadUserData();
  if (!userData) {
    return {
      authState: "unauthenticated",
      token: null,
      user: null,
      activeService: null,
    };
  }

  const domainServiceId = getDomainServiceId(userData);
  const activeService = domainServiceId
    ? userData.services.find((service) => service.serviceId === domainServiceId) ?? null
    : null;

  return {
    authState: activeService ? "logged_in_with_service" : "logged_in_no_service",
    token: userData.token,
    user: {
      id: userData.userId,
      name: userData.userName,
    },
    activeService: activeService
      ? {
          id: activeService.serviceId,
          name: activeService.serviceName,
        }
      : null,
  };
}

/** 외부 패키지용 공개 인증 컨텍스트. activeService 대신 service 명칭을 사용한다. */
export function getImpakersAuthContext(): ImpakersAuthContext {
  const context = getImpakersDebugAuthContext();
  return {
    authState: context.authState,
    token: context.token,
    user: context.user
      ? {
          id: context.user.id,
          name: context.user.name,
          emailHash: context.user.emailHash,
        }
      : null,
    service: context.activeService
      ? {
          id: context.activeService.id,
          name: context.activeService.name,
        }
      : null,
  };
}

/** 활성 서비스 변경 */
export function setActiveService(serviceId: string): void {
  const userData = loadUserData();
  if (!userData) return;
  if (!userData.services.some((s) => s.serviceId === serviceId)) return;
  userData.activeServiceId = serviceId;
  saveUserData(userData);
}

// =============================================================================
// Token Save / Clear
// =============================================================================

/** 레거시 인증 토큰 저장 (하위 호환) */
export function saveToken(authResponse: AuthResponse): void {
  const data: StoredLegacyTokenData = {
    token: authResponse.token,
    serviceName: authResponse.serviceName,
    expiresAt: authResponse.expiresAt,
  };
  storage.set(KEYS.LEGACY_TOKEN_DATA, JSON.stringify(data));
  storage.set(KEYS.LEGACY_TOKEN, authResponse.token);
  dispatchAuthChange();
}

/** 모든 인증 토큰 삭제 */
export function clearToken(): void {
  storage.remove(KEYS.USER_DATA);
  storage.remove(KEYS.LEGACY_TOKEN_DATA);
  storage.remove(KEYS.LEGACY_TOKEN);
  dispatchAuthChange();
}

// =============================================================================
// Legacy: 시크릿 코드 인증 (하위 호환)
// =============================================================================

/** 시크릿 코드로 인증 요청 (레거시) */
export async function authenticate(
  endpoint: string,
  code: string,
): Promise<AuthResponse> {
  const domain = window.location.hostname;

  const res = await fetch(`${endpoint}/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, domain }),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: "인증 실패" }));
    throw new Error(error.message || "인증 실패");
  }

  const authResponse: AuthResponse = await res.json();
  saveToken(authResponse);
  return authResponse;
}

// =============================================================================
// User Auth: 회원가입 / 로그인 / 서비스 연결
// =============================================================================

/** 회원가입 */
export async function signup(
  endpoint: string,
  data: SignupRequest,
): Promise<UserAuthResponse> {
  const res = await fetch(`${endpoint}/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: "회원가입 실패" }));
    throw new Error(error.message || "회원가입 실패");
  }

  const authResponse: UserAuthResponse = await res.json();
  saveUserData({
    token: authResponse.token,
    userId: authResponse.user.id,
    userName: authResponse.user.name,
    userEmail: authResponse.user.email,
    userPhone: authResponse.user.phone,
    services: authResponse.services,
    activeServiceId: authResponse.services[0]?.serviceId,
    expiresAt: authResponse.expiresAt,
  });
  return authResponse;
}

/** 로그인 */
export async function login(
  endpoint: string,
  data: LoginRequest,
): Promise<UserAuthResponse> {
  const res = await fetch(`${endpoint}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: "로그인 실패" }));
    throw new Error(error.message || "로그인 실패");
  }

  const authResponse: UserAuthResponse = await res.json();
  saveUserData({
    token: authResponse.token,
    userId: authResponse.user.id,
    userName: authResponse.user.name,
    userEmail: authResponse.user.email,
    userPhone: authResponse.user.phone,
    services: authResponse.services,
    activeServiceId: authResponse.services[0]?.serviceId,
    expiresAt: authResponse.expiresAt,
  });
  return authResponse;
}

/** 서비스 연결 (인증코드 검증) */
export async function linkService(
  endpoint: string,
  code: string,
): Promise<LinkServiceResponse> {
  const token = loadToken();
  if (!token) throw new Error("로그인이 필요합니다");

  const domain = window.location.hostname;

  const res = await fetch(`${endpoint}/auth/link-service`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ code, domain }),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: "서비스 연결 실패" }));
    throw new Error(error.message || "서비스 연결 실패");
  }

  const linkResponse: LinkServiceResponse = await res.json();

  // 저장된 유저 데이터의 서비스 목록 + 도메인 매핑 갱신
  const userData = loadUserData();
  if (userData) {
    userData.services = linkResponse.services;
    userData.activeServiceId = linkResponse.service.serviceId;
    // 현재 도메인 → 연결된 서비스 매핑 기록
    const domain = getCurrentDomain();
    if (domain) {
      userData.domainServiceMap = {
        ...(userData.domainServiceMap || {}),
        [domain]: linkResponse.service.serviceId,
      };
    }
    saveUserData(userData);
  }

  return linkResponse;
}
