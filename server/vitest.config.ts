import { defineConfig } from "vitest/config";

// Тесты гоняем ТОЛЬКО из src. Без этого vitest подхватывал ещё и dist/*.test.js —
// скомпилированные копии, которые остаются после `npm run build`. Две копии
// CardRoom.test запускались параллельно, обе поднимали тестовый сервер на одном порту,
// и прогон падал с EADDRINUSE :2568 — при том что сам код был в порядке.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
