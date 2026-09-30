/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { alphaTab } from "@coderline/alphatab-vite";

export default defineConfig({
  plugins: [react(), alphaTab()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
  },
});
