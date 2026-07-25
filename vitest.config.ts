import { defineConfig } from "vitest/config";
import path from "node:path";

// Alias "@/*" -> "src/*", igual ao paths do tsconfig.json — sem isso os
// testes não resolvem os mesmos imports "@/lib/..." usados no código.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
