import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    hookTimeout: 30_000,
    include: ["server/test/**/*.{test,integration}.ts"],
    testTimeout: 30_000,
  },
});
