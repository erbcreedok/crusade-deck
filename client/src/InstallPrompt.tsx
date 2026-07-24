import { useCallback, useEffect, useState } from "react";
import { detectInstallMode, iosBrowser, isIos, isStandalone, isTelegram, type InstallMode } from "./pwaInstall";

// Подсказка «добавить на домашний экран», по платформе (см. pwaInstall.ts). Показывается вне
// комнаты, один раз: закрыли — запомнили в localStorage и больше не пристаём. Главная цель —
// увести из браузера, который сворачивается жестом «тянуть вниз» (браузер Telegram и пр.).
//
// iOS: прямой установки/вызова «На экран „Домой“» из кода нет (ограничение Apple). Максимум —
// в Safari/Chrome самим открыть системную шторку «Поделиться» (navigator.share), а «На экран
// „Домой“» юзер выберет в ней сам. В прочих браузерах и встроенных вебвью уводим в Safari.

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

  const dismiss = useCallback(() => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // приватный режим — просто не запомнится, не критично
    }
  }, []);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault(); // не даём браузеру показать свою мини-плашку — покажем свою кнопку
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    const onInstalled = () => dismiss(); // установилась — прячемся навсегда
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [dismiss]);

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

  // Ссылка ВСЕГДА на чистый main — не на комнату и не на юзера: домашняя иконка ведёт на вход.
  const shareToHome = async () => {
    try {
      await navigator.share({ url: `${window.location.origin}/` });
    } catch {
      // юзер отменил или шторка недоступна — молча
    }
  };

  function renderIos() {
    const browser = iosBrowser();
    const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

    // Safari/Chrome: сами открываем «Поделиться», юзер выбирает «На экран „Домой“».
    if ((browser === "safari" || browser === "chrome") && canShare) {
      return (
        <>
          <p className="install-title">Добавить на экран 📲</p>
          <button className="pixel-btn pixel-btn-full" onClick={shareToHome}>
            👇 Нажми сюда
          </button>
          <p className="install-text">…и выбери в меню «На экран „Домой“».</p>
        </>
      );
    }
    // Тот же Safari/Chrome, но без navigator.share (старый iOS) — ручная инструкция.
    if (browser === "safari" || browser === "chrome") {
      return (
        <>
          <p className="install-title">Добавить на экран 📲</p>
          <p className="install-text">
            {browser === "chrome"
              ? "Нажми «Поделиться» ⬆️ вверху у адреса, затем «На экран „Домой“»."
              : "Нажми «···» внизу справа (или «Поделиться» ⬆️), затем «На экран „Домой“»."}
          </p>
        </>
      );
    }
    // Остальные браузеры и встроенные вебвью — приоритет: увести в Safari (кнопка есть почти
    // везде — вверху или в «···»/«≡»).
    return (
      <>
        <p className="install-title">Открой в Safari 📲</p>
        <p className="install-text">
          Нажми «Safari» / «Открыть в Safari» в этом браузере (обычно вверху или в «···»). В Safari —
          «Поделиться» ⬆️ → «На экран „Домой“».
        </p>
      </>
    );
  }

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
      {mode === "ios" && renderIos()}
    </div>
  );
}
