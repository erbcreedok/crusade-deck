// Версия сборки: что именно сейчас открыто у игрока. Нужна, чтобы по скриншоту было
// видно, залился ли деплой, — на телефоне другого способа это понять нет.
//
// Значения подставляет vite через define (см. vite.config.ts). В тестах и в dev-режиме
// define не отрабатывает, поэтому у каждого поля есть свой запасной вариант: подпись
// должна что-то показывать всегда, а не пропадать.

export interface BuildInfo {
  version: string;
  /** Короткий хеш коммита или "dev". */
  build: string;
  /** ISO-время сборки; пустое — собрано локально. */
  builtAt: string;
}

declare const __APP_VERSION__: string;
declare const __APP_BUILD__: string;
declare const __APP_BUILT_AT__: string;

function defined(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

export const BUILD_INFO: BuildInfo = {
  version: defined(typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : undefined, "0.0.0"),
  build: defined(typeof __APP_BUILD__ !== "undefined" ? __APP_BUILD__ : undefined, "dev"),
  builtAt: defined(typeof __APP_BUILT_AT__ !== "undefined" ? __APP_BUILT_AT__ : undefined, ""),
};

/** Короткая подпись для угла экрана: «v0.2.0». */
export function formatVersion(info: BuildInfo = BUILD_INFO): string {
  return `v${info.version}`;
}

/** Полная подпись: версия, коммит и время сборки до минут (секунды только шумят). */
export function formatBuild(info: BuildInfo = BUILD_INFO): string {
  const parts = [formatVersion(info), info.build];
  const at = formatBuiltAt(info.builtAt);
  if (at) parts.push(at);
  return parts.join(" · ");
}

/** "2026-07-23T10:05:09Z" → "2026-07-23 10:05". Пустое время — пустая строка. */
function formatBuiltAt(builtAt: string): string {
  if (!builtAt) return "";
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(builtAt);
  return m ? `${m[1]} ${m[2]}` : builtAt;
}
