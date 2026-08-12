// =============================================================================
// local-feedbacker/jsx-source-loader — build-time JSX source location injection
// =============================================================================
//
// To deterministically map a clicked DOM element back to "the file:line it was
// actually written in" in production, this loader injects data attributes onto
// JSX elements at build time.
//
// React strips _debugSource in production (React 19 removes it entirely), and
// component names get minified, so runtime inference alone can't recover the
// original location reliably.
//
// Key idea: the host element and the component element get **different**
// attribute names.
//
//   // app/dashboard/page.tsx:42 source
//   <Button variant="ghost">Save</Button>
//
//   // after injection — shadcn's Button spreads {...props} onto <button>,
//   // so the final DOM carries both the definition and the call site
//   <button data-imp="components/ui/button.tsx:57:5"      ← definition
//           data-imp-o="app/dashboard/page.tsx:42:7">     ← call site (= real source)
//
// If both used the same attribute name, which one wins would depend on each
// component's {...props} spread order. Separate names guarantee both survive.
// =============================================================================

import { parse } from "@babel/parser";
import MagicString from "magic-string";
import * as path from "path";

/** Definition site — the file that physically wrote this DOM tag */
export const ATTR_DEFINITION = "data-imp";
/** Call site — the file that used the component. The "real source" we actually want */
export const ATTR_CALLSITE = "data-imp-o";

export interface JsxSourceLoaderOptions {
  /**
   * Attribute value format.
   * - "path": embed the project-relative path verbatim.
   * - "id":   embed a short file ID only; the path lives in a manifest
   *           emitted separately (keeps HTML small, avoids exposing the
   *           source tree layout directly).
   *
   * Turbopack doesn't run webpack plugins, so it can't emit a manifest —
   * it uses "path". Webpack builds default to "id".
   */
  mode?: "path" | "id";
  /** Directory to accumulate file-ID ↔ path sidecar files in "id" mode */
  cacheDir?: string;
  /** Project root (defaults to the loader's rootContext) */
  projectDir?: string;
}

/**
 * Relative path → 6-char base36 ID.
 *
 * Loaders run scattered across webpack/turbopack workers, so a shared counter
 * isn't available. The ID must be a pure function of the path so any worker
 * produces the same ID for the same file.
 */
export function fileIdFor(relativePath: string): string {
  // FNV-1a 32bit
  let hash = 0x811c9dc5;
  for (let i = 0; i < relativePath.length; i++) {
    hash ^= relativePath.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36).padStart(6, "0").slice(-6);
}

function toPosix(p: string): string {
  return p.replace(/\\/g, "/");
}

/** Capitalized name or member expression = component; otherwise a host element (div, button, …) */
function isComponentElement(nameNode: any): boolean {
  if (!nameNode) return false;
  if (nameNode.type === "JSXMemberExpression") return true; // <Foo.Bar>
  if (nameNode.type === "JSXNamespacedName") return false; // <svg:use>
  if (nameNode.type === "JSXIdentifier") {
    const first = nameNode.name.charAt(0);
    return first === first.toUpperCase() && first !== first.toLowerCase();
  }
  return false;
}

function elementName(nameNode: any): string {
  if (!nameNode) return "";
  if (nameNode.type === "JSXIdentifier") return nameNode.name;
  if (nameNode.type === "JSXMemberExpression") {
    return `${elementName(nameNode.object)}.${elementName(nameNode.property)}`;
  }
  if (nameNode.type === "JSXNamespacedName") {
    return `${nameNode.namespace?.name}:${nameNode.name?.name}`;
  }
  return "";
}

/** Leave elements that already carry the attribute by hand untouched. */
function hasAttribute(openingElement: any, attrName: string): boolean {
  return (openingElement.attributes ?? []).some(
    (attr: any) => attr.type === "JSXAttribute" && attr.name?.name === attrName
  );
}

/**
 * Recursively walks the AST collecting JSXOpeningElement nodes.
 * @babel/traverse is heavyweight and directly impacts build time, so we
 * avoid it in favor of a minimal hand-rolled walk.
 */
function collectJsxOpeningElements(node: any, out: any[]): void {
  if (!node || typeof node !== "object") return;

  if (Array.isArray(node)) {
    for (const child of node) collectJsxOpeningElements(child, out);
    return;
  }

  if (typeof node.type === "string" && node.type === "JSXOpeningElement") {
    out.push(node);
  }

  for (const key of Object.keys(node)) {
    if (key === "loc" || key === "leadingComments" || key === "trailingComments") continue;
    const value = (node as Record<string, unknown>)[key];
    if (value && typeof value === "object") collectJsxOpeningElements(value, out);
  }
}

