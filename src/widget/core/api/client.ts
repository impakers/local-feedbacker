// HTTP 클라이언트 — 인증 헤더 주입, 파일 업로드, 유저 정보 조회
import type { FileUploadResult, FeedbackUser } from "../types";
import { loadToken, getStoredUser, getActiveServiceId } from "../auth";

const MAX_FILE_SIZE = 4.5 * 1024 * 1024;

function getToken(): string {
  const token = loadToken();
  if (!token) throw new Error("인증이 필요합니다");
  return token;
}

export async function apiFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = getToken();
  const serviceId = getActiveServiceId();
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(serviceId && { "X-Service-Id": serviceId }),
      ...options.headers,
    },
  });

  if (!res.ok) {
    if (res.status === 401) throw new Error("인증이 만료되었습니다.");
    const err = await res.json().catch(() => ({ error: "요청 실패" })) as { error?: string; message?: string };
    throw new Error(err.error ?? err.message ?? "요청 실패");
  }

  return res;
}

export async function uploadFile(
  endpoint: string,
  file: File,
  context: "feedback" | "comment",
  taskId?: string,
): Promise<FileUploadResult> {
  if (file.size > MAX_FILE_SIZE) {
    throw new Error(`파일 크기가 4.5MB를 초과합니다. (${(file.size / 1024 / 1024).toFixed(1)}MB)`);
  }

  const token = getToken();
  const serviceId = getActiveServiceId();
  const formData = new FormData();
  formData.append("file", file);
  formData.append("context", context);
  if (taskId) formData.append("taskId", taskId);

  const res = await fetch(`${endpoint}/upload`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(serviceId && { "X-Service-Id": serviceId }),
    },
    body: formData,
  });

  if (!res.ok) {
    if (res.status === 401) throw new Error("인증이 만료되었습니다.");
    if (res.status === 413) throw new Error("파일 크기가 4.5MB를 초과합니다.");
    const err = await res.json().catch(() => ({ error: "파일 업로드 실패" })) as { error?: string };
    throw new Error(err.error ?? "파일 업로드 실패");
  }

  return res.json() as Promise<FileUploadResult>;
}

export function getAuthenticatedUser(): FeedbackUser | null {
  const user = getStoredUser();
  if (!user) return null;
  return {
    id: user.userId,
    name: user.userName,
    email: user.userEmail,
    phone: user.userPhone,
  };
}
