import { describe, expect, it } from "vitest";
import { buildZip, crc32, type ZipEntry } from "./zip";

const FIXED_DATE = new Date(2026, 7, 11, 14, 32, 10);

const encoder = new TextEncoder();
const file = (name: string, text: string): ZipEntry => ({ name, data: encoder.encode(text) });

async function bytesOf(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

/** little-endian 정수 읽기 — 헤더 필드를 눈으로 검증하기 위한 것. */
function u16(bytes: Uint8Array, at: number): number {
  return bytes[at]! | (bytes[at + 1]! << 8);
}
function u32(bytes: Uint8Array, at: number): number {
  return (bytes[at]! | (bytes[at + 1]! << 8) | (bytes[at + 2]! << 16) | (bytes[at + 3]! << 24)) >>> 0;
}

describe("crc32", () => {
  // 표준 검사 벡터 — 구현이 IEEE 802.3 다항식을 쓰는지 고정한다.
  it("matches the well-known check value for \"123456789\"", () => {
    expect(crc32(encoder.encode("123456789"))).toBe(0xcbf43926);
  });

  it("is 0 for empty input", () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
});

describe("buildZip", () => {
  it("starts with the local file header signature", async () => {
    const bytes = await bytesOf(buildZip([file("a.md", "hello")], FIXED_DATE));
    expect(u32(bytes, 0)).toBe(0x04034b50);
  });

  it("ends with an end-of-central-directory record counting every entry", async () => {
    const entries = [file("001-a.md", "one"), file("002-b.md", "two"), file("003-c.md", "three")];
    const bytes = await bytesOf(buildZip(entries, FIXED_DATE));

    const eocdAt = bytes.length - 22;
    expect(u32(bytes, eocdAt)).toBe(0x06054b50);
    expect(u16(bytes, eocdAt + 8)).toBe(3); // 이 디스크의 항목 수
    expect(u16(bytes, eocdAt + 10)).toBe(3); // 전체 항목 수
  });

  it("points the central directory at a real local header", async () => {
    // offset 이 틀리면 압축 해제 도구가 아카이브를 통째로 거부한다.
    const entries = [file("001-a.md", "one"), file("002-b.md", "two")];
    const bytes = await bytesOf(buildZip(entries, FIXED_DATE));

    const eocdAt = bytes.length - 22;
    const centralSize = u32(bytes, eocdAt + 12);
    const centralAt = u32(bytes, eocdAt + 16);

    expect(u32(bytes, centralAt)).toBe(0x02014b50);
    expect(centralAt + centralSize).toBe(eocdAt);

    // 두 번째 central header 가 가리키는 곳에도 local header 가 있어야 한다.
    const firstNameLen = u16(bytes, centralAt + 28);
    const secondAt = centralAt + 46 + firstNameLen;
    expect(u32(bytes, secondAt)).toBe(0x02014b50);
    expect(u32(bytes, u32(bytes, secondAt + 42))).toBe(0x04034b50);
  });

  it("stores content uncompressed with a matching crc and size", async () => {
    const text = "hello";
    const bytes = await bytesOf(buildZip([file("a.md", text)], FIXED_DATE));

    expect(u16(bytes, 8)).toBe(0); // 0 = STORE
    expect(u32(bytes, 14)).toBe(crc32(encoder.encode(text)));
    expect(u32(bytes, 18)).toBe(text.length); // compressed
    expect(u32(bytes, 22)).toBe(text.length); // uncompressed

    // 이름 뒤에 원문이 그대로 실려 있다.
    const nameLen = u16(bytes, 26);
    const body = bytes.slice(30 + nameLen, 30 + nameLen + text.length);
    expect(new TextDecoder().decode(body)).toBe(text);
  });

  it("flags filenames as UTF-8 so non-ASCII names survive", async () => {
    const bytes = await bytesOf(buildZip([file("피드백.md", "x")], FIXED_DATE));

    expect(u16(bytes, 6) & 0x0800).toBe(0x0800);
    const nameLen = u16(bytes, 26);
    expect(new TextDecoder().decode(bytes.slice(30, 30 + nameLen))).toBe("피드백.md");
  });

  it("keeps binary payloads byte-for-byte", async () => {
    // 스크린샷은 JPEG 바이트다 — 텍스트 경유로 망가지면 안 된다.
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
    const bytes = await bytesOf(buildZip([{ name: "shot.jpg", data: jpeg }], FIXED_DATE));

    const nameLen = u16(bytes, 26);
    expect(Array.from(bytes.slice(30 + nameLen, 30 + nameLen + jpeg.length))).toEqual(Array.from(jpeg));
  });

  it("produces a valid empty archive", async () => {
    const bytes = await bytesOf(buildZip([], FIXED_DATE));
    expect(bytes.length).toBe(22);
    expect(u32(bytes, 0)).toBe(0x06054b50);
    expect(u16(bytes, 8)).toBe(0);
  });

  it("encodes the timestamp in MS-DOS format", async () => {
    const bytes = await bytesOf(buildZip([file("a.md", "x")], FIXED_DATE));

    const time = u16(bytes, 10);
    const date = u16(bytes, 12);
    expect(time >> 11).toBe(14); // 시
    expect((time >> 5) & 0x3f).toBe(32); // 분
    expect(((date >> 9) & 0x7f) + 1980).toBe(2026);
    expect((date >> 5) & 0x0f).toBe(8); // 8월
    expect(date & 0x1f).toBe(11);
  });
});
