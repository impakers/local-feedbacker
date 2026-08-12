// =============================================================================
// local-feedbacker-strip-maps — postbuild step for Turbopack builds
// =============================================================================
//
// withLocalFeedbacker's sourcesContent stripping runs as a webpack plugin,
// but Next 16's default bundler is Turbopack, which never calls the
// webpack() config function. Run this after `next build` so the .map files
// productionBrowserSourceMaps ships don't carry your original source text:
//
//   "build": "next build && local-feedbacker-strip-maps"
//
// Optionally pass the project directory (defaults to cwd):
//
//   local-feedbacker-strip-maps ./apps/web
// =============================================================================

import * as path from "node:path";
import { stripSourceContentUnder } from "./webpack";

const projectDir = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
const nextDir = path.join(projectDir, ".next");
const stripped = stripSourceContentUnder(nextDir);

console.log(
  `[local-feedbacker] Stripped sourcesContent from ${stripped} sourcemap file(s) under ${nextDir}`
);
