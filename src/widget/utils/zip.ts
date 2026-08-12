// =============================================================================
// 의존성 없는 최소 ZIP(STORE) 작성기 + 평범한 파일 다운로드
// =============================================================================
// 내보내기가 File System Access API(showDirectoryPicker)를 쓰면 브라우저가 폴더
// 권한 대화상자를 띄우고, Chrome 은 홈·바탕화면처럼 "시스템 파일이 있는" 위치를
// 아예 거절한다. 그렇다고 파일을 하나씩 내려받으면 이번엔 "이 사이트가 여러 파일을
// 다운로드하려 합니다" 확인이 뜬다. 한 개의 zip 으로 묶으면 둘 다 없다 —
// 그냥 평범한 다운로드 한 번이고, 지원하지 않는 브라우저도 없다.
//
// JPEG 는 이미 압축돼 있고 마크다운은 작다. deflate 로 얻을 이득보다 압축
// 라이브러리를 들이는 비용이 크므로 STORE(압축 없음)만 쓴다.

import { originalSetTimeout } from "./freeze-animations";

const CRC_TABLE = /* @__PURE__ */ (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

/** ZIP 이 요구하는 CRC-32(IEEE 802.3). */
export function crc32(bytes: Uint8Array<ArrayBufferLike>): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC_TABLE[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// TS 5.9 부터 Uint8Array 는 버퍼 종류를 타입 인자로 갖는다. Blob 은 공유 버퍼
// (SharedArrayBuffer)를 받지 않으므로 일반 ArrayBuffer 를 명시해 둔다.
type Bytes = Uint8Array<ArrayBuffer>;

export interface ZipEntry {
  /** 아카이브 안에서의 경로. `/` 로 하위 폴더를 만들 수 있다. */
  name: string;
  data: Bytes;
}

/** MS-DOS 형식 시각(2초 단위) — ZIP 헤더가 이 모양만 받는다. */
function toDosTime(date: Date): number {
  return (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
}

/** MS-DOS 형식 날짜(1980 기준). 1980 이전은 표현할 수 없어 바닥으로 눌러 둔다. */
function toDosDate(date: Date): number {
  const year = Math.max(date.getFullYear() - 1980, 0);
  return (year << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
}

/**
 * 파일 여러 개를 무압축 ZIP 한 덩어리로 묶는다.
 *
 * `date` 를 받는 것은 테스트에서 결과를 고정하기 위해서다(기본값은 지금).
 */
export function buildZip(entries: readonly ZipEntry[], date: Date = new Date()): Blob {
  const encoder = new TextEncoder();
  const dosTime = toDosTime(date);
  const dosDate = toDosDate(date);

  const parts: Bytes[] = [];
  const central: Bytes[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const size = entry.data.length;

    // --- local file header ---
    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true); // version needed
    lv.setUint16(6, 0x0800, true); // 파일명을 UTF-8 로 읽으라는 표시
    lv.setUint16(8, 0, true); // 0 = STORE
    lv.setUint16(10, dosTime, true);
    lv.setUint16(12, dosDate, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true); // compressed
    lv.setUint32(22, size, true); // uncompressed (STORE 라 같다)
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true); // extra field 없음
    local.set(nameBytes, 30);
    parts.push(local, entry.data);

    // --- central directory header ---
    const dir = new Uint8Array(46 + nameBytes.length);
    const dv = new DataView(dir.buffer);
    dv.setUint32(0, 0x02014b50, true);
    dv.setUint16(4, 20, true); // version made by
    dv.setUint16(6, 20, true); // version needed
    dv.setUint16(8, 0x0800, true);
    dv.setUint16(10, 0, true);
    dv.setUint16(12, dosTime, true);
    dv.setUint16(14, dosDate, true);
    dv.setUint32(16, crc, true);
    dv.setUint32(20, size, true);
    dv.setUint32(24, size, true);
    dv.setUint16(28, nameBytes.length, true);
    dv.setUint16(30, 0, true); // extra
    dv.setUint16(32, 0, true); // comment
    dv.setUint16(34, 0, true); // disk number
    dv.setUint16(36, 0, true); // internal attrs
    dv.setUint32(38, 0, true); // external attrs
    dv.setUint32(42, offset, true); // local header 위치
    dir.set(nameBytes, 46);
    central.push(dir);

    offset += local.length + size;
  }

  const centralSize = central.reduce((sum, chunk) => sum + chunk.length, 0);

  // --- end of central directory ---
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true); // disk number
  ev.setUint16(6, 0, true); // central directory 가 시작하는 disk
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true); // 주석 없음

  return new Blob([...parts, ...central, end], { type: "application/zip" });
}

/** Blob 을 사용자의 다운로드 폴더로 내려보낸다. 권한도 대화상자도 없다. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  // 일부 브라우저는 문서에 붙어 있지 않은 앵커의 click() 을 무시한다.
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // 곧바로 revoke 하면 다운로드가 시작되기 전에 URL 이 사라지는 브라우저가 있다.
  // 프리즈 패치가 걸린 setTimeout 은 멈춰 있을 수 있어 원본 타이머를 쓴다.
  originalSetTimeout(() => URL.revokeObjectURL(url), 10_000);
}
