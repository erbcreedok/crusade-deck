import { useEffect, useState } from "react";
import { MotionConfig } from "framer-motion";
import { useAuth } from "./useAuth";
import { Lobby } from "./Lobby";
import { RoomScreen } from "./RoomScreen";
import { AppMenu } from "./AppMenu";
import { AuthScreen } from "./AuthScreen";
import { PixelBackground, type BackgroundVariant } from "./PixelBackground";
import { applyThemeColor } from "./themeColor";
import { useAnimationSettings } from "./useAnimationSettings";
import { useFourColor } from "./useFourColor";
import { useCardBack } from "./useCardBack";
import { useRoomConnection } from "./useRoomConnection";
import { sessionEntry } from "./sessionEntry";
import { InstallPrompt } from "./InstallPrompt";

// Корень приложения: аккаунт, настройки, соединение с комнатой — и выбор экрана.
// Сама логика подключения и адресной строки живёт в useRoomConnection.
export default function App() {
  const { user, account, loading, createAccount, restoreAccount, renameAccount, regenerateCode, logout, recentAccounts, forgetAccount } =
    useAuth();
  const { settings: animation, setLevel, setSpeed, setShadows } = useAnimationSettings();
  const { fourColor, setFourColor } = useFourColor();
  const { cardBack, setCardBack } = useCardBack();
  const { room, targetCode, onJoined, leaveToLobby, forget } = useRoomConnection(user?.uid, account?.name);
  // Меню настроек живёт здесь: в комнате его открывает нижний веер, в лобби — своя ☰.
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Логаут закрывает и комнату: сначала выходим из неё (сокет, активная комната, адрес),
  // потом забываем аккаунт — App показывает экран входа с текущим юзером в быстром доступе.
  const onLogout = () => {
    leaveToLobby();
    logout();
  };

  // Фон и Framer Motion движутся только при полной анимации; в умеренной — статичны.
  const fullMotion = animation.level === "full";
  // Фон комнаты и цвет строки состояния переключаются вместе — это один визуальный слой.
  const bgVariant: BackgroundVariant = room ? "game" : "menu";
  useEffect(() => {
    applyThemeColor(bgVariant);
  }, [bgVariant]);

  return (
    <MotionConfig reducedMotion={fullMotion ? "never" : "always"}>
      <PixelBackground enabled={fullMotion} variant={bgVariant} />
      {loading ? (
        <div className="pixel-screen">
          <p className="pixel-loading">Загрузка...</p>
        </div>
      ) : !user ? (
        <AuthScreen
          onCreate={createAccount}
          onRestore={restoreAccount}
          recentAccounts={recentAccounts}
          onForgetRecent={forgetAccount}
        />
      ) : (
        <>
          {account && (
            <AppMenu
              open={settingsOpen}
              onOpenChange={setSettingsOpen}
              // В комнате верхнего гамбургера нет: настройки открываются из нижнего веера.
              showFab={!room}
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
              onLeaveRoom={forget}
              onLogout={onLogout}
            />
          )}
          {room ? (
            <RoomScreen
              room={room}
              animation={animation}
              fourColor={fourColor}
              cardBack={cardBack}
              onOpenSettings={() => setSettingsOpen(true)}
              onLeaveRoom={leaveToLobby}
            />
          ) : targetCode ? (
            // Возврат в комнату: подключение идёт в useRoomConnection, здесь — только
            // ожидание и способ передумать.
            <div className="pixel-screen">
              <div className="pixel-panel" style={{ textAlign: "center" }}>
                <p className="pixel-loading">Возвращаемся в комнату {targetCode}…</p>
                <button className="pixel-btn pixel-btn-secondary pixel-btn-full" onClick={forget}>
                  В лобби
                </button>
              </div>
            </div>
          ) : (
            <Lobby
              accountId={user.uid}
              initialName={account?.name}
              onRename={renameAccount}
              onJoined={onJoined}
              prefillCode={sessionEntry().invitePrefill ?? undefined}
            />
          )}
          {/* Подсказка «добавить на домашний экран» — вне комнаты, самоскрывается, если уже
              standalone или закрыта. Особенно про браузер Telegram (сворачивает жестами). */}
          {!room && <InstallPrompt />}
        </>
      )}
    </MotionConfig>
  );
}
