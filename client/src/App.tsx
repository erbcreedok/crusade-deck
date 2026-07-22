import { useEffect, useState } from "react";
import { Room } from "colyseus.js";
import { MotionConfig } from "framer-motion";
import { useAuth } from "./useAuth";
import { Lobby } from "./Lobby";
import { RoomScreen } from "./RoomScreen";
import { AppMenu } from "./AppMenu";
import { PixelBackground } from "./PixelBackground";
import { useAnimationSettings } from "./useAnimationSettings";

export default function App() {
  const {
    user,
    account,
    loading,
    createAccount,
    restoreAccount,
    renameAccount,
    regenerateCode,
  } = useAuth();
  const [room, setRoom] = useState<Room | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [restoreCode, setRestoreCode] = useState("");
  const [showRestore, setShowRestore] = useState(false);
  const { settings: animation, setLevel, setSpeed, setShadows } = useAnimationSettings();
  // Фон и Framer Motion движутся только при полной анимации; в умеренной — статичны.
  const fullMotion = animation.level === "full";

  // Обрыв связи (свернул вкладку, сон iOS, потеря сети) — возвращаем в лобби, где есть
  // кнопка «↩ Вернуться». Сервер держит игрока «на паузе», так что возврат разморозит его.
  useEffect(() => {
    if (!room) return;
    const backToLobby = () => setRoom(null);
    room.onLeave(backToLobby);
    room.onError(backToLobby);
  }, [room]);

  return (
    <MotionConfig reducedMotion={fullMotion ? "never" : "always"}>
      <PixelBackground enabled={fullMotion} />
      {renderContent()}
    </MotionConfig>
  );

  function renderContent() {
    if (loading) {
      return (
        <div className="pixel-screen">
          <p className="pixel-loading">Загрузка...</p>
        </div>
      );
    }

    if (!user) {
      async function handleNew() {
        setAuthError(null);
        try {
          await createAccount();
        } catch (e) {
          setAuthError((e as Error).message);
        }
      }

      async function handleRestore() {
        setAuthError(null);
        try {
          await restoreAccount(restoreCode);
        } catch (e) {
          setAuthError((e as Error).message);
        }
      }

      return (
        <div className="pixel-screen">
          <div className="pixel-panel">
            <h2 className="pixel-title">♣ Вход ♦</h2>

            {!showRestore ? (
              <>
                <button className="pixel-btn pixel-btn-full" onClick={handleNew}>
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
                  <button className="pixel-btn" onClick={handleRestore}>
                    Войти
                  </button>
                  <button className="pixel-btn pixel-btn-secondary" onClick={() => setShowRestore(false)}>
                    Назад
                  </button>
                </div>
              </>
            )}

            {authError && <p className="pixel-error">{authError}</p>}
          </div>
        </div>
      );
    }

    return (
      <>
        {account && (
          <AppMenu
            account={account}
            onRename={renameAccount}
            onRegenerateCode={regenerateCode}
            animation={animation}
            onSetLevel={setLevel}
            onSetSpeed={setSpeed}
            onSetShadows={setShadows}
            room={room}
            onLeaveRoom={() => setRoom(null)}
          />
        )}
        {room ? (
          <RoomScreen room={room} animation={animation} />
        ) : (
          <Lobby
            accountId={user.uid}
            initialName={account?.name}
            onRename={renameAccount}
            onJoined={setRoom}
          />
        )}
      </>
    );
  }
}
