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
  centerZone: RoundedRect; // общая зона игры (широкая, сверху)
  safeZone: RoundedRect; // личная сейф-зона (посередине-снизу)
  handZone: RoundedRect; // зона руки у нижнего края (пока недоступна для дропа)
  deckAnchor: { x: number; y: number }; // покой колоды в центре = центр centerZone
  safeAnchor: { x: number; y: number }; // покой колоды в сейф-зоне = центр safeZone
  cardW: number;
  cardH: number;
}

const CARD_RATIO = 0.7; // ширина / высота игральной карты (~2.5" x 3.5")
const CARD_MIN_H = 48;
const CARD_MAX_H = 140;

// Сколько по краям занято чужими местами (посадка «П», см. seatLayout.ts). Центр стола
// ужимается ровно на это: боковые колонки сужают его по ширине, верхняя полоса опускает
// его крышу. Мои сейф-зона и рука внизу — не трогаются, они всегда мои.
export interface LayoutInsets {
  top: number;
  left: number;
  right: number;
}

const NO_INSETS: LayoutInsets = { top: 0, left: 0, right: 0 };

export function computeLayout(w: number, h: number, insets: LayoutInsets = NO_INSETS): RoomLayout {
  // Карта масштабируется от меньшей стороны канваса, с потолком/полом.
  const cardH = clamp(Math.min(w, h) * 0.16, CARD_MIN_H, CARD_MAX_H);
  const cardW = cardH * CARD_RATIO;

  // Зоны занимают почти всю ширину (≥80%) — удобнее целиться и дропать.
  const zoneW = Math.max(0, w * 0.86);
  const r = 18;

  // Три горизонтальные полосы снизу вверх: рука (у нижнего края) → сейф → центр.
  // Сейф приподнят, чтобы освободить низ под руку.
  // Центр живёт в прямоугольнике, оставшемся от посадки. Клампы держат его живым даже
  // при абсурдных отступах (узкий экран + полный стол) — лучше тесный центр, чем нулевой.
  const freeLeft = Math.min(insets.left, w * 0.4);
  const freeRight = Math.min(insets.right, w * 0.4);
  const freeTop = Math.min(insets.top, h * 0.4);
  const centerW = Math.max(cardW * 1.2, Math.min(zoneW, w - freeLeft - freeRight - 16));
  const centerCx = freeLeft + (w - freeLeft - freeRight) / 2;
  const centerH = clamp(h * 0.36, cardH * 1.4, Math.max(cardH * 1.4, h * 0.42));
  // Крыша центра — сразу под верхней полосой мест; ниже сейф-зоны он не опускается.
  const centerCy = Math.max(h * 0.34, freeTop + centerH / 2 + 8);

  const centerZone: RoundedRect = { cx: centerCx, cy: centerCy, w: centerW, h: centerH, r };
  const safeZone: RoundedRect = { cx: w / 2, cy: h * 0.66, w: zoneW, h: clamp(h * 0.2, cardH * 1.2, h * 0.24), r };
  const handZone: RoundedRect = { cx: w / 2, cy: h * 0.88, w: zoneW, h: clamp(h * 0.16, cardH * 1.1, h * 0.2), r };

  const deckAnchor = { x: centerZone.cx, y: centerZone.cy };
  const safeAnchor = { x: safeZone.cx, y: safeZone.cy };

  return { centerZone, safeZone, handZone, deckAnchor, safeAnchor, cardW, cardH };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
