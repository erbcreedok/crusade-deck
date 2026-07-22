import { useState, type ReactNode } from "react";

// Панель действий внизу комнаты. Каркас ПОСТОЯННЫЙ: три слота одинакового размера,
// которые не прыгают и не меняют ширину от того, что в них написано. Что именно
// назначено на кнопки — решает вызывающий; панель про это ничего не знает.
//
//   [ главное действие ] [ второстепенное ] [ ☰ ]
//
// Гамбургер открывает слайд-ап меню с остальными действиями (настройки, выход и т.п.).

export interface ActionSlot {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

export interface MenuItem {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  icon?: ReactNode;
}

// Сколько символов влезает в кнопку. Подобрано под самый узкий телефон (320px):
// три слота фиксированной ширины, шрифт по clamp() — дальше текст только сокращать.
const MAX_LABEL = 14;

// Длинную подпись режем по границе слова и добавляем многоточие: лучше «Вернуть…»,
// чем «Вернуть кол…» в две строки или обрезка на середине буквы.
export function shortenLabel(label: string, max: number = MAX_LABEL): string {
  if (label.length <= max) return label;
  const cut = label.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  const base = lastSpace > max / 2 ? cut.slice(0, lastSpace) : cut;
  return `${base.trimEnd()}…`;
}

export function ActionBar({
  main,
  secondary,
  menuItems = [],
}: {
  main?: ActionSlot;
  secondary?: ActionSlot;
  menuItems?: MenuItem[];
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <>
      {menuOpen && (
        <>
          <div
            className="action-sheet-backdrop"
            data-testid="action-sheet-backdrop"
            onClick={() => setMenuOpen(false)}
          />
          {/* «Веер» как в доке macOS: пункты выпрыгивают вверх от самой кнопки, а не
              выезжают шторкой во весь экран. Ближний к кнопке появляется первым. */}
          <div className="action-fan" role="menu">
            {[...menuItems].reverse().map((item, i) => {
              const fromBottom = menuItems.length - 1 - i; // 0 у ближнего к гамбургеру
              return (
                <button
                  key={item.label}
                  className="action-fan-item"
                  role="menuitem"
                  disabled={item.disabled}
                  style={{
                    // Лёгкая дуга: чем выше пункт, тем сильнее он уходит влево.
                    marginRight: `${fromBottom * 6}px`,
                    animationDelay: `${fromBottom * 35}ms`,
                  }}
                  onClick={() => {
                    setMenuOpen(false);
                    item.onClick();
                  }}
                >
                  {item.icon} {item.label}
                </button>
              );
            })}
            {menuItems.length === 0 && <p className="action-fan-empty">Пока пусто</p>}
          </div>
        </>
      )}

      <div className="action-bar">
        <ActionButton slot={main} kind="main" testId="action-main" />
        <ActionButton slot={secondary} kind="secondary" testId="action-secondary" />
        <button
          className="action-btn action-btn-menu"
          aria-label="Ещё действия"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
        >
          ☰
        </button>
      </div>
    </>
  );
}

function ActionButton({
  slot,
  kind,
  testId,
}: {
  slot?: ActionSlot;
  kind: "main" | "secondary";
  testId: string;
}) {
  // Пустой слот остаётся на месте и неактивен — каркас не должен «схлопываться»,
  // когда действия нет: кнопки не переезжают под пальцем от кадра к кадру.
  const label = slot ? shortenLabel(slot.label) : "";
  return (
    <button
      className={`action-btn action-btn-${kind}`}
      data-testid={testId}
      title={slot?.label || undefined}
      disabled={!slot || !!slot.disabled}
      onClick={slot?.onClick}
    >
      {label}
    </button>
  );
}
