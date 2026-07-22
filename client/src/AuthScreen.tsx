import { useState } from "react";

// Вход без пароля: либо новый профиль одной кнопкой, либо восстановление по короткому
// коду (см. account.ts). Экран показывается, пока у игрока нет аккаунта.

export function AuthScreen({
  onCreate,
  onRestore,
}: {
  onCreate: () => Promise<unknown>;
  onRestore: (code: string) => Promise<unknown>;
}) {
  const [restoreCode, setRestoreCode] = useState("");
  const [showRestore, setShowRestore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Ошибку показываем текстом на экране: другого места сказать «код не подошёл» нет.
  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="pixel-screen">
      <div className="pixel-panel">
        <h2 className="pixel-title">♣ Вход ♦</h2>

        {!showRestore ? (
          <>
            <button className="pixel-btn pixel-btn-full" onClick={() => void run(onCreate)}>
              Новый профиль
            </button>
            <button
              className="pixel-btn pixel-btn-secondary pixel-btn-full"
              style={{ marginTop: 10 }}
              onClick={() => setShowRestore(true)}
            >
              Восстановить по коду
            </button>
          </>
        ) : (
          <>
            <label className="pixel-label">Код восстановления</label>
            <input
              className="pixel-input"
              value={restoreCode}
              onChange={(e) => setRestoreCode(e.target.value)}
              placeholder="BOVAKI"
              maxLength={6}
            />
            <div className="pixel-btn-row">
              <button className="pixel-btn" onClick={() => void run(() => onRestore(restoreCode))}>
                Войти
              </button>
              <button className="pixel-btn pixel-btn-secondary" onClick={() => setShowRestore(false)}>
                Назад
              </button>
            </div>
          </>
        )}

        {error && <p className="pixel-error">{error}</p>}
      </div>
    </div>
  );
}
