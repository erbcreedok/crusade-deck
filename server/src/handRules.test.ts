import { describe, it, expect } from "vitest";
import { collectHands, dealCardTo, collectOrder, DEALER_VOTE_WEIGHT } from "./handRules.js";

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
