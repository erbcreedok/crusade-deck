// Игральная зона глазами движка.
//
// Движок умеет ровно одну вещь — стопку карт с раскладкой (`engine/CardPile`): колода,
// рука и сброс это она же с разными «где лежит карта номер i». Зона — четвёртая такая
// стопка, просто раскладка у неё двумерная: плоский номер карты превращается в «кучка k,
// в ней j-я снизу», а куда попадёт сама кучка, считает playGrid.
//
// Разворачивать зону в ОДИН плоский порядок принципиально: тогда карты в ней живут теми
// же спрайтами по идентичности, что и везде, и переезд карты между кучками играется
// перелётом, а не телепортацией.

export interface PlaySlot {
  stack: number; // индекс кучки в зоне
  within: number; // какая по счёту снизу внутри кучки
  of: number; // сколько всего карт в этой кучке
}

export interface FlatPlay {
  order: string[];
  /** Место карты `order[i]` — тот же индекс. */
  slots: PlaySlot[];
}

export function flattenPlay(stacks: readonly (readonly string[])[]): FlatPlay {
  const order: string[] = [];
  const slots: PlaySlot[] = [];
  stacks.forEach((cards, stack) => {
    cards.forEach((card, within) => {
      order.push(card);
      slots.push({ stack, within, of: cards.length });
    });
  });
  return { order, slots };
}
