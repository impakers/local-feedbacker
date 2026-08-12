import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildZip } from "./zip";

// 자체 검증은 "내가 쓴 대로 썼는가"만 확인한다. 실제 압축 해제 도구가 받아 주는지는
// 별개 문제라 시스템 unzip 으로 한 번 더 확인한다.
describe("buildZip (real unzip)", () => {
  it("produces an archive the system unzip accepts and extracts intact", async () => {
    const encoder = new TextEncoder();
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
    const markdown = "## 피드백: 버튼이 안 눌려요\n\n- 화면: /orders\n";

    const blob = buildZip([
      { name: "001-버튼이 안 눌려요.md", data: encoder.encode(markdown) },
      { name: "001-버튼이 안 눌려요.jpg", data: jpeg },
    ]);

    const dir = mkdtempSync(join(tmpdir(), "lf-zip-"));
    const archive = join(dir, "out.zip");
    writeFileSync(archive, new Uint8Array(await blob.arrayBuffer()));

    // -t 는 CRC 까지 검사한다. 헤더나 offset 이 틀리면 여기서 0 이 아닌 코드로 죽는다.
    const verdict = execFileSync("unzip", ["-t", archive], { encoding: "utf-8" });
    expect(verdict).toContain("No errors detected");

    // 내용/이름 대조는 python zipfile 로 한다. macOS 가 들고 있는 Info-ZIP 6.00 은
    // UTF-8 파일명 플래그(0x0800)가 표준이 되기 전 버전이라 한글 이름을 CP437 로
    // 읽어 깨뜨린다 — 아카이브가 아니라 그 도구의 한계다.
    const probe = `
import json, sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as z:
    print(json.dumps({n: z.read(n).decode("utf-8", "replace") if n.endswith(".md")
                         else list(z.read(n)) for n in z.namelist()}))
`;
    const extracted = JSON.parse(execFileSync("python3", ["-c", probe, archive], { encoding: "utf-8" }));
    expect(extracted["001-버튼이 안 눌려요.md"]).toBe(markdown);
    expect(extracted["001-버튼이 안 눌려요.jpg"]).toEqual(Array.from(jpeg));
  });
});
