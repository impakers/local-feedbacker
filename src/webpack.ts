// =============================================================================
// local-feedbacker/webpack — Webpack Plugins
// =============================================================================
//
// For plain webpack projects (CRA, custom webpack). Strips sourcesContent
// from emitted .map files after the build, and collects the jsx-source-loader
// sidecars into a manifest.
//
// Usage (webpack.config.js):
//   const { LocalFeedbackerWebpackPlugin } = require('local-feedbacker/webpack')
//   module.exports = {
//     devtool: 'source-map',
//     plugins: [new LocalFeedbackerWebpackPlugin()],
//   }
//
// Usage (CRA with craco/react-app-rewired):
//   const { LocalFeedbackerWebpackPlugin } = require('local-feedbacker/webpack')
//   module.exports = {
//     webpack: {
//       plugins: { add: [new LocalFeedbackerWebpackPlugin()] },
//     },
//   }
//

import * as fs from "fs";
import * as path from "path";

/** Default location to accumulate jsx-source-loader sidecars */
export function defaultSrcCacheDir(projectDir: string): string {
  return path.join(projectDir, "node_modules", ".cache", "local-feedbacker-src");
}

/**
 * Emits a manifest mapping the file IDs jsx-source-loader embedded ↔
 * project-relative paths.
 *
 * Loaders run scattered across workers, so results can't be accumulated
 * in-memory. Each loader drops a sidecar file, and this plugin reads them
 * all at the end of the build and merges them.
 */
export class LocalFeedbackerSrcManifestPlugin {
  constructor(
    private readonly projectDir: string,
    private readonly cacheDir?: string
  ) {}

  apply(compiler: any) {
    compiler.hooks.afterEmit.tapAsync(
      "LocalFeedbackerSrcManifest",
      (compilation: any, callback: () => void) => {
        const outputPath = compilation.outputOptions?.path;
        const cacheDir = this.cacheDir || defaultSrcCacheDir(this.projectDir);
        if (!outputPath || !fs.existsSync(cacheDir)) {
          callback();
          return;
        }

        const files: Record<string, string> = {};
        try {
          for (const entry of fs.readdirSync(cacheDir)) {
            if (!entry.endsWith(".txt")) continue;
            const relativePath = fs.readFileSync(path.join(cacheDir, entry), "utf-8").trim();
            if (!relativePath) continue;
            // Sidecars accumulate across builds — drop entries for files that no longer exist
            if (!fs.existsSync(path.resolve(this.projectDir, relativePath))) {
              try {
                fs.unlinkSync(path.join(cacheDir, entry));
              } catch {}
              continue;
            }
            files[entry.slice(0, -4)] = relativePath;
          }
        } catch {}

        const count = Object.keys(files).length;
        if (count === 0) {
          callback();
          return;
        }

        // Next's client build outputPath is `<dir>/.next`, so going up to
        // `../static` would land outside `.next` and be excluded from deploys.
        const normalized = outputPath.replace(/[\\/]+$/, "");
        const chunksDir = /[\\/]static$/.test(normalized)
          ? path.join(normalized, "chunks")
          : path.join(normalized, "static", "chunks");
        const manifestPath = path.join(chunksDir, "impakers-debug-src-manifest.json");
        try {
          fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
          fs.writeFileSync(manifestPath, JSON.stringify({ version: 1, files }), "utf-8");
          console.log(`[local-feedbacker] Emitted source manifest with ${count} files`);
        } catch {}

        callback();
      }
    );
  }
}

function findMaps(dir: string): string[] {
  const results: string[] = [];
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) results.push(...findMaps(full));
      else if (entry.name.endsWith(".js.map")) results.push(full);
    }
  } catch {}
  return results;
}

/**
 * Strips sourcesContent from every .js.map under `outputDir`, recursively.
 *
 * `productionBrowserSourceMaps: true` ships .map files as public static
 * assets — without this, they carry the full original source text and
 * anyone can fetch it straight off the live site. This keeps the file/line
 * mappings (which is all local-feedbacker's runtime resolution needs) while
 * dropping the embedded source text.
 *
 * Exposed standalone (not just as a webpack plugin) because Next 16's
 * default bundler is Turbopack, which never calls the webpack() config
 * function at all — so this also needs to be runnable as a plain postbuild
 * step. See bin/strip-source-maps.
 *
 * @returns Number of files that were actually modified.
 */
export function stripSourceContentUnder(outputDir: string): number {
  if (!outputDir || !fs.existsSync(outputDir)) return 0;

  let stripped = 0;
  for (const file of findMaps(outputDir)) {
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

  return stripped;
}

interface LocalFeedbackerWebpackPluginOptions {
  /** Directory to search for .map files (default: the build's output directory) */
  outputDir?: string;
}

/**
 * Only fires for an actual webpack build. Next 16's default bundler is
 * Turbopack, which never invokes the webpack() config function — for that
 * path, run the `local-feedbacker-strip-maps` postbuild script instead (see
 * bin/strip-source-maps and withLocalFeedbacker's README).
 */
export class LocalFeedbackerWebpackPlugin {
  private outputDir?: string;

  constructor(options: LocalFeedbackerWebpackPluginOptions = {}) {
    this.outputDir = options.outputDir;
  }

  apply(compiler: any) {
    compiler.hooks.afterEmit.tapAsync(
      "LocalFeedbackerStripSourceContent",
      (compilation: any, callback: () => void) => {
        const outputPath = this.outputDir || compilation.outputOptions?.path || "";
        const stripped = stripSourceContentUnder(outputPath);

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
