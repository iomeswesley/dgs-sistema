import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  root: "web",
  plugins: [react(), tailwindcss()],
  build: {
    // Fora de web/ pra não misturar com o fonte; o Express serve daqui em
    // produção (ver WEB_DIST em src/app.ts).
    outDir: path.resolve(__dirname, "dist-web"),
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    port: 5173,
    // Em dev o React roda no 5173 e a API no 3000; o proxy faz o cookie de
    // sessão funcionar como se fosse a mesma origem.
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
});
