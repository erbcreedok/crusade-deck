// Геометрия комнаты из размеров канваса. Чистая математика (тестируется юнитами) —
// движок только рисует по этим числам. Овал стола — виртуальный (не буквальный),
// центр — зона игры, deckAnchor — где покоится собранная колода.

export interface Ellipse {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

export interface RoomLayout {
  table: Ellipse;
  center: Ellipse;
  deckAnchor: { x: number; y: number };
  // Личная сейф-зона локального игрока — по центру снизу. Сюда дилер притягивает
  // колоду (позже — и лежат личные/общие карты). Чужие сейф-зоны пока не рисуем.
  safeAnchor: { x: number; y: number };
  cardW: number;
  cardH: number;
}

const CARD_RATIO = 0.7; // ширина / высота игральной карты (~2.5" x 3.5")
const CARD_MIN_H = 48;
const CARD_MAX_H = 140;

export function computeLayout(w: number, h: number): RoomLayout {
  const cx = w / 2;
  const cy = h / 2;

  // Овал стола с полями по краям.
  const rx = Math.max(0, w * 0.46);
  const ry = Math.max(0, h * 0.42);
  const table: Ellipse = { cx, cy, rx, ry };

  // Центральная зона игры — заметно меньше стола, по тому же центру.
  const center: Ellipse = { cx, cy, rx: rx * 0.42, ry: ry * 0.44 };

  // Карта масштабируется от меньшей стороны канваса, с потолком/полом.
  const cardH = clamp(Math.min(w, h) * 0.16, CARD_MIN_H, CARD_MAX_H);
  const cardW = cardH * CARD_RATIO;

  // Колода покоится чуть выше геометрического центра — читается как «лежит на столе».
  const deckAnchor = { x: cx, y: cy - ry * 0.08 };

  // Сейф-зона своего игрока — у нижнего края, с отступом на высоту карты, чтобы
  // стопка целиком была видна (карты растут вверх от якоря).
  const safeAnchor = { x: cx, y: Math.max(cy, h - cardH * 0.75) };

  return { table, center, deckAnchor, safeAnchor, cardW, cardH };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
