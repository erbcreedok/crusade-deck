import { useEffect, useState } from "react";
import { detectInstallMode, iosBrowser, isIos, isStandalone, isTelegram } from "./pwaInstall";

// Модалка «добавить на домашний экран» — открывается КНОПКОЙ (на экране входа и в меню), а не
// сама: закрыл и открыл снова сколько угодно. Содержимое — под платформу/браузер (см.
// pwaInstall.ts). На iOS прямой установки из кода нет (Apple); максимум — в Safari/Chrome самим
// открыть системную шторку «Поделиться» (navigator.share), «На экран „Домой“» юзер выберет в ней.

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function InstallPrompt({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);

  // Слушаем всегда (даже когда модалка закрыта), чтобы поймать Android-событие заранее.
  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => onClose();
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [onClose]);

  if (!open) return null;

  const mode = detectInstallMode({
    standalone: isStandalone(),
    ios: isIos(),
    telegram: isTelegram(),
    canPrompt: !!deferred,
  });

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice.catch(() => undefined);
    setDeferred(null);
    onClose();
  };

  // Ссылка ВСЕГДА на чистый main — не на комнату и не на юзера.
  const shareToHome = async () => {
    try {
      await navigator.share({ url: `${window.location.origin}/` });
    } catch {
      // отменил или недоступно — молча
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="pixel-panel" onClick={(e) => e.stopPropagation()}>
        <div className="pixel-panel-header">
          <span className="pixel-icon-btn pixel-icon-spacer" aria-hidden />
          <h2 className="pixel-title">📲 На экран</h2>
          <button className="pixel-icon-btn" aria-label="Закрыть" onClick={onClose}>
            ✕
          </button>
        </div>
        {renderBody()}
      </div>
    </div>
  );

  function renderBody() {
    if (mode === "installed") return <p className="install-text">Игра уже добавлена на домашний экран ✓</p>;
    if (mode === "telegram")
      return (
        <p className="install-text">
          Ты в браузере Telegram — он сворачивается, когда тянешь карту вниз. Нажми 🧭 внизу (или «···»
          вверху → «Открыть в Safari/Chrome»). Там и добавишь игру на домашний экран.
        </p>
      );
    if (mode === "android")
      return (
        <>
          <p className="install-text">Установи игру как приложение — откроется на весь экран, без панелей браузера.</p>
          <button className="pixel-btn pixel-btn-full" onClick={install}>
            Установить
          </button>
        </>
      );
    if (mode === "ios") return renderIos();
    // none — десктоп или Android до срабатывания события.
    return (
      <p className="install-text">
        Открой меню браузера («⋮»/«···») и выбери «Установить приложение» или «На экран „Домой“».
      </p>
    );
  }

  function renderIos() {
    const browser = iosBrowser();

    // Safari/Chrome: встроенная кнопка «Поделиться» (navigator.share) — сами открываем шторку,
    // юзер выбирает «На экран „Домой“». Кнопку показываем ВСЕГДА; ниже ручной фолбэк на случай,
    // если API недоступен (старый iOS или локалка по HTTP — navigator.share есть только на HTTPS).
    if (browser === "safari" || browser === "chrome") {
      return (
        <>
          <p className="install-text">Открой «Поделиться» и выбери в меню «На экран „Домой“».</p>
          <button className="pixel-btn pixel-btn-full" onClick={shareToHome}>
            📤 Поделиться
          </button>
          <p className="pixel-hint">
            {browser === "chrome"
              ? "Не сработало? «Поделиться» ⬆️ вверху у адреса → «На экран „Домой“»."
              : "Не сработало? «···» внизу справа → «На экран „Домой“»."}
          </p>
        </>
      );
    }
    // Прочие браузеры и встроенные вебвью — приоритет: увести в Safari.
    return (
      <p className="install-text">
        Открой эту страницу в Safari (кнопка «Safari»/«Открыть в Safari» — вверху или в «···»), затем
        «Поделиться» ⬆️ → «На экран „Домой“».
      </p>
    );
  }
}
