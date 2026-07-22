import { useEffect, useState } from "react";
import { Room } from "colyseus.js";
import { MotionConfig } from "framer-motion";
import { useAuth } from "./useAuth";
import { Lobby } from "./Lobby";
import { RoomScreen } from "./RoomScreen";
import { AppMenu } from "./AppMenu";
import { PixelBackground } from "./PixelBackground";
import { useAnimationSettings } from "./useAnimationSettings";
import { useFourColor } from "./useFourColor";
import { useCardBack } from "./useCardBack";
import { joinByInviteCode } from "./colyseus";
import {
  parseRoomCode,
  pushRoomUrl,
  pushLobbyUrl,
  saveActiveRoom,
  loadActiveRoom,
  clearActiveRoom,
} from "./roomRoute";

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
  // Комната, куда мы хотим попасть: из URL (/room/<код>) или из персиста последней сессии.
  // Пока она задана, а живого room нет — показываем лоадер и пытаемся подключиться.
  const [targetCode, setTargetCode] = useState<string | null>(() => parseRoomCode() ?? loadActiveRoom());
  const [authError, setAuthError] = useState<string | null>(null);
  const [restoreCode, setRestoreCode] = useState("");
  const [showRestore, setShowRestore] = useState(false);
  const { settings: animation, setLevel, setSpeed, setShadows } = useAnimationSettings();
  const { fourColor, setFourColor } = useFourColor();
  const { cardBack, setCardBack } = useCardBack();
  // Фон и Framer Motion движутся только при полной анимации; в умеренной — статичны.
  const fullMotion = animation.level === "full";

  const accountId = user?.uid;
  const accountName = account?.name;

  // Вошли в комнату: запоминаем её код (URL + персист) как «активную» для бесшовного
  // возврата. Код приходит из состояния комнаты (inviteCode) — ждём первый стейт, если нужно.
  function handleJoined(r: Room) {
    setRoom(r);
    const apply = () => {
      const code = (r.state as { inviteCode?: string })?.inviteCode;
      if (!code) return;
      saveActiveRoom(code);
      pushRoomUrl(code);
      setTargetCode(code);
    };
    apply();
    r.onStateChange(apply); // идемпотентно: как только придёт inviteCode — проставим
  }

  // Явный выход/отмена возврата — забываем активную комнату (авто-возврата больше нет;
  // серверная «последняя комната» для кнопки в лобби при этом сохраняется).
  function forgetRoom() {
    setRoom(null);
    setTargetCode(null);
    clearActiveRoom();
    pushLobbyUrl();
  }

  // Обрыв связи (свернул вкладку, сон iOS, сеть) — роняем room, но НЕ забываем targetCode:
  // авто-эффект ниже переподключится бесшовно (сервер держит игрока на паузе).
  useEffect(() => {
    if (!room) return;
    const drop = () => setRoom(null);
    room.onLeave(drop);
    room.onError(drop);
  }, [room]);

  // Бесшовное подключение к targetCode (первый вход по URL, персист, реконнект после обрыва).
  useEffect(() => {
    if (!accountId || !accountName || room || !targetCode) return;
    let cancelled = false;
    joinByInviteCode(targetCode, { accountId, name: accountName })
      .then((r) => {
        if (cancelled) return void r.leave();
        handleJoined(r);
      })
      .catch(() => {
        if (cancelled) return;
        // Комнаты уже нет (или код неверный) — уходим на начальный экран.
        clearActiveRoom();
        pushLobbyUrl();
        setTargetCode(null);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, accountName, targetCode, room]);

  // Кнопки назад/вперёд браузера: синхронизируем targetCode с адресом.
  useEffect(() => {
    const onPop = () => {
      const code = parseRoomCode();
      if (code) {
        setTargetCode(code);
      } else {
        setTargetCode(null);
        clearActiveRoom();
        if (room) {
          room.leave();
          setRoom(null);
        }
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
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
            fourColor={fourColor}
            onSetFourColor={setFourColor}
            cardBack={cardBack}
            onSetCardBack={setCardBack}
            room={room}
            onLeaveRoom={forgetRoom}
          />
        )}
        {room ? (
          <RoomScreen room={room} animation={animation} fourColor={fourColor} cardBack={cardBack} />
        ) : targetCode ? (
          <div className="pixel-screen">
            <div className="pixel-panel" style={{ textAlign: "center" }}>
              <p className="pixel-loading">Возвращаемся в комнату {targetCode}…</p>
              <button className="pixel-btn pixel-btn-secondary pixel-btn-full" onClick={forgetRoom}>
                В лобби
              </button>
            </div>
          </div>
        ) : (
          <Lobby
            accountId={user.uid}
            initialName={account?.name}
            onRename={renameAccount}
            onJoined={handleJoined}
          />
        )}
      </>
    );
  }
}
