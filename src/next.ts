// =============================================================================
// local-feedbacker/next — Next.js Config Plugin
// =============================================================================
//
// Auto-configures source maps for a Next.js project. sourcesContent is
// stripped so the deploy carries file-path + line mappings without exposing
// the original source text (compatible with layering Sentry on top).
//
// Usage:
//   import { withLocalFeedbacker } from 'local-feedbacker/next'
//   export default withLocalFeedbacker(nextConfig)
//
//   // Alongside Sentry:
//   export default withSentryConfig(withLocalFeedbacker(nextConfig), sentryOptions)
//

import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * The ESM bundle (dist/next.mjs) has no real `require`.
 *
 * When this module loads as ESM from `next.config.mjs` or a `"type": "module"`
 * project, the bundler-inserted `require` shim throws on call and has no
 * `.resolve`. That silently (1) skips JSX source attribute injection and
 * (2) drops the turbopack config, which makes Next 16 refuse to build with
 * "This build is using Turbopack, with a `webpack` config and no `turbopack`
 * config".
 *
 * So we check whether it's the shim (no `.resolve`) and, if so, build a real
 * require rooted at the project directory instead (Next always loads config
 * with cwd at the project root).
 */
function getResolver(): NodeRequire {
  const shimmed = typeof require === "function" ? (require as NodeRequire) : undefined;
  if (shimmed && typeof shimmed.resolve === "function") return shimmed;
  return createRequire(path.join(process.cwd(), "next.config.js"));
}

/** Next.js config type (inlined so we don't pull in `next` as a devDependency) */
interface NextConfig {
  productionBrowserSourceMaps?: boolean;
  webpack?: ((config: any, context: any) => any) | null;
  [key: string]: any;
}

interface LocalFeedbackerNextOptions {
  /**
   * Whether to strip sourcesContent (default: true).
   * Set false to leave the original source text in the .map files.
   */
  stripSourceContent?: boolean;
  /**
   * Whether to emit a Next App Router route -> file manifest (default: true)
   */
  emitRouteManifest?: boolean;
  /**
   * Whether to inject source-location data attributes into JSX (default: true)
   *
   * This is what lets a clicked DOM element resolve back to "the file:line it
   * was actually written in" in production. Turning it off leaves only
   * runtime inference (fiber probing), which can only reach the component's
   * definition file (e.g. components/ui/button.tsx).
   */
  injectSourceAttributes?: boolean;
}

class StripSourceContentPlugin {
  apply(compiler: any) {
    compiler.hooks.afterEmit.tapAsync(
      "LocalFeedbackerStripSourceContent",
      (compilation: any, callback: () => void) => {
        const outputPath = compilation.outputOptions?.path;
        if (!outputPath) {
          callback();
          return;
        }

        // Look for .map files under the .next/static directory
        const staticDir = path.dirname(resolveStaticChunksDir(path, outputPath));
        if (!fs.existsSync(staticDir)) {
          callback();
          return;
        }

        const findMaps = (dir: string): string[] => {
          const results: string[] = [];
          try {
            for (const entry of fs.readdirSync(dir, {
              withFileTypes: true,
            })) {
              const full = path.join(dir, entry.name);
              if (entry.isDirectory()) results.push(...findMaps(full));
              else if (entry.name.endsWith(".js.map")) results.push(full);
            }
          } catch {}
          return results;
        };

        let stripped = 0;
        for (const file of findMaps(staticDir)) {
          try {
            const raw = fs.readFileSync(file, "utf-8");
            const map = JSON.parse(raw);
            let changed = false;

            if (map.sourcesContent) {
              delete map.sourcesContent;
              changed = true;
            }

            // Turbopack sections-based source maps
            if (map.sections) {
              for (const section of map.sections) {
                if (section.map?.sourcesContent) {
                  delete section.map.sourcesContent;
                  changed = true;
                }
              }
            }

            if (changed) {
              fs.writeFileSync(file, JSON.stringify(map));
              stripped++;
            }
          } catch {}
        }

        if (stripped > 0) {
          console.log(
            `[local-feedbacker] Stripped sourcesContent from ${stripped} sourcemap files`
          );
        }

        callback();
      }
    );
  }
}

type RouteFileKind = "page" | "layout";

interface RouteManifestEntry {
  route: string;
  segments: string[];
  files: Array<{
    kind: RouteFileKind;
    file: string;
  }>;
}

