// Геометрия комнаты из размеров канваса. Чистая математика (тестируется юнитами) —
// движок только рисует по этим числам. Стол больше не рисуется овалом: визуально это
// весь экран. Зоны (центр/сейф/запретная) — скруглённые прямоугольники во всю ширину.

export interface RoundedRect {
  cx: number;
  cy: number;
  w: number;
  h: number;
  r: number; // радиус скругления углов
}

export interface RoomLayout {
  centerZone: RoundedRect; // общая зона игры (широкая, по центру)
  safeZone: RoundedRect; // личная сейф-зона снизу
  forbiddenZone: RoundedRect; // тестовая зона сверху, куда дропать НЕЛЬЗЯ
  deckAnchor: { x: number; y: number }; // покой колоды в центре = центр centerZone
  safeAnchor: { x: number; y: number }; // покой колоды в сейф-зоне = центр safeZone
  cardW: number;
  cardH: number;
}

const CARD_RATIO = 0.7; // ширина / высота игральной карты (~2.5" x 3.5")
const CARD_MIN_H = 48;
const CARD_MAX_H = 140;

export function computeLayout(w: number, h: number): RoomLayout {
  // Карта масштабируется от меньшей стороны канваса, с потолком/полом.
  const cardH = clamp(Math.min(w, h) * 0.16, CARD_MIN_H, CARD_MAX_H);
  const cardW = cardH * CARD_RATIO;

  // Зоны занимают почти всю ширину (≥80%) — удобнее целиться и дропать.
  const zoneW = Math.max(0, w * 0.86);
  const r = 18;

  // Центр — широкая зона игры чуть выше середины. Сейф — полоса у нижнего края.
  // Запретная — узкая полоса сверху (тестовая, дроп запрещён).
  const centerZone: RoundedRect = { cx: w / 2, cy: h * 0.44, w: zoneW, h: clamp(h * 0.42, cardH * 1.6, h * 0.5), r };
  const safeZone: RoundedRect = { cx: w / 2, cy: h * 0.85, w: zoneW, h: clamp(cardH * 1.7, 0, h * 0.28), r };
  const forbiddenZone: RoundedRect = { cx: w / 2, cy: h * 0.1, w: Math.max(0, w * 0.5), h: cardH * 0.9, r: 14 };

  const deckAnchor = { x: centerZone.cx, y: centerZone.cy };
  const safeAnchor = { x: safeZone.cx, y: safeZone.cy };

  return { centerZone, safeZone, forbiddenZone, deckAnchor, safeAnchor, cardW, cardH };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
