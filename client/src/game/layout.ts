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
  // Низ экрана — одна горизонтальная полоса, поделённая ПО ВЕРТИКАЛИ:
  // рука слева (80%) и сейф справа (20%). Рука — единственное место, где колода
  // раскрывается веером; сейф — визуальный «сейф» под личные колоды, там карты
  // всегда рубашкой вверх и веера не бывает.
  handZone: RoundedRect;
  // Сейф — ОДНА зона. Колоды внутри раскладываются сами (см. safeStacks.ts): фиксиро-
  // ванных полок нет, сколько влезет — столько и будет.
  safeZone: RoundedRect;
  deckAnchor: { x: number; y: number }; // покой колоды в центре = центр centerZone
  handAnchor: { x: number; y: number }; // покой колоды в руке = центр handZone
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
  // Высота панели действий внизу (HTML поверх канваса). Игровые зоны заканчиваются
  // НАД ней: кнопки не должны перекрывать ни руку, ни сейф.
  bottom?: number;
}

const NO_INSETS: LayoutInsets = { top: 0, left: 0, right: 0, bottom: 0 };

export interface LayoutOptions {
  // Рука выделена: она разъезжается на всю полосу и накрывает сейф. Сам сейф остаётся
  // узкой полоской у правого края (движок рисует его позади карт руки).
  handFocused?: boolean;
}

// Доли полосы под руку: обычно 80%, в фокусе — вся полоса, а сейфу остаётся 5%.
const HAND_SHARE_IDLE = 0.8;
const SAFE_SHARE_FOCUSED = 0.05;

export function computeLayout(
  w: number,
  h: number,
  insets: LayoutInsets = NO_INSETS,
  opts: LayoutOptions = {},
): RoomLayout {
  // Карта масштабируется от меньшей стороны канваса, с потолком/полом.
  const cardH = clamp(Math.min(w, h) * 0.16, CARD_MIN_H, CARD_MAX_H);
  const cardW = cardH * CARD_RATIO;

  // Зоны занимают почти всю ширину (≥80%) — удобнее целиться и дропать.
  const zoneW = Math.max(0, w * 0.86);
  const r = 18;

  const freeLeft = Math.min(insets.left, w * 0.4);
  const freeRight = Math.min(insets.right, w * 0.4);
  const freeTop = Math.min(insets.top, h * 0.4);

  // Нижняя полоса: одна горизонталь на всю ширину зоны, поделённая по вертикали.
  // Рука широкая (в ней веер, ей нужно место), сейф узкий — это «сейф», а не стол.
  // Панель действий забирает низ экрана; клампим её вклад, чтобы даже абсурдная панель
  // не схлопнула полосу в ноль.
  const freeBottom = Math.min(Math.max(0, insets.bottom ?? 0), h * 0.5);
  const bandSpace = Math.max(cardH * 1.5, h - freeBottom);
  const bandH = clamp(bandSpace * 0.34, cardH * 1.5, Math.max(cardH * 1.5, bandSpace * 0.4));
  const bandCy = h - freeBottom - bandH / 2 - h * 0.02;
  const bandLeft = (w - zoneW) / 2;
  const gap = 10;
  const focused = !!opts.handFocused;
  // В фокусе рука забирает полосу целиком; сейф остаётся полоской у правого края и
  // уходит под карты — он никуда не девается, просто перестаёт мешать вееру.
  const handW = focused ? zoneW : Math.max(cardW, zoneW * HAND_SHARE_IDLE - gap / 2);
  const safeW = focused
    ? Math.max(8, zoneW * SAFE_SHARE_FOCUSED)
    : Math.max(cardW * 0.6, zoneW * (1 - HAND_SHARE_IDLE) - gap / 2);

  const handZone: RoundedRect = { cx: bandLeft + handW / 2, cy: bandCy, w: handW, h: bandH, r };
  const safeZone: RoundedRect = {
    // Правый край полосы у сейфа общий в обоих состояниях — он просто ужимается к нему.
    cx: bandLeft + zoneW - safeW / 2,
    cy: bandCy,
    w: safeW,
    h: bandH,
    r,
  };

  // Центр живёт в прямоугольнике, оставшемся между посадкой сверху и полосой снизу.
  // Клампы держат его живым даже при абсурдных отступах — лучше тесный центр, чем нулевой.
  const centerW = Math.max(cardW * 1.2, Math.min(zoneW, w - freeLeft - freeRight - 16));
  const centerCx = freeLeft + (w - freeLeft - freeRight) / 2;
  const centerTop = freeTop + 8;
  const centerBottom = bandCy - bandH / 2 - 8;
  const centerH = Math.max(cardH * 1.2, Math.min(centerBottom - centerTop, h * 0.42));
  const centerCy = centerTop + Math.max(centerH / 2, (centerBottom - centerTop) / 2);
  const centerZone: RoundedRect = { cx: centerCx, cy: centerCy, w: centerW, h: centerH, r };

  const deckAnchor = { x: centerZone.cx, y: centerZone.cy };
  const handAnchor = { x: handZone.cx, y: handZone.cy };

  return {
    centerZone,
    handZone,
    safeZone,
    deckAnchor,
    handAnchor,
    cardW,
    cardH,
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
