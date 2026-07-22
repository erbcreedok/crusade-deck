// Адреса сервера выводятся из текущего origin, а не зашиваются в сборку.
// Так одна и та же сборка работает и локально (vite proxy), и в проде за Caddy,
// и переживает смену домена без пересборки клиента.
//
// Env-переменные остаются как ручной override — например, чтобы с телефона
// в локальной сети постучаться на сервер по IP машины разработчика.

// Индексная сигнатура — чтобы сюда без приведения типов заходил `import.meta.env`
// (ImportMetaEnv), а в тестах — обычный объектный литерал.
interface Env {
  readonly [key: string]: unknown;
}

interface Loc {
  protocol: string;
  host: string;
}

function stripTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

/** Endpoint для colyseus.js: wss:// под HTTPS, ws:// под HTTP, хост и порт — текущие. */
export function resolveWsUrl(env: Env, loc: Loc): string {
  const override = env.VITE_SERVER_URL;
  if (typeof override === "string" && override) return stripTrailingSlash(override);
  const scheme = loc.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${loc.host}`;
}

/**
 * Префикс для HTTP-запросов к серверу. Пустая строка — намеренно: `fetch("" + "/accounts")`
 * уходит на текущий origin, что и нужно, когда Caddy проксирует API рядом со статикой.
 */
export function resolveHttpUrl(env: Env): string {
  const override = env.VITE_HTTP_URL;
  if (typeof override === "string" && override) return stripTrailingSlash(override);
  return "";
}