/**
 * Injects source location attributes into the given source. Split out from
 * the loader shell so it's testable standalone.
 *
 * @returns The transformed source, or the original if there was nothing to inject.
 */
export function injectSourceAttributes(
  source: string,
  relativePath: string,
  options: { mode?: "path" | "id" } = {}
): string {
  // No JSX means parsing isn't even worth the cost
  if (!source.includes("<")) return source;

  let ast: any;
  try {
    ast = parse(source, {
      sourceType: "module",
      allowReturnOutsideFunction: true,
      errorRecovery: true,
      plugins: [
        "jsx",
        "typescript",
        "decorators-legacy",
        "classProperties",
        "importAssertions",
        "explicitResourceManagement",
      ],
    });
  } catch {
    // Parse failures pass the source through silently — injection is a
    // bonus feature and must never break the build.
    return source;
  }

  const openingElements: any[] = [];
  collectJsxOpeningElements(ast.program, openingElements);
  if (openingElements.length === 0) return source;

  const token = options.mode === "path" ? toPosix(relativePath) : fileIdFor(toPosix(relativePath));
  const magic = new MagicString(source);
  let injected = 0;

  for (const openingElement of openingElements) {
    const nameNode = openingElement.name;
    const name = elementName(nameNode);

    // Fragments (<> / <Fragment>) don't produce DOM
    if (!name || name === "Fragment" || name.endsWith(".Fragment")) continue;

    const isComponent = isComponentElement(nameNode);
    const attrName = isComponent ? ATTR_CALLSITE : ATTR_DEFINITION;
    if (hasAttribute(openingElement, attrName)) continue;

    const loc = nameNode.loc?.start;
    if (!loc) continue;

    // Insert right after the element name — except generic JSX in TSX
    // (`<Select<Option, false> ... />`) has type arguments between the name
    // and the attributes. Inserting at the name's end there would produce
    // `<Select data-imp="…"<Option, false>`, which is invalid syntax.
    // (Depending on the Babel version this shows up as typeArguments or
    // typeParameters.)
    const typeArgs = openingElement.typeArguments ?? openingElement.typeParameters;
    const insertAt =
      typeArgs && typeof typeArgs.end === "number" ? typeArgs.end : nameNode.end;
    if (typeof insertAt !== "number") continue;

    magic.appendLeft(insertAt, ` ${attrName}="${token}:${loc.line}:${loc.column}"`);
    injected++;
  }

  return injected > 0 ? magic.toString() : source;
}

/** Sidecar write — the plugin collects these into a manifest later */
function writeSidecar(cacheDir: string, fileId: string, relativePath: string): void {
  try {
    const fs = require("fs");
    fs.mkdirSync(cacheDir, { recursive: true });
    const target = path.join(cacheDir, `${fileId}.txt`);
    // Skip if unchanged, so watch mode doesn't rewrite it every pass
    if (fs.existsSync(target) && fs.readFileSync(target, "utf-8") === relativePath) return;
    fs.writeFileSync(target, relativePath, "utf-8");
  } catch {}
}

/**
 * webpack-compatible loader. Turbopack's `turbopack.rules` accepts the same signature.
 */
export default function jsxSourceLoader(this: any, source: string): string {
  // The loader is a bonus feature — it must never throw an exception outward
  try {
    const options: JsxSourceLoaderOptions =
      (typeof this.getOptions === "function" ? this.getOptions() : this.query) || {};

    const resourcePath: string = this.resourcePath || "";
    if (!resourcePath || resourcePath.includes("node_modules")) return source;

    const projectDir = options.projectDir || this.rootContext || process.cwd();
    const relativePath = toPosix(path.relative(projectDir, resourcePath));
    // Skip anything outside the project (e.g. symlinked packages)
    if (!relativePath || relativePath.startsWith("..")) return source;

    const mode = options.mode ?? "id";
    const result = injectSourceAttributes(source, relativePath, { mode });

    if (mode === "id" && options.cacheDir && result !== source) {
      writeSidecar(options.cacheDir, fileIdFor(relativePath), relativePath);
    }

    return result;
  } catch {
    return source;
  }
}
