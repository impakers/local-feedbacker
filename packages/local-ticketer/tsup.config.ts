import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/client.ts", "src/server.ts", "src/adapters.ts", "src/cli.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  // The CLI is the only entry that must be directly runnable.
  banner: ({ format }) => (format === "cjs" ? { js: "" } : {}),
});
