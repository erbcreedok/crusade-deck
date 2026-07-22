import { useCallback, useEffect, useState } from "react";
import { Room } from "colyseus.js";
import { Account } from "./account";
import {
  ANIMATION_SPEEDS,
  type AnimationLevel,
  type AnimationSettings,
  type AnimationSpeed,
} from "./game/anim/animationSettings";

const LEVEL_OPTIONS: { value: AnimationLevel; label: string }[] = [
  { value: "full", label: "Полная" },
  { value: "moderate", label: "Умеренная" },
];

type MenuView = "main" | "profile";

export function AppMenu({
  account,
  onRename,
  onRegenerateCode,
  animation,
  onSetLevel,
  onSetSpeed,
  room,
  onLeaveRoom,
}: {
  account: Account;
  onRename: (name: string) => void;
  onRegenerateCode: () => void;
  animation: AnimationSettings;
  onSetLevel: (level: AnimationLevel) => void;
  onSetSpeed: (speed: AnimationSpeed) => void;
  room: Room | null;
  onLeaveRoom: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<MenuView>("main");
  const [name, setName] = useState(account.name);
  const [copied, setCopied] = useState(false);
  const [isPublic, setIsPublic] = useState(false);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => setName(account.name), [account.name]);

  // Каждое закрытие сбрасывает навигацию — следующее открытие начинается с главного меню.
  useEffect(() => {
    if (!open) setView("main");
  }, [open]);

  useEffect(() => {
    if (!room) return;
    const sync = () => setIsPublic(!!room.state.isPublic);
    room.onStateChange(sync);
    sync();
  }, [room]);

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(account.recoveryHash);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // буфер обмена недоступен — код всё равно виден на экране
    }
  }

  function leaveRoom() {
    room?.leave();
    onLeaveRoom();
    close();
  }

  return (
    <>
      <button className="menu-fab" onClick={() => setOpen(true)}>
        ☰
      </button>

      {open && (
        // Подложка перехватывает нажатие и остаётся смонтированной до click —
        // иначе меню закрылось бы по mousedown, а клик провалился бы на кнопку под ним.
        <div className="modal-overlay" onClick={close}>
          <div className="pixel-panel" onClick={(e) => e.stopPropagation()}>
            <div className="pixel-panel-header">
              {view === "profile" ? (
                <button className="pixel-icon-btn" aria-label="Назад" onClick={() => setView("main")}>
                  ←
                </button>
              ) : (
                <span className="pixel-icon-btn pixel-icon-spacer" aria-hidden />
              )}
              <h2 className="pixel-title">{view === "profile" ? "👤 Профиль" : "♣ Меню ♦"}</h2>
              <button className="pixel-icon-btn" aria-label="Закрыть" onClick={close}>
                ✕
              </button>
            </div>

            {view === "main" ? renderMain() : renderProfile()}
          </div>
        </div>
      )}
    </>
  );

  function renderMain() {
    return (
      <>
        <button className="menu-toggle-row" onClick={() => setView("profile")}>
          👤 Профиль
        </button>

        <hr className="pixel-divider" />

        <label className="pixel-label">Анимации</label>
        <div className="seg-row">
          {LEVEL_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              className={`seg-btn${animation.level === opt.value ? " seg-btn-active" : ""}`}
              onClick={() => onSetLevel(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Скорость только для полной — на умеренной оборот всегда в одном темпе. */}
        {animation.level === "full" && (
          <>
            <label className="pixel-label">Скорость</label>
            <div className="seg-row">
              {ANIMATION_SPEEDS.map((sp) => (
                <button
                  key={sp}
                  className={`seg-btn${animation.speed === sp ? " seg-btn-active" : ""}`}
                  onClick={() => onSetSpeed(sp)}
                >
                  {sp}x
                </button>
              ))}
            </div>
          </>
        )}

        {room && (
          <>
            <button className="menu-toggle-row" onClick={() => room.send("toggle_public")}>
              {isPublic ? "🌐 Комната: паблик" : "🔒 Комната: приват"}
            </button>

            <hr className="pixel-divider" />

            <button className="pixel-btn pixel-btn-danger pixel-btn-full" onClick={leaveRoom}>
              Покинуть комнату
            </button>
          </>
        )}
      </>
    );
  }

  function renderProfile() {
    return (
      <>
        <label className="pixel-label">Имя</label>
        <input
          className="pixel-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && onRename(name)}
          maxLength={24}
        />

        <label className="pixel-label">Код восстановления</label>
        <p className="recovery-code">{account.recoveryHash}</p>
        <p className="pixel-hint">
          Введи этот код на другом устройстве, чтобы зайти под тем же именем. Никому не показывай —
          тот, у кого есть код, может действовать от твоего имени.
        </p>
        <div className="pixel-btn-row">
          <button className="pixel-btn" onClick={copyCode}>
            {copied ? "Скопировано!" : "Скопировать"}
          </button>
          <button className="pixel-btn pixel-btn-secondary" onClick={onRegenerateCode}>
            Обновить код
          </button>
        </div>
      </>
    );
  }
}
