import { useState } from "react";
import type { RecentAccount } from "./recentAccounts";
import { formatVersion } from "./version";

// Вход без пароля: либо новый профиль одной кнопкой, либо восстановление по короткому
// коду (см. account.ts). Экран показывается, пока у игрока нет аккаунта. Недавние аккаунты
// (после логаута) — сверху, для входа одним касанием.

export function AuthScreen({
  onCreate,
  onRestore,
  recentAccounts = [],
  onForgetRecent,
  onOpenInstall,
}: {
  onCreate: () => Promise<unknown>;
  onRestore: (code: string) => Promise<unknown>;
  recentAccounts?: RecentAccount[];
  onForgetRecent?: (id: string) => void;
  onOpenInstall?: () => void;
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

        {!showRestore && recentAccounts.length > 0 && (
          <div className="recent-accounts">
            <label className="pixel-label">Быстрый вход</label>
            {recentAccounts.map((a) => (
              <div key={a.id} className="recent-account-row">
                <button className="pixel-btn recent-account-btn" onClick={() => void run(() => onRestore(a.recoveryHash))}>
                  ▸ {a.name}
                </button>
                {onForgetRecent && (
                  <button
                    className="pixel-icon-btn"
                    aria-label={`Убрать ${a.name} из быстрого доступа`}
                    onClick={() => onForgetRecent(a.id)}
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
            <hr className="pixel-divider" />
          </div>
        )}

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

        {/* Всегда доступно на входе: как добавить игру на домашний экран (обход сворачивания
            во встроенных браузерах). Модалку открывает App. */}
        {onOpenInstall && (
          <>
            <hr className="pixel-divider" />
            <button className="pixel-btn pixel-btn-secondary pixel-btn-full" onClick={onOpenInstall}>
              📲 Добавить на экран
            </button>
          </>
        )}
      </div>

      {/* Версия в углу экрана — как в лобби: по скриншоту видно, что за сборка на проде. */}
      <p className="pixel-version pixel-version-corner">{formatVersion()}</p>
    </div>
  );
}
