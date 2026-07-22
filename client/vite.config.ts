import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const pkg = createRequire(import.meta.url)("./package.json") as { version?: string };

// Короткий хеш текущего коммита. В сборочном контейнере git может отсутствовать —
// тогда просто "dev": подпись версии не должна ронять сборку (см. src/version.ts).
function gitHash(): string {
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "dev";
  }
}

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, host: true },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version ?? "0.0.0"),
    __APP_BUILD__: JSON.stringify(gitHash()),
    __APP_BUILT_AT__: JSON.stringify(new Date().toISOString()),
  },
});
