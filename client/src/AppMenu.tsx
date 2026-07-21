import { useEffect, useState } from "react";
import { Room } from "colyseus.js";
import { Account } from "./account";

export function AppMenu({
  account,
  onRename,
  onRegenerateCode,
  motionEnabled,
  onToggleMotion,
  room,
  onLeaveRoom,
}: {
  account: Account;
  onRename: (name: string) => void;
  onRegenerateCode: () => void;
  motionEnabled: boolean;
  onToggleMotion: () => void;
  room: Room | null;
  onLeaveRoom: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(account.name);
  const [copied, setCopied] = useState(false);
  const [isPublic, setIsPublic] = useState(false);

  useEffect(() => setName(account.name), [account.name]);

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
    setOpen(false);
  }

  return (
    <>
      <button className="menu-fab" onClick={() => setOpen(true)}>
        ☰
      </button>

      {open && (
        <div className="modal-overlay" onClick={() => setOpen(false)}>
          <div className="pixel-panel" onClick={(e) => e.stopPropagation()}>
            <h2 className="pixel-title">♣ Меню ♦</h2>

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
              Введи этот код на другом устройстве, чтобы зайти под тем же именем.
              Никому не показывай — тот, у кого есть код, может действовать от твоего имени.
            </p>
            <div className="pixel-btn-row">
              <button className="pixel-btn" onClick={copyCode}>
                {copied ? "Скопировано!" : "Скопировать"}
              </button>
              <button className="pixel-btn pixel-btn-secondary" onClick={onRegenerateCode}>
                Обновить код
              </button>
            </div>

            <hr className="pixel-divider" />

            <label className="pixel-label">Настройки</label>
            <button className="menu-toggle-row" onClick={onToggleMotion}>
              {motionEnabled ? "✨ Анимации: вкл" : "◻ Анимации: выкл"}
            </button>

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

            <button
              className="pixel-btn pixel-btn-secondary pixel-btn-full"
              style={{ marginTop: 10 }}
              onClick={() => setOpen(false)}
            >
              Закрыть
            </button>
          </div>
        </div>
      )}
    </>
  );
}
