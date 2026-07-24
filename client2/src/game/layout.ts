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
  // Общая зона игры. В раздаче — весь стол целиком (там же лежит колода); в игре —
  // только средний бокс, между слотом колоды слева и слотом сброса справа.
  centerZone: RoundedRect;
  // Слоты игрового стола. null в раздаче: пока дилер раздаёт, стол не размечен, колода
  // лежит по центру и с неё раздают.
  deckSlot: RoundedRect | null; // слева: там лежит колода, оттуда её тянут
  discardSlot: RoundedRect | null; // справа: сброс
  // Низ экрана — полоса руки во всю ширину. Это единственное место, где колода
  // раскрывается веером.
  handZone: RoundedRect;
  deckAnchor: { x: number; y: number }; // покой колоды: центр стола в раздаче, свой слот в игре
  // Единое место, где раскрывается ЛЮБОЙ веер доски (колода, сброс, будущие стопки) —
  // центр игровой зоны. Стопки лежат по своим слотам, но раскрываются всегда здесь: так
  // раскрытый веер не свисает с края стола и всегда там, где его ждёт глаз.
  boardFanAnchor: { x: number; y: number };
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

// Карта масштабируется от меньшей стороны канваса, с потолком/полом. Но есть второй
// ограничитель: полоса руки должна вместить карту с кнопкой и при этом не съесть
// пол-экрана. На узком/низком экране режем именно КАРТУ — иначе полоса раздувалась
// до трети экрана просто потому, что «так положено по высоте карты».
function cardHeight(w: number, h: number, freeBottom: number): number {
  const byScreen = Math.min(w, h) * 0.16;
  const byHandBand = ((h - freeBottom) * HAND_H_SHARE) / HAND_H_RATIO;
  return clamp(Math.min(byScreen, byHandBand), CARD_MIN_H, CARD_MAX_H);
}

/**
 * Ширина ЛЮБОГО бокового элемента стола: слота колоды, слота сброса и места соседа.
 *
 * Число одно на всех и намеренно: колода, сброс и сосед стоят одной колонкой у края, и
 * разнобой в их ширинах читается как случайность, а не как разметка. Эталон — колода:
 * она единственная, чей размер продиктован содержимым (в неё кладут карту), остальные
 * равняются на неё. Сброс держит эту ширину и пустым — бокс размечает стол, а не
 * показывает, сколько в нём карт.
 *
 * Живёт здесь, а не в seatLayout, потому что считается от КАРТЫ, а карта — забота
 * раскладки стола. Посадка мест просто спрашивает это число (см. RoomEngine.applySeats).
 */
export function boardSlotWidth(w: number, h: number, bottomInset = 0): number {
  const freeBottom = Math.min(Math.max(0, bottomInset), h * 0.5);
  return cardHeight(w, h, freeBottom) * CARD_RATIO * SLOT_PAD;
}

/**
 * Ширина от КРАЯ ЭКРАНА до внешнего края слота колоды — то есть слот плюс поле, на
 * котором стол заканчивается. Столько занимает место бокового соседа: он стоит над
 * слотом, и оставлять справа от него полоску голого сукна незачем — соседа и слот видно
 * как одну колонку, приклеенную к краю.
 */
export function boardEdgeWidth(w: number, h: number, bottomInset = 0): number {
  const freeBottom = Math.min(Math.max(0, bottomInset), h * 0.5);
  const cardW = cardHeight(w, h, freeBottom) * CARD_RATIO;
  return bandPadFor(cardW) + cardW * SLOT_PAD;
}

/** Зазор между верхом стола и тем, что над ним. Общий для стола и посадки соседей. */
export const BOARD_TOP_GAP = 8;

// Поля по краям — от КАРТЫ, а не константа: стопка колоды рисуется со сдвигом влево-вниз
// (нижняя карта выглядывает из-под верхней, см. deckStack.ts), и при поле в пару пикселей
// этот «хвост» свисал за край экрана.
function bandPadFor(cardW: number): number {
  return Math.max(8, cardW * 0.35);
}

// Сколько по краям занято чужими местами (посадка «П», см. seatLayout.ts). Центр стола
// ужимается ровно на это: боковые колонки сужают его по ширине, верхняя полоса опускает
// его крышу. Моя рука внизу — не трогается, она всегда моя.
export interface LayoutInsets {
  top: number;
  left?: number;
  right?: number;
  /**
   * Сколько по вертикали занято боковыми местами (соседями по кругу). Стол по ширине они
   * НЕ режут: на узком экране это схлопнуло бы игровую зону в щель. Вместо этого им
   * уступают крайние боксы — колода съезжает ниже, сброс становится ниже ростом.
   */
  side?: number;
  // Высота панели действий внизу (HTML поверх канваса). Игровые зоны заканчиваются
  // НАД ней: кнопки не должны перекрывать руку.
  bottom?: number;
}

const NO_INSETS: LayoutInsets = { top: 0, left: 0, right: 0, side: 0, bottom: 0 };

/**
 * `gameMode` — стол после «ГОУ!»: середина делится на три бокса (колода слева, игра по
 * центру, сброс справа). В раздаче деления нет: колода в центре, дилер раздаёт с неё.
 */
