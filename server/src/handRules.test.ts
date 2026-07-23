import { describe, it, expect } from "vitest";
import {
  collectHands,
  dealCardTo,
  takeTopCard,
  takeCardAt,
  takeAllCards,
  discardCard,
  collectOrder,
  DEALER_VOTE_WEIGHT,
} from "./handRules.js";

describe("collectHands", () => {
  const hands = { alice: ["A♠", "2♠"], bob: ["K♦"] };

  it("сгребает все карты из рук обратно в колоду", () => {
    const out = collectHands(["3♣"], hands);
    expect([...out.deck].sort()).toEqual(["2♠", "3♣", "A♠", "K♦"].sort());
    expect(out.deck.length).toBe(4);
  });

  it("карты из рук ложатся ПОД уже лежащие в колоде — колода не перемешивается", () => {
    expect(collectHands(["3♣"], hands).deck[0]).toBe("3♣"); // прежняя колода сверху
  });

  it("собранные карты становятся скрытыми — рубашкой вверх", () => {
    const out = collectHands(["3♣"], hands);
    for (const card of out.deck) expect(out.faceUp[card]).toBe(false);
  });

  it("порядок внутри руки сохраняется", () => {
    const out = collectHands([], { alice: ["A♠", "2♠", "3♠"] });
    expect(out.deck).toEqual(["A♠", "2♠", "3♠"]);
  });

  it("пустые руки и пустая колода безопасны", () => {
    expect(collectHands([], {})).toEqual({ deck: [], faceUp: {} });
    expect(collectHands(["A♠"], { alice: [] }).deck).toEqual(["A♠"]);
  });
});

describe("discardCard", () => {
  const hand = ["A♠", "2♠", "3♠"];

  it("карта уходит из руки на верх сброса", () => {
    const out = discardCard(hand, ["K♦"], "2♠");
    expect(out).toEqual({ hand: ["A♠", "3♠"], discard: ["K♦", "2♠"] });
  });

  it("порядок остальных карт руки не меняется", () => {
    expect(discardCard(hand, [], "A♠")!.hand).toEqual(["2♠", "3♠"]);
  });

  it("чужую или несуществующую карту скинуть нельзя", () => {
    expect(discardCard(hand, [], "K♦")).toBeNull();
    expect(discardCard([], [], "A♠")).toBeNull();
  });

  it("исходные стопки не мутируются", () => {
    const h = [...hand];
    const d = ["K♦"];
    discardCard(h, d, "A♠");
    expect(h).toEqual(hand);
    expect(d).toEqual(["K♦"]);
  });
});

describe("DEALER_VOTE_WEIGHT", () => {
  it("голос дилера весит чуть больше обычного — перевес, а не власть", () => {
    expect(DEALER_VOTE_WEIGHT).toBeGreaterThan(1);
    expect(DEALER_VOTE_WEIGHT).toBeLessThan(1.1);
  });

  it("двое обычных игроков перевешивают дилера", () => {
    expect(2).toBeGreaterThan(DEALER_VOTE_WEIGHT);
  });
});

describe("dealCardTo", () => {
  const deck = ["A♠", "2♠", "3♠"];

  it("раздаёт ровно одну карту: из колоды ушла, в руку пришла", () => {
    const out = dealCardTo(deck, "3♠");
    expect(out).not.toBeNull();
    expect(out!.deck).toEqual(["A♠", "2♠"]);
    expect(out!.card).toBe("3♠");
  });

  it("порядок остальных карт колоды не меняется", () => {
    const out = dealCardTo(deck, "2♠");
    expect(out!.deck).toEqual(["A♠", "3♠"]);
  });

  it("карты нет в колоде — раздачи нет", () => {
    expect(dealCardTo(deck, "K♦")).toBeNull();
    expect(dealCardTo([], "A♠")).toBeNull();
  });

  it("исходная колода не мутируется", () => {
    const src = [...deck];
    dealCardTo(src, "A♠");
    expect(src).toEqual(deck);
  });
});

describe("takeTopCard", () => {
  // Верх колоды — последний элемент массива (см. topCard.ts на клиенте и deckStack).
  const deck = ["6♣", "K♦", "A♠"];

  it("снимает верхнюю карту — последнюю в массиве", () => {
    expect(takeTopCard(deck)).toEqual({ deck: ["6♣", "K♦"], card: "A♠" });
  });

  it("два снятия подряд дают РАЗНЫЕ карты: кто раньше, тот и взял верхнюю", () => {
    const first = takeTopCard(deck)!;
    const second = takeTopCard(first.deck)!;
    expect(first.card).toBe("A♠");
    expect(second.card).toBe("K♦");
    expect([...second.deck, second.card, first.card].sort()).toEqual([...deck].sort());
  });

  it("пустая колода — брать нечего", () => {
    expect(takeTopCard([])).toBeNull();
  });

  it("исходная колода не мутируется", () => {
    const src = [...deck];
    takeTopCard(src);
    expect(src).toEqual(deck);
  });
});

describe("takeCardAt", () => {
  const deck = ["6♣", "K♦", "A♠"];

  it("снимает карту с указанной позиции", () => {
    expect(takeCardAt(deck, 0)).toEqual({ deck: ["K♦", "A♠"], card: "6♣" });
    expect(takeCardAt(deck, 1)).toEqual({ deck: ["6♣", "A♠"], card: "K♦" });
  });

  it("верх колоды — частный случай последней позиции", () => {
    expect(takeCardAt(deck, deck.length - 1)).toEqual(takeTopCard(deck));
  });

  it("позиция вне колоды — брать нечего", () => {
    expect(takeCardAt(deck, -1)).toBeNull();
    expect(takeCardAt(deck, 3)).toBeNull();
    expect(takeCardAt(deck, 1.5)).toBeNull();
    expect(takeCardAt(deck, Number.NaN)).toBeNull();
    expect(takeCardAt([], 0)).toBeNull();
  });

  it("исходная колода не мутируется", () => {
    const src = [...deck];
    takeCardAt(src, 1);
    expect(src).toEqual(deck);
  });
});

describe("takeAllCards", () => {
  const deck = ["6♣", "K♦", "A♠"];

  it("забирает всю колоду: сверху вниз, как если бы тянули по одной", () => {
    expect(takeAllCards(deck)).toEqual({ deck: [], cards: ["A♠", "K♦", "6♣"] });
  });

  it("пустая колода — забирать нечего", () => {
    expect(takeAllCards([])).toBeNull();
  });

  it("исходная колода не мутируется", () => {
    const src = [...deck];
    takeAllCards(src);
    expect(src).toEqual(deck);
  });
});

describe("collectOrder", () => {
  const seats = ["a", "b", "c", "d"];

  it("начинает с дилера и идёт по кругу", () => {
    expect(collectOrder(seats, "c")).toEqual(["c", "d", "a", "b"]);
    expect(collectOrder(seats, "a")).toEqual(seats);
  });

  it("облетает каждое место ровно один раз", () => {
    const out = collectOrder(seats, "b");
    expect(out.length).toBe(seats.length);
    expect([...out].sort()).toEqual([...seats].sort());
  });

  it("дилера в круге нет — порядок остаётся стабильным", () => {
    expect(collectOrder(seats, "нет-такого")).toEqual(seats);
    expect(collectOrder([], "a")).toEqual([]);
  });
});
