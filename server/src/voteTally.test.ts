import { describe, expect, it } from "vitest";
import { DEALER_VOTE_WEIGHT } from "./handRules.js";
import { outcome, outcomeOnTimeout, tally, totalWeight, weightOf } from "./voteTally.js";

const dealer = { isDealer: true, connected: true };
const player = { isDealer: false, connected: true };
const away = { isDealer: false, connected: false };

/** Стол:d — дилер, a/b — обычные, z — отключился. */
const TABLE: Record<string, { isDealer: boolean; connected: boolean }> = {
  d: dealer,
  a: player,
  b: player,
  z: away,
};
const voterOf = (id: string) => TABLE[id];

describe("weightOf", () => {
  it("обычный игрок весит 1, дилер — чуть больше", () => {
    expect(weightOf(player)).toBe(1);
    expect(weightOf(dealer)).toBe(DEALER_VOTE_WEIGHT);
  });

  it("отключённый и неизвестный не голосуют", () => {
    expect(weightOf(away)).toBe(0);
    expect(weightOf(undefined)).toBe(0);
  });
});

describe("totalWeight", () => {
  it("считает только подключённых", () => {
    expect(totalWeight(Object.values(TABLE))).toBeCloseTo(2 + DEALER_VOTE_WEIGHT);
  });

  it("пустой стол — нулевой вес", () => {
    expect(totalWeight([])).toBe(0);
  });
});

describe("tally", () => {
  it("складывает «за» и «против» по весам", () => {
    const t = tally(
      [
        ["d", true],
        ["a", false],
      ],
      voterOf,
    );
    expect(t.yes).toBeCloseTo(DEALER_VOTE_WEIGHT);
    expect(t.no).toBe(1);
  });

  it("голос отключившегося не считается ни в одну сторону", () => {
    expect(tally([["z", true]], voterOf)).toEqual({ yes: 0, no: 0 });
  });
});

describe("outcome", () => {
  const total = 2 + DEALER_VOTE_WEIGHT; // d + a + b

  it("пока голосов мало — голосование продолжается", () => {
    expect(outcome({ yes: 1, no: 0 }, total)).toBe("pending");
  });

  it("строгое большинство ВСЕГО веса стола принимает предложение", () => {
    expect(outcome({ yes: 2, no: 0 }, total)).toBe("passed");
  });

  it("ровно половина «за» — ещё не принято (нужно строгое большинство)", () => {
    expect(outcome({ yes: total / 2, no: 0 }, total)).toBe("pending");
  });

  it("половина против — уже отклонено, дожидаться молчунов незачем", () => {
    expect(outcome({ yes: 0, no: total / 2 }, total)).toBe("failed");
  });

  it("двое обычных перевешивают дилера — он решает только ничью", () => {
    expect(outcome({ yes: 2, no: DEALER_VOTE_WEIGHT }, total)).toBe("passed");
    expect(outcome({ yes: DEALER_VOTE_WEIGHT + 1, no: 1 }, total)).toBe("passed");
  });

  it("на пустом столе ничего не принимается", () => {
    expect(outcome({ yes: 0, no: 0 }, 0)).toBe("failed");
  });
});

describe("outcomeOnTimeout", () => {
  it("считаются только поданные голоса, молчуны выпадают", () => {
    expect(outcomeOnTimeout({ yes: 1, no: 0 })).toBe(true);
    expect(outcomeOnTimeout({ yes: 0, no: 1 })).toBe(false);
  });

  it("ничья по времени — предложение не проходит", () => {
    expect(outcomeOnTimeout({ yes: 1, no: 1 })).toBe(false);
  });
});