export function computeLayout(
  w: number,
  h: number,
  insets: LayoutInsets = NO_INSETS,
  gameMode = false,
): RoomLayout {
  const freeBottomRaw = Math.min(Math.max(0, insets.bottom ?? 0), h * 0.5);
  const cardH = cardHeight(w, h, freeBottomRaw);
  const cardW = cardH * CARD_RATIO;

  // Зоны занимают почти всю ширину (≥80%) — удобнее целиться и дропать.
  const zoneW = Math.max(0, w * 0.86);
  const r = 18;

  const freeLeft = Math.min(insets.left ?? 0, w * 0.4);
  const freeRight = Math.min(insets.right ?? 0, w * 0.4);
  const freeTop = Math.min(insets.top, h * 0.4);
  const sideH = Math.min(Math.max(0, insets.side ?? 0), h * 0.3);

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
  // В раздаче под боковых уходит вся крыша: колода лежит по центру, и делить ей нечего —
  // проще опустить стол целиком. В игре так нельзя (игровая зона в середине, соседи по
  // краям, они не пересекаются) — там уступают только крайние боксы, см. splitGameTable.
  const centerTop = freeTop + BOARD_TOP_GAP + (gameMode ? 0 : sideH);
  const centerBottom = bandCy - bandH / 2 - 8;
  const centerH = Math.max(cardH * 1.2, Math.min(centerBottom - centerTop, h * 0.42));
  const centerCy = centerTop + Math.max(centerH / 2, (centerBottom - centerTop) / 2);
  const centerZone: RoundedRect = { cx: centerCx, cy: centerCy, w: centerW, h: centerH, r };

  const handAnchor = { x: handZone.cx, y: handZone.cy };

  const boardFanAnchor = { x: centerZone.cx, y: centerZone.cy };

  if (!gameMode) {
    return {
      centerZone,
      deckSlot: null,
      discardSlot: null,
      handZone,
      deckAnchor: { x: centerZone.cx, y: centerZone.cy },
      boardFanAnchor,
      handAnchor,
      cardW,
      cardH,
    };
  }

  // Игровой стол шире «центра»: боксы колоды и сброса уезжают к самым краям свободной
  // области, освобождая середину под веер. Центр же остаётся зоной игры.
  const bandPad = bandPadFor(cardW);
  const gameBand: RoundedRect = {
    cx: (freeLeft + (w - freeRight)) / 2,
    cy: centerZone.cy,
    w: Math.max(centerZone.w, w - freeLeft - freeRight - 2 * bandPad),
    h: centerZone.h,
    r,
  };
  const table = splitGameTable(gameBand, cardW, cardH, sideH);
  return {
    centerZone: table.play,
    deckSlot: table.deck,
    discardSlot: table.discard,
    handZone,
    deckAnchor: { x: table.deck.cx, y: table.deck.cy },
    // Веер доски раскрывается в игровой зоне — не над слотом колоды, где он свисал бы
    // за левый край стола.
    boardFanAnchor: { x: table.play.cx, y: table.play.cy },
    handAnchor,
    cardW,
    cardH,
  };
}

// Ширина боковых слотов: стопка карт с запасом. В игре стопки лежат обычным размером
// (deckScale(true) === 1), поэтому слоту хватает карты плюс поля. Сброс раньше был поуже
// колоды — теперь ширина у боковых элементов стола общая, см. boardSlotWidth.
const SLOT_PAD = 1.25;
// Игровая зона всегда шире слотов — это главный бокс стола, туда будут ложиться карты.
const PLAY_MIN_RATIO = 1.15;

/**
 * Разделить полосу стола на три бокса: колода — игра — сброс.
 *
 * Слоты считаются от карты, а остаток отдаётся игровой зоне: на широком экране она просто
 * растёт, а на узком слоты ужимаются вместе с ней, но игровая зона всё равно остаётся
 * самым широким боксом — иначе стол читался бы как три равные ячейки без главной.
 */
function splitGameTable(
  band: RoundedRect,
  cardW: number,
  cardH: number,
  sideH = 0,
): { deck: RoundedRect; play: RoundedRect; discard: RoundedRect } {
  const gap = Math.max(6, cardW * 0.12);
  const want = cardW * SLOT_PAD;
  // Что останется игре, если взять слоты желаемого размера. Не хватает — режем слоты,
  // но ОБА одинаково: ширина у колоды и сброса общая и остаётся общей в любой тесноте.
  const free = band.w - 2 * gap;
  const shrink = Math.min(1, free / (2 * want + cardW * PLAY_MIN_RATIO));
  const slotW = Math.max(cardW, want * shrink);
  const deckW = slotW;
  const discardW = slotW;
  const playW = Math.max(cardW * 1.05, free - deckW - discardW);
  const deckH = Math.min(band.h, Math.max(cardH * SLOT_PAD, cardH));

  const left = band.cx - band.w / 2;
  const top = band.cy - band.h / 2;
  const bottom = band.cy + band.h / 2;

  // Крайние боксы уступают верх боковым местам — они стоят ровно над ними. Уступают
  // по-разному, потому что и устроены по-разному: колода — компактный бокс, ей достаточно
  // съехать ниже; сброс — колонка во всю высоту, ему остаётся стать ниже ростом.
  const deckCy = Math.min(band.cy + sideH / 2, bottom - deckH / 2);
  const discardH = Math.max(cardH, band.h - sideH);
  const discardCy = Math.min(top + sideH + discardH / 2, bottom - discardH / 2);

  const deck: RoundedRect = { cx: left + deckW / 2, cy: deckCy, w: deckW, h: deckH, r: band.r };
  const play: RoundedRect = { cx: left + deckW + gap + playW / 2, cy: band.cy, w: playW, h: band.h, r: band.r };
  const discard: RoundedRect = {
    cx: left + deckW + gap + playW + gap + discardW / 2,
    cy: discardCy,
    w: discardW,
    h: discardH,
    r: band.r,
  };
  return { deck, play, discard };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
