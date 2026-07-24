// Что предложить игроку для «добавить на домашний экран» — зависит от платформы, и это
// решается ЧИСТО по окружению. Компонент/хук лишь собирают окружение и рисуют по режиму.
//
// Зачем вообще: если игру открыли из браузера Telegram, он сворачивается жестом «тянуть вниз»
// (а карту тянут вниз постоянно). PWA на домашнем экране или переезд в Safari/Chrome это лечат.

export type InstallMode =
  // уже standalone (установлена) — ничего не показываем
  | "installed"
  // браузер Telegram: установить нельзя, зовём открыть в Safari/Chrome (корень проблемы)
  | "telegram"
  // Android/Chrome: пойман beforeinstallprompt — покажем кнопку «Установить»
  | "android"
  // iOS Safari: программной установки нет — покажем инструкцию «Поделиться → На экран Домой»
  | "ios"
  // предлагать нечего (десктоп без промпта и т.п.)
  | "none";

export interface InstallEnv {
  /** Уже запущены как установленное приложение (display-mode: standalone). */
  standalone: boolean;
  /** iOS Safari (по userAgent). */
  ios: boolean;
  /** Встроенный браузер Telegram. */
  telegram: boolean;
  /** Пойман beforeinstallprompt — можно показать нативную установку. */
  canPrompt: boolean;
}

/**
 * ЧИСТО: режим подсказки по окружению. Приоритет: установлено → Telegram (тупик, зовём в
 * настоящий браузер) → нативный промпт → iOS-инструкция → ничего. Telegram выше нативного и
 * iOS: даже если там что-то и «сработает», это установка/добавление ВНУТРЬ вебвью Telegram,
 * которое всё так же сворачивается.
 */
export function detectInstallMode(env: InstallEnv): InstallMode {
  if (env.standalone) return "installed";
  if (env.telegram) return "telegram";
  if (env.canPrompt) return "android";
  if (env.ios) return "ios";
  return "none";
}

export function isStandalone(): boolean {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    // iOS Safari держит признак standalone тут, а не в matchMedia.
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

export function isIos(ua: string = navigator.userAgent): boolean {
  return /iphone|ipad|ipod/i.test(ua);
}

export function isTelegram(ua: string = navigator.userAgent): boolean {
  // Вебвью Telegram выставляет мост в window; на части платформ его видно и в userAgent.
  const hasBridge = typeof window !== "undefined" && (window as unknown as { TelegramWebviewProxy?: unknown }).TelegramWebviewProxy !== undefined;
  return /telegram/i.test(ua) || hasBridge;
}