class RouteManifestPlugin {
  constructor(private readonly projectDir: string) {}

  apply(compiler: any) {
    compiler.hooks.afterEmit.tapAsync(
      "LocalFeedbackerRouteManifest",
      (compilation: any, callback: () => void) => {
        const outputPath = compilation.outputOptions?.path;
        if (!outputPath) {
          callback();
          return;
        }

        const appDir = findAppDirectory(fs, path, this.projectDir);
        if (!appDir) {
          callback();
          return;
        }

        const entries = scanRouteManifestEntries(fs, path, this.projectDir, appDir);
        if (entries.length === 0) {
          callback();
          return;
        }

        const manifestPath = path.join(
          resolveStaticChunksDir(path, outputPath),
          "local-feedbacker-route-manifest.json"
        );

        try {
          fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
          fs.writeFileSync(
            manifestPath,
            JSON.stringify({ version: 1, entries }, null, 2),
            "utf-8"
          );
          console.log(
            `[local-feedbacker] Emitted route manifest with ${entries.length} route entries`
          );
        } catch {}

        callback();
      }
    );
  }
}

/**
 * Resolves the browser-reachable static/chunks directory.
 *
 * In Next's client build, `outputOptions.path` is `<dir>/.next`, so
 * `resolve(outputPath, "../static/chunks")` lands outside `.next`
 * (`<dir>/static/chunks`) — that path never ships, so a runtime fetch for
 * the manifest would 404.
 */
function resolveStaticChunksDir(path: any, outputPath: string): string {
  const normalized = outputPath.replace(/[\\/]+$/, "");
  // Already pointing at .next/static — just append chunks
  if (/[\\/]static$/.test(normalized)) return path.join(normalized, "chunks");
  return path.join(normalized, "static", "chunks");
}

function findAppDirectory(fs: any, path: any, projectDir: string): string | null {
  const candidates = [
    path.join(projectDir, "src", "app"),
    path.join(projectDir, "app"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate;
    }
  }

  return null;
}

function toPosixPath(path: string): string {
  return path.replace(/\\/g, "/");
}

function findRouteFile(fs: any, path: any, dir: string, baseName: RouteFileKind): string | null {
  const extensions = [".tsx", ".ts", ".jsx", ".js"];
  for (const ext of extensions) {
    const file = path.join(dir, `${baseName}${ext}`);
    if (fs.existsSync(file) && fs.statSync(file).isFile()) {
      return file;
    }
  }
  return null;
}

function getUrlSegment(segmentName: string): string | null {
  if (!segmentName) return null;
  if (segmentName.startsWith("(") && segmentName.endsWith(")")) return null;
  return segmentName;
}

function routeFromSegments(segments: string[]): string {
  if (segments.length === 0) return "/";
  return `/${segments.join("/")}`;
}

function scanRouteManifestEntries(
  fs: any,
  path: any,
  projectDir: string,
  appDir: string
): RouteManifestEntry[] {
  const entries: RouteManifestEntry[] = [];

  const walk = (
    currentDir: string,
    routeSegments: string[],
    layoutChain: RouteManifestEntry["files"]
  ) => {
    const currentLayout = findRouteFile(fs, path, currentDir, "layout");
    const nextLayoutChain = currentLayout
      ? [
          ...layoutChain,
          {
            kind: "layout" as const,
            file: toPosixPath(path.relative(projectDir, currentLayout)),
          },
        ]
      : layoutChain;

    const currentPage = findRouteFile(fs, path, currentDir, "page");
    if (currentPage) {
      entries.push({
        route: routeFromSegments(routeSegments),
        segments: [...routeSegments],
        files: [
          {
            kind: "page",
            file: toPosixPath(path.relative(projectDir, currentPage)),
          },
          ...nextLayoutChain,
        ],
      });
    }

    const children = fs
      .readdirSync(currentDir, { withFileTypes: true })
      .filter((entry: any) => entry.isDirectory())
      .sort((a: any, b: any) => a.name.localeCompare(b.name));

    for (const child of children) {
      if (child.name.startsWith("@")) continue;
      const nextSegment = getUrlSegment(child.name);
      walk(
        path.join(currentDir, child.name),
        nextSegment ? [...routeSegments, nextSegment] : routeSegments,
        nextLayoutChain
      );
    }
  };

  walk(appDir, [], []);
  return entries;
}

