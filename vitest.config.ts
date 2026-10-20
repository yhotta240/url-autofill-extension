import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environmentOptions: {
      jsdom: {
        url: "https://example.com/form?q=1",
        pretendToBeVisual: true,
      },
    },
  },
});
