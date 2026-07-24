// Что берёт палец, когда нажимает на карты.
//
//   рука вне фокуса — шеренга: тап выделяет / раскрывает, тащить стопку целиком нечем;
//   рука в фокусе   — веер: отдельные карты (перестановка);
//   центр + дилер   — карта на раздачу (стопка: верх; веер: под пальцем);
//   центр + свобода — то же самое, но КАЖДОМУ: закрытая колода отдаёт верхнюю карту,
//                     раскрытый веер — ту, что под пальцем;
//   центр + остальные при раскрытом вееере — только peek (ховер/глиссандо, без драга).
//
// Колоды «в руке» и «на чужом месте» здесь больше нет: она всегда лежит в центре стола.

export type DragMode = "card" | "topCard" | "peek" | "none";

export interface DragContext {
  /** Жест начался на своей руке (иначе — на колоде в центре). */
  onHand: boolean;
  handFocused: boolean;
  canDeal?: boolean; // дилер может раздавать верхнюю карту
  deckFanned?: boolean; // веер колоды на столе (для peek не-дилера)
  freeMode?: boolean; // режим свободы: колода на столе общая
}

export function dragModeFor({
  onHand,
  handFocused,
  canDeal = false,
  deckFanned = false,
  freeMode = false,
}: DragContext): DragMode {
  if (onHand) return handFocused ? "card" : "none";
  // Колода в центре: дилер раздаёт, в свободе тянет любой, остальные только смотрят веер.
  // Из раскрытого веера берут карту под пальцем — «верхней» там просто нет.
  if (freeMode) return deckFanned ? "card" : "topCard";
  if (canDeal) return "topCard";
  return deckFanned ? "peek" : "none";
}
