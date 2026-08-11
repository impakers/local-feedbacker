import React from "react";

/**
 * 의존성 없는 초경량 마크다운 렌더러.
 *
 * 피드백 위젯의 대화 내역 · 수신함 본문에서 사용한다. npm 공개 패키지라
 * react-markdown 같은 무거운 의존성을 추가하지 않고, 자주 쓰는 서식만 안전하게
 * (문자열 그대로 React 노드로 변환 — dangerouslySetInnerHTML 미사용) 렌더한다.
 *
 * 지원: **굵게**, *기울임*, `인라인 코드`, ~~취소선~~, [링크](url),
 *      불릿/번호 목록, 인용(>), 코드펜스(```), 문단/줄바꿈.
 * 미지원(의도적): '#' 헤딩 — 원문 그대로 텍스트로 남는다.
 */

const codeStyle: React.CSSProperties = {
  fontFamily:
    "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  fontSize: "0.85em",
  background: "rgba(0,0,0,0.06)",
  padding: "1px 4px",
  borderRadius: 4,
};

const linkStyle: React.CSSProperties = {
  color: "#2563eb",
  textDecoration: "underline",
  wordBreak: "break-all",
};

/** javascript: 등 위험한 스킴 차단. 허용 스킴만 링크로, 아니면 null. */
function safeUrl(url: string): string | null {
  const trimmed = url.trim();
  if (/^(https?:|mailto:|tel:)/i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("/") || trimmed.startsWith("#")) return trimmed;
  return null;
}

const INLINE_RE =
  /`([^`]+)`|\*\*([^*]+?)\*\*|__([^_]+?)__|~~([^~]+?)~~|\*([^*\n]+?)\*|(?<![A-Za-z0-9])_([^_\n]+?)_(?![A-Za-z0-9])|\[([^\]]+?)\]\(([^)\s]+?)\)/g;

/** 한 줄(또는 문단 조각) 안의 인라인 서식을 React 노드 배열로 변환. */
function parseInline(text: string, keyPrefix: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  let i = 0;
  INLINE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = INLINE_RE.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${keyPrefix}-${i++}`;
    if (m[1] != null) {
      out.push(
        <code key={k} style={codeStyle}>
          {m[1]}
        </code>,
      );
    } else if (m[2] != null || m[3] != null) {
      out.push(<strong key={k}>{m[2] ?? m[3]}</strong>);
    } else if (m[4] != null) {
      out.push(<del key={k}>{m[4]}</del>);
    } else if (m[5] != null || m[6] != null) {
      out.push(<em key={k}>{m[5] ?? m[6]}</em>);
    } else if (m[7] != null && m[8] != null) {
      const href = safeUrl(m[8]);
      if (href) {
        out.push(
          <a
            key={k}
            href={href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            style={linkStyle}
            onClick={(e) => e.stopPropagation()}
          >
            {m[7]}
          </a>,
        );
      } else {
        out.push(m[0]);
      }
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** 문단 내 여러 줄을 <br/> 로 이어 붙인다. */
function renderParagraph(lines: string[], key: string): React.ReactNode {
  const nodes: React.ReactNode[] = [];
  lines.forEach((line, idx) => {
    if (idx > 0) nodes.push(<br key={`${key}-br${idx}`} />);
    nodes.push(...parseInline(line, `${key}-l${idx}`));
  });
  return (
    <p key={key} style={{ margin: 0 }}>
      {nodes}
    </p>
  );
}

const BULLET_RE = /^\s*[-*+]\s+(.*)$/;
const ORDERED_RE = /^\s*\d+[.)]\s+(.*)$/;
const QUOTE_RE = /^\s*>\s?(.*)$/;
const FENCE_RE = /^\s*```/;

/**
 * 마크다운 문자열을 블록 단위 React 노드로 렌더한다.
 * '#' 로 시작하는 줄은 헤딩으로 처리하지 않고 일반 문단으로 남긴다.
 */
export function renderMarkdown(source: string): React.ReactNode {
  if (!source) return null;
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: React.ReactNode[] = [];
  let i = 0;
  let b = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 빈 줄 — 문단 구분
    if (line.trim() === "") {
      i++;
      continue;
    }

    // 코드 펜스 ```
    if (FENCE_RE.test(line)) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !FENCE_RE.test(lines[i])) {
        code.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // 닫는 펜스 소비
      blocks.push(
        <pre
          key={`b${b++}`}
          style={{
            margin: "4px 0",
            padding: "8px 10px",
            background: "rgba(0,0,0,0.06)",
            borderRadius: 6,
            overflowX: "auto",
            fontFamily:
              "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
            fontSize: "0.85em",
            whiteSpace: "pre",
          }}
        >
          <code>{code.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    // 인용문 >
    if (QUOTE_RE.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && QUOTE_RE.test(lines[i])) {
        quoted.push(lines[i].replace(QUOTE_RE, "$1"));
        i++;
      }
      blocks.push(
        <blockquote
          key={`b${b++}`}
          style={{
            margin: "4px 0",
            paddingLeft: 8,
            borderLeft: "3px solid rgba(0,0,0,0.15)",
            color: "#6b7280",
          }}
        >
          {renderParagraph(quoted, `b${b}`)}
        </blockquote>,
      );
      continue;
    }

    // 불릿 목록
    if (BULLET_RE.test(line)) {
      const items: string[] = [];
      while (i < lines.length && BULLET_RE.test(lines[i])) {
        items.push(lines[i].replace(BULLET_RE, "$1"));
        i++;
      }
      blocks.push(
        <ul
          key={`b${b++}`}
          style={{ margin: "4px 0", paddingLeft: 20, listStyle: "disc" }}
        >
          {items.map((it, idx) => (
            <li key={idx} style={{ margin: "2px 0" }}>
              {parseInline(it, `b${b}-i${idx}`)}
            </li>
          ))}
        </ul>,
      );
      continue;
    }

    // 번호 목록
    if (ORDERED_RE.test(line)) {
      const items: string[] = [];
      while (i < lines.length && ORDERED_RE.test(lines[i])) {
        items.push(lines[i].replace(ORDERED_RE, "$1"));
        i++;
      }
      blocks.push(
        <ol
          key={`b${b++}`}
          style={{ margin: "4px 0", paddingLeft: 20, listStyle: "decimal" }}
        >
          {items.map((it, idx) => (
            <li key={idx} style={{ margin: "2px 0" }}>
              {parseInline(it, `b${b}-i${idx}`)}
            </li>
          ))}
        </ol>,
      );
      continue;
    }

    // 일반 문단 — 빈 줄/블록 시작 전까지 묶는다 (헤딩 '#' 포함, 특별 처리 안 함)
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !FENCE_RE.test(lines[i]) &&
      !QUOTE_RE.test(lines[i]) &&
      !BULLET_RE.test(lines[i]) &&
      !ORDERED_RE.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    blocks.push(renderParagraph(para, `b${b++}`));
  }

  return <>{blocks}</>;
}

/** 편의 컴포넌트. */
export function Markdown({ text }: { text: string }): React.ReactElement {
  return <>{renderMarkdown(text)}</>;
}
