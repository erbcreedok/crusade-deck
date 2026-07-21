import { useState } from "react";
import { Room } from "colyseus.js";
import { MotionConfig } from "framer-motion";
import { useAuth } from "./useAuth";
import { Lobby } from "./Lobby";
import { RoomScreen } from "./RoomScreen";
import { AppMenu } from "./AppMenu";
import { PixelBackground } from "./PixelBackground";
import { useMotionPreference } from "./useMotionPreference";

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
  const { enabled: motionEnabled, toggle: toggleMotion } = useMotionPreference();

  return (
    <MotionConfig reducedMotion={motionEnabled ? "never" : "always"}>
      <PixelBackground enabled={motionEnabled} />
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
            motionEnabled={motionEnabled}
            onToggleMotion={toggleMotion}
            room={room}
            onLeaveRoom={() => setRoom(null)}
          />
        )}
        {room ? (
          <RoomScreen room={room} />
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
