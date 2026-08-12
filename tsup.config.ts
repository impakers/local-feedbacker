import { defineConfig } from "tsup";
import * as sass from "sass";
import postcss from "postcss";
import postcssModules from "postcss-modules";
import * as path from "path";
import * as fs from "fs";
import type { Plugin } from "esbuild";

const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, "package.json"), "utf-8"));
const PKG_VERSION = JSON.stringify(pkg.version);

// Custom SCSS CSS Modules plugin with SSR-safe style injection
function scssModulesPlugin(): Plugin {
  return {
    name: "scss-modules",
    setup(build) {
      build.onLoad({ filter: /\.scss$/ }, async (args) => {
        const isModule = args.path.includes(".module.");
        const parentDir = path.basename(path.dirname(args.path));
        const baseName = path.basename(args.path, isModule ? ".module.scss" : ".scss");
        const styleId = `${parentDir}-${baseName}`;

        const result = sass.compile(args.path);
        let css = result.css;

        if (isModule) {
          let classNames: Record<string, string> = {};
          const postcssResult = await postcss([
            postcssModules({
              getJSON(_cssFileName: string, json: Record<string, string>) {
                classNames = json;
              },
              generateScopedName: "[name]__[local]___[hash:base64:5]",
            }),
          ]).process(css, { from: args.path });

          css = postcssResult.css;

          const contents = `
const css = ${JSON.stringify(css)};
const classNames = ${JSON.stringify(classNames)};

if (typeof document !== 'undefined') {
  let style = document.getElementById('impakers-debug-styles-${styleId}');
  if (!style) {
    style = document.createElement('style');
    style.id = 'impakers-debug-styles-${styleId}';
    document.head.appendChild(style);
  }
  style.textContent = css;
}

export default classNames;
`;
          return { contents, loader: "js" };
        } else {
          const contents = `
const css = ${JSON.stringify(css)};
if (typeof document !== 'undefined') {
  let style = document.getElementById('impakers-debug-styles-${styleId}');
  if (!style) {
    style = document.createElement('style');
    style.id = 'impakers-debug-styles-${styleId}';
    document.head.appendChild(style);
  }
  style.textContent = css;
}
export default {};
`;
          return { contents, loader: "js" };
        }
      });
    },
  };
}

export default defineConfig([
  { entry: ["src/index.ts"], format: ["cjs", "esm"], dts: true, clean: true, external: ["react", "react-dom"] },
  {
    entry: ["src/react.tsx"],
    format: ["cjs", "esm"],
    dts: true,
    clean: false,
    external: ["react", "react-dom"],
    esbuildPlugins: [scssModulesPlugin()],
    define: { "process.env.PKG_VERSION": PKG_VERSION },
    loader: {
      ".css": "text",
    },
    banner: { js: '"use client";' },
  },
  {
    // Build-time plugins (Next.js/webpack config wrappers, the JSX-source
    // AST loader). These run in the consumer's Node build process, not the
    // browser, so they need Node's platform/builtins rather than being
    // bundled for the client.
    entry: ["src/next.ts", "src/webpack.ts", "src/jsx-source-loader.ts"],
    format: ["cjs", "esm"],
    dts: true,
    clean: false,
    platform: "node",
    external: ["next", "webpack"],
  },
  {
    // `local-feedbacker-strip-maps` postbuild CLI — see bin-strip-source-maps.ts
    entry: ["src/bin-strip-source-maps.ts"],
    format: ["cjs"],
    dts: false,
    clean: false,
    platform: "node",
    banner: { js: "#!/usr/bin/env node" },
  },
]);