/**
 * Next.js config wrapper — auto-configures source maps.
 *
 * @example
 * ```ts
 * import { withLocalFeedbacker } from 'local-feedbacker/next'
 * export default withLocalFeedbacker(nextConfig)
 * ```
 */
/** Resolved path to the loader file. Injection is silently skipped if this fails. */
function resolveJsxSourceLoader(): string | null {
  const resolver = getResolver();
  try {
    return resolver.resolve("local-feedbacker/jsx-source-loader");
  } catch {
    try {
      // Building the package itself from inside its own monorepo
      return resolver.resolve("./jsx-source-loader");
    } catch {
      return null;
    }
  }
}

/**
 * Loads the webpack helper module relative to the loader file's location.
 *
 * In the ESM bundle, `require("./webpack")` as a relative dynamic require
 * throws, so we anchor to the already-resolved loader path
 * (dist/jsx-source-loader.js) instead.
 */
function loadWebpackHelpers(loaderPath: string): typeof import("./webpack") {
  return createRequire(loaderPath)("./webpack.js");
}

/**
 * Merges a Turbopack loader rule into the existing config.
 *
 * Turbopack doesn't run webpack plugins, so it can't emit the file-ID
 * manifest here — this path embeds the literal source path instead ("path" mode).
 */
function withTurbopackRule(nextConfig: NextConfig, loaderPath: string): Record<string, any> {
  const existing = (nextConfig as any).turbopack ?? {};
  // Only use `as` when the output extension actually changes. Attaching it
  // to a JS→JS transform makes Turbopack append an extra extension
  // (`page.tsx.tsx`), which breaks module resolution.
  const rule = {
    loaders: [{ loader: loaderPath, options: { mode: "path" } }],
  };

  return {
    ...existing,
    rules: {
      ...(existing.rules ?? {}),
      "*.tsx": rule,
      "*.jsx": rule,
    },
  };
}

export function withLocalFeedbacker(
  nextConfig: NextConfig,
  options: LocalFeedbackerNextOptions = {}
): NextConfig {
  const {
    stripSourceContent = true,
    emitRouteManifest = true,
    injectSourceAttributes = true,
  } = options;

  const loaderPath = injectSourceAttributes ? resolveJsxSourceLoader() : null;

  return {
    ...nextConfig,

    // Enable source map generation
    productionBrowserSourceMaps: true,

    // Next 16's default builder is Turbopack, so a webpack-only path wouldn't
    // inject anything. Keep the turbopack key even when injection is off —
    // a webpack function is returned below regardless, and Next 16 refuses
    // to build without a matching turbopack config.
    turbopack: loaderPath
      ? withTurbopackRule(nextConfig, loaderPath)
      : ((nextConfig as any).turbopack ?? {}),

    webpack(config: any, context: any) {
      // Preserve any existing webpack config
      if (typeof nextConfig.webpack === "function") {
        config = nextConfig.webpack(config, context);
      }

      // Source map / manifest output only applies to the client build
      if (!context.isServer) {
        config.plugins = config.plugins || [];
        if (stripSourceContent) {
          config.plugins.push(new StripSourceContentPlugin());
        }
        if (emitRouteManifest && context.dir) {
          config.plugins.push(new RouteManifestPlugin(context.dir));
        }
        if (loaderPath && context.dir) {
          const { LocalFeedbackerSrcManifestPlugin } = loadWebpackHelpers(loaderPath);
          config.plugins.push(new LocalFeedbackerSrcManifestPlugin(context.dir));
        }
      }

      // The loader must also run for server builds. Server Components render
      // to HTML on the server, so injecting only in the client build would
      // leave the static page's DOM with no attributes at all.
      if (loaderPath && context.dir) {
        const { defaultSrcCacheDir } = loadWebpackHelpers(loaderPath);

        config.module = config.module || {};
        config.module.rules = config.module.rules || [];
        config.module.rules.push({
          test: /\.(tsx|jsx)$/,
          exclude: /node_modules/,
          enforce: "pre",
          use: [
            {
              loader: loaderPath,
              options: {
                mode: "id",
                projectDir: context.dir,
                cacheDir: defaultSrcCacheDir(context.dir),
              },
            },
          ],
        });
      }

      return config;
    },
  };
}
