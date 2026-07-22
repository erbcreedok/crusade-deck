import { describe, it, expect } from "vitest";
import { collectHands, DEALER_VOTE_WEIGHT } from "./handRules.js";

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
