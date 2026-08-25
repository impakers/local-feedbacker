import { defineConfig } from "vitest/config";

export default defineConfig({
  // Scoped to this package's own source: each workspace runs its own suite in
  // the environment it needs, and the widget's is a DOM.
  test: { environment: "jsdom", include: ["src/**/*.test.ts?(x)"] },
});
