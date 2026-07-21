import { useState } from "react";
import { Account, formatRecoveryHash } from "./account";

export function ProfilePanel({
  account,
  onRename,
  onClose,
}: {
  account: Account;
  onRename: (name: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(account.name);
  const [copied, setCopied] = useState(false);

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(account.recoveryHash);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // буфер обмена недоступен — код всё равно виден на экране
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="pixel-panel" onClick={(e) => e.stopPropagation()}>
        <h2 className="pixel-title">♣ Профиль ♦</h2>

        <label className="pixel-label">Имя</label>
        <input
          className="pixel-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && onRename(name)}
          maxLength={24}
        />

        <label className="pixel-label">Код восстановления</label>
        <p className="recovery-code">{formatRecoveryHash(account.recoveryHash)}</p>
        <p className="pixel-hint">
          Введи этот код на другом устройстве, чтобы зайти под тем же именем.
          Никому не показывай — тот, у кого есть код, может действовать от твоего имени.
        </p>
        <button className="pixel-btn pixel-btn-full" onClick={copyCode}>
          {copied ? "Скопировано!" : "Скопировать код"}
        </button>

        <button className="pixel-btn pixel-btn-secondary pixel-btn-full" style={{ marginTop: 10 }} onClick={onClose}>
          Закрыть
        </button>
      </div>
    </div>
  );
}
