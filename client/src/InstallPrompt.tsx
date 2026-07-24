import { useCallback, useEffect, useState } from "react";
import { detectInstallMode, iosBrowser, isIos, isStandalone, isTelegram, type InstallMode } from "./pwaInstall";

// Инструкция «добавить на экран» под КОНКРЕТНЫЙ браузер iOS. Safari — «···» → «На экран
// Домой» (в новом Safari «Поделиться» спрятан под «···»). Chrome/Edge — своё меню. Firefox
// как приложение не умеет — зовём в Safari. Непонятный вебвью (Telegram и пр.) — общий совет.
function iosHint(): { title: string; text: string } {
  switch (iosBrowser()) {
    case "safari":
      return {
        title: "Добавить на экран 📲",
        text: "Нажми «···» внизу справа, затем «На экран „Домой“» (в старом Safari — сразу «Поделиться» ⬆️ → «На экран „Домой“»).",
      };
    case "chrome":
      return {
        title: "Добавить на экран 📲",
        text: "В Chrome нажми «···» внизу справа (или «Поделиться»), затем «На экран „Домой“».",
      };
    case "edge":
      return { title: "Добавить на экран 📲", text: "В Edge нажми «···» внизу, затем «На экран „Домой“»." };
    case "opera":
    case "yandex":
      return {
        title: "Добавить на экран 📲",
        text: "Открой меню браузера («···»/«≡») и выбери «На экран „Домой“». Надёжнее — сделать это в Safari.",
      };
    case "firefox":
      return {
        title: "Открой в Safari 📲",
        text: "Firefox на iPhone не добавляет игру как приложение — открой эту страницу в Safari и там «Поделиться» → «На экран „Домой“».",
      };
    default:
      return {
        title: "Открой в браузере 📲",
        text: "Ты во встроенном браузере (он сворачивается). Открой страницу в Safari или Chrome и добавь на домашний экран.",
      };
  }
}

// Подсказка «добавить на домашний экран», по платформе (см. pwaInstall.ts). Показывается вне
// комнаты, один раз: закрыли — запомнили в localStorage и больше не пристаём. Главная цель —
// увести из браузера Telegram, который сворачивается жестом «тянуть вниз».

const DISMISS_KEY = "crusade-deck:install-dismissed";

// Событие Chrome/Android, которого нет в стандартных типах.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function wasDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(() => wasDismissed());
  // Пересчитываем при монтировании: standalone/платформа не меняются в рамках сессии.
  const [standalone] = useState(() => isStandalone());

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault(); // не даём браузеру показать свою мини-плашку — покажем свою кнопку
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    // Установилась — прячемся навсегда.
    const onInstalled = () => dismiss();
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dismiss = useCallback(() => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // приватный режим — просто не запомнится, не критично
    }
  }, []);

  const mode: InstallMode = detectInstallMode({
    standalone,
    ios: isIos(),
    telegram: isTelegram(),
    canPrompt: !!deferred,
  });

  if (dismissed || mode === "installed" || mode === "none") return null;

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice.catch(() => undefined);
    setDeferred(null);
    dismiss();
  };

  return (
    <div className="install-prompt">
      <button className="install-close" aria-label="Закрыть" onClick={dismiss}>
        ✕
      </button>
      {mode === "telegram" && (
        <>
          <p className="install-title">Открой в браузере 📲</p>
          <p className="install-text">
            Ты в браузере Telegram — он сворачивается, когда тянешь карту вниз. Нажми 🧭 внизу (или
            «···» вверху → «Открыть в Safari/Chrome»). Там сможешь и добавить игру на домашний экран.
          </p>
        </>
      )}
      {mode === "android" && (
        <>
          <p className="install-title">Добавить на экран 📲</p>
          <p className="install-text">Установи игру как приложение — откроется на весь экран, без панелей браузера.</p>
          <button className="pixel-btn pixel-btn-full" onClick={install}>
            Установить
          </button>
        </>
      )}
      {mode === "ios" &&
        (() => {
          const hint = iosHint();
          return (
            <>
              <p className="install-title">{hint.title}</p>
              <p className="install-text">{hint.text}</p>
            </>
          );
        })()}
    </div>
  );
}
