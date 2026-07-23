import type { DeckZone } from "./deckZone";

// Что берёт палец, когда нажимает на карты.
//
//   рука вне фокуса — шеренга: тап выделяет / раскрывает; тащить стопку целиком нельзя
//                     в режиме раздачи (колода живёт в центре);
//   рука в фокусе   — веер: отдельные карты (перестановка);
//   центр + dealMode + дилер — карта на раздачу (стопка: верх; веер: под пальцем);
//   центр + freeMode — верхняя карта КАЖДОМУ: в свободе игроки тянут себе сами;
//   центр + dealMode + не-дилер + открытый веер — только peek (ховер/глиссандо, без драга);
//   центр без dealMode — вся колода (перенос в зоны).

export type DragMode = "deck" | "card" | "topCard" | "peek" | "none";

export interface DragContext {
  zone: DeckZone;
  handFocused: boolean;
  draggable: boolean; // двигать колоду целиком (дилер, не dealMode)
  dealMode?: boolean;
  canDeal?: boolean; // дилер может раздавать верхнюю карту
  deckFanned?: boolean; // веер колоды на столе (для peek не-дилера)
  freeMode?: boolean; // режим свободы: колода на столе общая
}

export function dragModeFor({
  zone,
  handFocused,
  draggable,
  dealMode = false,
  canDeal = false,
  deckFanned = false,
  freeMode = false,
}: DragContext): DragMode {
  if (zone === "away") return "none";

  // В режиме раздачи колода в центре: дилер раздаёт, остальные только смотрят веер.
  // В свободе ролей нет — верхнюю карту тянет любой, и открытый веер этому не мешает.
  if (dealMode && zone === "center") {
    if (canDeal || freeMode) return "topCard";
    return deckFanned ? "peek" : "none";
  }

  if (!draggable) return "none";
  if (zone === "hand") return handFocused ? "card" : "deck";
  return "deck";
}
