import { useCallback, useEffect, useState } from "react";
import { Room } from "colyseus.js";
import { Account } from "./account";
import { CARD_BACKS, cardBackSkin, type CardBackId } from "./game/cardBack";
import type { FaceStyle } from "./game/engine/cardTextures";
import {
  ANIMATION_SPEEDS,
  type AnimationLevel,
  type AnimationSettings,
  type AnimationSpeed,
} from "./game/anim/animationSettings";
import { formatBuild } from "./version";
import { buildTransferLink } from "./sessionEntry";

const LEVEL_OPTIONS: { value: AnimationLevel; label: string }[] = [
  { value: "full", label: "Полная" },
  { value: "moderate", label: "Умеренная" },
];

type MenuView = "main" | "profile" | "graphics" | "backs";

const VIEW_TITLES: Record<MenuView, string> = {
  main: "♣ Меню ♦",
  profile: "👤 Профиль",
  graphics: "🎨 Графика",
  backs: "🂠 Рубашка",
};

export function AppMenu({
  account,
  onRename,
  onRegenerateCode,
  animation,
  onSetLevel,
  onSetSpeed,
  onSetShadows,
  fourColor,
  onSetFourColor,
  cardBack,
  onSetCardBack,
  faceStyle,
  onSetFaceStyle,
  room,
  onLeaveRoom,
  onLogout,
  onOpenInstall,
  open: controlledOpen,
  onOpenChange,
  showFab = true,
}: {
  account: Account;
  onRename: (name: string) => void;
  onRegenerateCode: () => void;
  animation: AnimationSettings;
  onSetLevel: (level: AnimationLevel) => void;
  onSetSpeed: (speed: AnimationSpeed) => void;
  onSetShadows: (shadows: boolean) => void;
  fourColor: boolean;
  onSetFourColor: (v: boolean) => void;
  cardBack: CardBackId;
  onSetCardBack: (id: CardBackId) => void;
  faceStyle: FaceStyle;
  onSetFaceStyle: (v: FaceStyle) => void;
  room: Room | null;
  onLeaveRoom: () => void;
  onLogout: () => void;
  onOpenInstall: () => void;
  // Управление снаружи: в комнате меню открывает нижний веер, и своя кнопка ☰ не нужна.
  // Без этих пропсов компонент работает как раньше — сам с собой (лобби).
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  showFab?: boolean;
}) {
  const [ownOpen, setOwnOpen] = useState(false);
  const open = controlledOpen ?? ownOpen;
  const setOpen = useCallback(
    (v: boolean) => {
      setOwnOpen(v);
      onOpenChange?.(v);
    },
    [onOpenChange],
  );
  const [view, setView] = useState<MenuView>("main");
  const [name, setName] = useState(account.name);
  const [copied, setCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
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

  // Ссылка переноса сессии: в буфер уходит `origin/#u=КОД`. Открыв её в другом браузере,
  // человек продолжит игру за того же юзера (код читается один раз и вычищается из URL).
  // Ссылка «жива», пока жив код восстановления, — она всегда собирается из текущего.
  async function copyTransferLink() {
    try {
      await navigator.clipboard.writeText(buildTransferLink(account.recoveryHash, window.location.origin));
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 1500);
    } catch {
      // буфер недоступен — молча, тут показать нечего
    }
  }

  function leaveRoom() {
    room?.leave();
    onLeaveRoom();
    close();
  }

  function logout() {
    close();
    onLogout(); // выход из комнаты и аккаунта делает App; текущий юзер уходит в быстрый доступ
  }

  return (
    <>
      {showFab && (
        <button className="menu-fab" onClick={() => setOpen(true)}>
          ☰
        </button>
      )}

      {open && (
        // Подложка перехватывает нажатие и остаётся смонтированной до click —
        // иначе меню закрылось бы по mousedown, а клик провалился бы на кнопку под ним.
        <div className="modal-overlay" onClick={close}>
          <div className="pixel-panel" onClick={(e) => e.stopPropagation()}>
            <div className="pixel-panel-header">
              {view !== "main" ? (
                <button
                  className="pixel-icon-btn"
                  aria-label="Назад"
                  onClick={() => setView(view === "backs" ? "graphics" : "main")}
                >
                  ←
                </button>
              ) : (
                <span className="pixel-icon-btn pixel-icon-spacer" aria-hidden />
              )}
              <h2 className="pixel-title">{VIEW_TITLES[view]}</h2>
              <button className="pixel-icon-btn" aria-label="Закрыть" onClick={close}>
                ✕
              </button>
            </div>

            {view === "main" && renderMain()}
            {view === "profile" && renderProfile()}
            {view === "graphics" && renderGraphics()}
            {view === "backs" && renderBacks()}
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

        {/* Перенос сессии в другой браузер (обход сворачивания в браузере Telegram). В комнате
            это «перенести эту игру», в лобби — просто «ссылка для входа»; действие одно. */}
        <button className="menu-toggle-row" onClick={copyTransferLink}>
          {linkCopied ? "✓ Ссылка в буфере" : room ? "🔗 Перенести эту игру" : "🔗 Ссылка для входа"}
        </button>

        {/* Под ссылкой входа — «добавить на экран»: открывает модалку с инструкцией под платформу. */}
        <button
          className="menu-toggle-row"
          onClick={() => {
            close();
            onOpenInstall();
          }}
        >
          📲 Добавить на экран
        </button>

        <button className="menu-toggle-row" onClick={() => setView("graphics")}>
          🎨 Графика
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

        {/* В меню — ПОЛНАЯ подпись: версия со сборкой, коммит и время. Её диктуют в
            поддержку, поэтому здесь всё, а на главном экране только версия. */}
        <hr className="pixel-divider" />
        <p className="pixel-version">{formatBuild()}</p>
      </>
    );
  }

  // Всё, что влияет на картинку: тяжесть анимаций, тени, цвет мастей, скин рубашки.
  function renderGraphics() {
    return (
      <>
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

        <label className="pixel-label">Вид карт</label>
        <div className="seg-row">
          <button
            className={`seg-btn${faceStyle === "symbol" ? " seg-btn-active" : ""}`}
            onClick={() => onSetFaceStyle("symbol")}
          >
            Крупно
          </button>
          <button
            className={`seg-btn${faceStyle === "pips" ? " seg-btn-active" : ""}`}
            onClick={() => onSetFaceStyle("pips")}
          >
            По номиналу
          </button>
        </div>

        {/* Рубашка вынесена в отдельное подменю с гридом — скинов стало много. */}
        <button className="menu-toggle-row menu-row-nav" onClick={() => setView("backs")}>
          <span>🂠 Рубашка</span>
          <span className="menu-row-value">
            <span className={`back-swatch back-swatch-sm back-swatch-${cardBack}`} aria-hidden />
            {cardBackSkin(cardBack).label} ›
          </span>
        </button>

        <button
          className="menu-toggle-row"
          onClick={() => onSetShadows(animation.shadows === false)}
        >
          {animation.shadows === false ? "🃏 Тени карт: выкл" : "🃏 Тени карт: вкл"}
        </button>

        <button className="menu-toggle-row" onClick={() => onSetFourColor(!fourColor)}>
          {fourColor ? "🎨 Четырёхцветная колода: вкл" : "🎨 Четырёхцветная колода: выкл"}
        </button>
      </>
    );
  }

  // Выбор скина рубашки: грид превью. Клик сразу применяет и возвращает в «Графику» —
  // рубашку меняют разово, а не листают весь список каждый раз.
  function renderBacks() {
    return (
      <div className="back-grid">
        {CARD_BACKS.map((skin) => (
          <button
            key={skin.id}
            className={`back-opt${cardBack === skin.id ? " back-opt-active" : ""}`}
            onClick={() => {
              onSetCardBack(skin.id);
              setView("graphics");
            }}
          >
            <span className={`back-swatch back-swatch-${skin.id}`} aria-hidden />
            {skin.label}
          </button>
        ))}
      </div>
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

        {/* Выход: код уже сохранён локально, поэтому логаут безопасен — юзер остаётся кнопкой
            быстрого входа на экране входа и вернётся одним касанием. */}
        <hr className="pixel-divider" />
        <button className="pixel-btn pixel-btn-danger pixel-btn-full" onClick={logout}>
          Выйти
        </button>
      </>
    );
  }
}
