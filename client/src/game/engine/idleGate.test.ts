import { describe, expect, it } from "vitest";
import { canSleep, type EngineActivity } from "./idleGate";

// Полный покой: всё стоит, карты доехали.
const QUIET: EngineActivity = {
  shuffle: false,
  scramble: false,
  splash: false,
  pendingShuffle: false,
  flip: false,
  stretch: false,
  notice: false,
  shout: false,
  reject: false,
  flights: 0,
  cardPress: false,
  cardDrag: false,
  collapseBusy: false,
  idle: false,
  fanWiggle: false,
  cardsResting: true,
  handResting: true,
};

describe("canSleep", () => {
  it("в полном покое цикл засыпает", () => {
    expect(canSleep(QUIET)).toBe(true);
  });

  it("любой активный флаг держит цикл бодрым", () => {
    const flags = [
      "shuffle",
      "scramble",
      "splash",
      "pendingShuffle",
      "flip",
      "stretch",
      "notice",
      "shout",
      "reject",
      "cardPress",
      "cardDrag",
      "collapseBusy",
      "idle",
      "fanWiggle",
    ] as const;
    for (const f of flags) {
      expect(canSleep({ ...QUIET, [f]: true }), `${f} должен будить цикл`).toBe(false);
    }
  });

  it("карта в полёте не даёт уснуть", () => {
    expect(canSleep({ ...QUIET, flights: 1 })).toBe(false);
  });

  it("недоехавшие пружины колоды или руки не дают уснуть", () => {
    expect(canSleep({ ...QUIET, cardsResting: false })).toBe(false);
    expect(canSleep({ ...QUIET, handResting: false })).toBe(false);
  });
});
