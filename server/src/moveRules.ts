// Перемещение ОДНОЙ карты между боксами стола в режиме свободы: колода, сброс, игральная
// зона, своя рука. Чистая логика — состояние меняет обработчик сообщения.
//
// Правило одно на все пары: карту можно взять из любого бокса и положить в любой, КРОМЕ
// колоды (в свободе колода закрыта на вход — из неё только берут). В чужую руку карта не
// уходит вовсе — это проверяет обработчик (у чистой функции «рука» всегда своя).
//
// Верх стопки/сброса/зоны — последний элемент. Куда карта ляжет стороной вверх решается
// назначением: сброс и зона лежат лицом, рука прячет карту у владельца.

export type PileName = "deck" | "discard" | "play" | "hand";
export type MoveDest = "discard" | "play" | "hand";

export interface Piles {
  deck: string[];
  discard: string[];
  play: string[][];
  hand: string[];
}

export interface MoveRequest {
  card: string;
  from: PileName;
  to: MoveDest;
  /** Для назначения play: в какую кучку класть. Нет/за пределами — новой кучкой. */
  toStack?: number;
}

export interface MoveResult {
  piles: Piles;
  /** Сторона карты в НАЗНАЧЕНИИ: лицом (сброс/зона) или в руку (прячется). */
  faceUp: boolean;
}

function clonePiles(p: Piles): Piles {
  return {
    deck: [...p.deck],
    discard: [...p.discard],
    play: p.play.map((s) => [...s]),
    hand: [...p.hand],
  };
}

/** Убрать карту из источника. null — карты там нет (или источник неизвестен). */
function removeFrom(p: Piles, from: PileName, card: string): Piles | null {
  const next = clonePiles(p);
  switch (from) {
    case "deck":
      if (!next.deck.includes(card)) return null;
      next.deck = next.deck.filter((c) => c !== card);
      return next;
    case "discard":
      if (!next.discard.includes(card)) return null;
      next.discard = next.discard.filter((c) => c !== card);
      return next;
    case "hand":
      if (!next.hand.includes(card)) return null;
      next.hand = next.hand.filter((c) => c !== card);
      return next;
    case "play": {
      const at = next.play.findIndex((s) => s.includes(card));
      if (at < 0) return null;
      next.play[at] = next.play[at].filter((c) => c !== card);
      if (next.play[at].length === 0) next.play.splice(at, 1); // пустая кучка исчезает
      return next;
    }
    default:
      return null;
  }
}

/**
 * Посчитать новое состояние боксов после перемещения карты. null — ход невозможен
 * (карты нет в источнике; в колоду класть нельзя вообще — проверяет вызывающий по типу).
 *
 * Источник и назначение могут совпадать по боксу (реордер внутри зоны/сброса): карта
 * сначала снимается, затем кладётся в назначение — индекс кучки считается уже ПОСЛЕ
 * снятия, поэтому исчезнувшая кучка не сдвигает адресата (за пределами — новой кучкой).
 */
export function resolveMove(p: Piles, m: MoveRequest): MoveResult | null {
  const next = removeFrom(p, m.from, m.card);
  if (!next) return null;
  switch (m.to) {
    case "discard":
      next.discard = [...next.discard, m.card];
      return { piles: next, faceUp: true };
    case "hand":
      next.hand = [...next.hand, m.card];
      return { piles: next, faceUp: false };
    case "play": {
      const i = m.toStack;
      if (i !== undefined && i >= 0 && i < next.play.length) next.play[i].push(m.card);
      else next.play.push([m.card]);
      return { piles: next, faceUp: true };
    }
    default:
      return null;
  }
}
