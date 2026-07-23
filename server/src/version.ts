import { createRequire } from "node:module";
import { execSync } from "node:child_process";

// Версия сервера — та же пара «объявленная версия + номер сборки», что и у клиента
// (client/src/version.ts). Нужна ровно для одного: увидеть, что на проде клиент и сервер
// собраны с одного коммита. Разъехавшаяся пара — первое, что стоит проверить, когда «у
// меня работает, а у него нет».
//
// Версия объявлена в package.json и продублирована в клиентском: у пакетов РАЗНЫЕ
// контексты сборки (docker build ./client и ./server), и общий файл в корне репозитория
// не виден ни одному из них. Совпадение копий стережёт тест client/src/version.test.ts.

export interface ServerBuildInfo {
  version: string;
  /** Номер сборки (число коммитов) или "dev". */
  build: string;
  commit: string;
}

function pkgVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    // Из dist/ путь до package.json на уровень выше, из src/ — на два. Пробуем оба:
    // ошибиться тут значит показать "0.0.0" на живом сервере.
    for (const path of ["../package.json", "../../package.json"]) {
      try {
        const pkg = require(path) as { version?: string };
        if (pkg.version) return pkg.version;
      } catch {
        /* пробуем следующий */
      }
    }
  } catch {
    /* ниже вернём заглушку */
  }
  return "0.0.0";
}

/**
 * В образе .git нет — там значения приходят переменными окружения (их проставляет
 * Dockerfile из build-аргументов). Локально спрашиваем git напрямую, чтобы в разработке
 * подпись тоже была настоящей.
 */
function fromGit(command: string): string {
  try {
    return execSync(command, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim() || "dev";
  } catch {
    return "dev";
  }
}

export const BUILD_INFO: ServerBuildInfo = {
  version: pkgVersion(),
  build: process.env.APP_BUILD || fromGit("git rev-list --count HEAD"),
  commit: process.env.APP_COMMIT || fromGit("git rev-parse --short HEAD"),
};

/** Подпись одной строкой: «v0.2.0+128». Тот же формат, что показывает клиент. */
export function formatVersion(info: ServerBuildInfo = BUILD_INFO): string {
  return `v${info.version}+${info.build}`;
}
