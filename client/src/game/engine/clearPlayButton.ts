// Кнопка «В СБРОС», вшитая в бокс игральной зоны: одним движением уносит всю зону в сброс.
//
// Живёт ВНУТРИ бокса, в его правом верхнем углу, а не на нижней панели действий. Причина
// простая: панель — это «что я делаю своими картами», а уборка стола относится к самому
// столу и должна лежать там, куда игрок и так смотрит. Правый верхний угол выбран потому,
// что сетка кучек растёт слева направо и сверху вниз — там она закрывает кнопку последней.

export const CLEAR_PLAY_LABEL = "В СБРОС";

export interface ClearPlayButton {
  cx: number;
  cy: number;
  w: number;
  h: number;
  r: number;
  fontSize: number;
}

/**
 * Раскладка кнопки. Размер считается от КАРТЫ, а не константой: карта — единственная мера
 * этого стола, а константа на телефоне превращалась бы то в марку, то в полбокса.
 */
export function clearPlayButton(
  zone: { cx: number; cy: number; w: number; h: number },
  cardH: number,
): ClearPlayButton {
  const h = Math.max(14, Math.min(cardH * 0.34, zone.h * 0.22));
  // Ширина — под самую надпись: кегль пропорционален высоте, ширина символа ~0.62 кегля.
  const fontSize = Math.max(7, h * 0.62);
  const w = Math.min(zone.w * 0.6, fontSize * CLEAR_PLAY_LABEL.length * 0.62 + h * 0.9);
  const pad = h * 0.35;
  return {
    cx: zone.cx + zone.w / 2 - w / 2 - pad,
    cy: zone.cy - zone.h / 2 + h / 2 + pad,
    w,
    h,
    r: h / 2,
    fontSize,
  };
}

/** Палец на кнопке. Хит-зона ровно по кнопке: она маленькая, запас украл бы у сетки. */
export function hitsClearPlay(btn: ClearPlayButton, x: number, y: number): boolean {
  return Math.abs(x - btn.cx) <= btn.w / 2 && Math.abs(y - btn.cy) <= btn.h / 2;
}
