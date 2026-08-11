// 전송 중(파일 업로드 + 코멘트 POST) in-flight 추적 — 이탈 시 유실 경고
//
// fetch 에 AbortController 를 걸지 않으므로 위젯/패널 언마운트로는 요청이 끊기지 않는다.
// 다만 새로고침·탭 닫기·외부 URL 이동은 브라우저가 in-flight 요청을 취소하므로
// 그 순간에만 beforeunload 로 사용자에게 경고한다.

let pendingCount = 0;
let handler: ((e: BeforeUnloadEvent) => void) | null = null;

function attachGuard(): void {
  if (typeof window === "undefined" || handler) return;
  handler = (e: BeforeUnloadEvent) => {
    e.preventDefault();
    // 레거시 브라우저 호환 — 실제 문구는 브라우저 기본 메시지로 대체된다.
    e.returnValue = "";
    return "";
  };
  window.addEventListener("beforeunload", handler);
}

function detachGuard(): void {
  if (typeof window === "undefined" || !handler) return;
  window.removeEventListener("beforeunload", handler);
  handler = null;
}

/**
 * 전송 시작을 등록한다. 반환된 함수를 반드시 finally 에서 호출해 해제할 것.
 * 중복 호출은 무시되므로 안전하다.
 */
export function beginPendingUpload(): () => void {
  pendingCount += 1;
  if (pendingCount === 1) attachGuard();

  let released = false;
  return () => {
    if (released) return;
    released = true;
    pendingCount = Math.max(0, pendingCount - 1);
    if (pendingCount === 0) detachGuard();
  };
}

export function hasPendingUploads(): boolean {
  return pendingCount > 0;
}
