import { anim } from "./anim/config";

// Геометрия комнаты из размеров канваса. Чистая математика (тестируется юнитами) —
// движок только рисует по этим числам. Стол больше не рисуется овалом: визуально это
// весь экран. Зоны (центр и рука) — скруглённые прямоугольники во всю ширину.

export interface RoundedRect {
  cx: number;
  cy: number;
  w: number;
  h: number;
  r: number; // радиус скругления углов
}

export interface RoomLayout {
  centerZone: RoundedRect; // общая зона игры (широкая, сверху)
  // Низ экрана — полоса руки во всю ширину. Это единственное место, где колода
  // раскрывается веером.
  handZone: RoundedRect;
  deckAnchor: { x: number; y: number }; // покой колоды в центре = центр centerZone
  handAnchor: { x: number; y: number }; // покой колоды в руке = центр handZone
  cardW: number;
  cardH: number;
}

// Рекомендуемая высота полосы руки: карта плюс кнопка «сложить руку» под ней, плюс
// небольшой запас. Кнопка вписывается в карман под веером (см. collapseButton.ts), и если
// полоса ниже этой суммы, ей просто негде поместиться — карман схлопывается.
export function recommendedHandHeight(cardH: number): number {
  return cardH * HAND_H_RATIO;
}

// Полоса руки собирается из того, что в ней реально лежит (всё в высотах карты):
// сама карта + провис дуги веера + диаметр кнопки «сложить руку» + небольшой запас.
// Раньше полоса брала долю ЭКРАНА (34-40%) и потому на узких экранах выходила
// неоправданно огромной — теперь её высота равна ровно содержимому.
const HAND_SAG = 0.55; // сколько дуге нужно на провис, иначе веер вырождается в прямую
const HAND_SLACK = 0.18;
const HAND_H_RATIO = 1 + HAND_SAG + 2 * anim.fan.collapse.hitRatio + HAND_SLACK;
// Потолок: даже в самом тесном случае рука не должна съедать больше этой доли высоты.
// Если не влезает — уменьшаем КАРТУ, а не раздуваем полосу.
const HAND_H_SHARE = 0.4;

const CARD_RATIO = 0.7; // ширина / высота игральной карты (~2.5" x 3.5")
const CARD_MIN_H = 48;
const CARD_MAX_H = 140;

// Сколько по краям занято чужими местами (посадка «П», см. seatLayout.ts). Центр стола
// ужимается ровно на это: боковые колонки сужают его по ширине, верхняя полоса опускает
// его крышу. Моя рука внизу — не трогается, она всегда моя.
export interface LayoutInsets {
  top: number;
  left: number;
  right: number;
  // Высота панели действий внизу (HTML поверх канваса). Игровые зоны заканчиваются
  // НАД ней: кнопки не должны перекрывать руку.
  bottom?: number;
}

const NO_INSETS: LayoutInsets = { top: 0, left: 0, right: 0, bottom: 0 };

export function computeLayout(w: number, h: number, insets: LayoutInsets = NO_INSETS): RoomLayout {
  const freeBottomRaw = Math.min(Math.max(0, insets.bottom ?? 0), h * 0.5);
  // Карта масштабируется от меньшей стороны канваса, с потолком/полом. Но есть второй
  // ограничитель: полоса руки должна вместить карту с кнопкой и при этом не съесть
  // пол-экрана. На узком/низком экране режем именно КАРТУ — иначе полоса раздувалась
  // до трети экрана просто потому, что «так положено по высоте карты».
  const byScreen = Math.min(w, h) * 0.16;
  const byHandBand = ((h - freeBottomRaw) * HAND_H_SHARE) / HAND_H_RATIO;
  const cardH = clamp(Math.min(byScreen, byHandBand), CARD_MIN_H, CARD_MAX_H);
  const cardW = cardH * CARD_RATIO;

  // Зоны занимают почти всю ширину (≥80%) — удобнее целиться и дропать.
  const zoneW = Math.max(0, w * 0.86);
  const r = 18;

  const freeLeft = Math.min(insets.left, w * 0.4);
  const freeRight = Math.min(insets.right, w * 0.4);
  const freeTop = Math.min(insets.top, h * 0.4);

  // Нижняя полоса: одна горизонталь на всю ширину зоны, поделённая по вертикали.
  // Панель действий забирает низ экрана; клампим её вклад, чтобы даже абсурдная панель
  // не схлопнула полосу в ноль.
  const freeBottom = freeBottomRaw;
  const minBandH = recommendedHandHeight(cardH);
  const bandSpace = Math.max(minBandH, h - freeBottom);
  // Высота полосы = ровно её содержимое. Потолок оставлен страховкой на абсурдные экраны.
  const bandH = Math.min(minBandH, Math.max(minBandH, bandSpace * HAND_H_SHARE));
  const bandCy = h - freeBottom - bandH / 2 - h * 0.02;
  const bandLeft = (w - zoneW) / 2;
  // Рука занимает полосу целиком: других личных зон внизу больше нет.
  const handW = Math.max(cardW, zoneW);
  const handZone: RoundedRect = { cx: bandLeft + handW / 2, cy: bandCy, w: handW, h: bandH, r };

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
    deckAnchor,
    handAnchor,
    cardW,
    cardH,
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
