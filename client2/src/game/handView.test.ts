import { describe, it, expect } from "vitest";
import { handLayout, cardView } from "./handView";

const owner = { isOwner: true, handOpen: false, hidden: false, focused: false, index: 0, count: 5 };

describe("handLayout", () => {
  it("своя рука: вне фокуса — шеренга, в фокусе — веер", () => {
    expect(handLayout(true, false)).toBe("row");
    expect(handLayout(true, true)).toBe("fan");
  });

  it("чужая рука: вне фокуса — просто стопка, в фокусе — ряд карт", () => {
    expect(handLayout(false, false)).toBe("stack");
    expect(handLayout(false, true)).toBe("row");
  });
});

describe("cardView", () => {
  it("свои карты видны всегда — и при закрытой руке, и спрятанные", () => {
    expect(cardView({ ...owner })).toBe("face");
    expect(cardView({ ...owner, hidden: true })).toBe("face");
    expect(cardView({ ...owner, focused: true })).toBe("face");
  });

  it("чужая закрытая рука — только рубашки", () => {
    expect(cardView({ ...owner, isOwner: false })).toBe("back");
    expect(cardView({ ...owner, isOwner: false, focused: true })).toBe("back");
  });

  it("спрятанную карту чужой не видит вообще — ни лица, ни рубашки", () => {
    expect(cardView({ ...owner, isOwner: false, hidden: true })).toBe("none");
    expect(cardView({ ...owner, isOwner: false, hidden: true, handOpen: true, focused: true })).toBe("none");
  });

  it("открытая рука в фокусе видна всем целиком, в том же порядке", () => {
    for (let i = 0; i < 5; i++) {
      expect(cardView({ ...owner, isOwner: false, handOpen: true, focused: true, index: i })).toBe("face");
    }
  });

  it("открытая рука ВНЕ фокуса показывает чужим только последнюю карту", () => {
    const args = { ...owner, isOwner: false, handOpen: true, focused: false, count: 5 };
    expect(cardView({ ...args, index: 4 })).toBe("face");
    for (const i of [0, 1, 2, 3]) expect(cardView({ ...args, index: i })).toBe("back");
  });

  it("рука из одной карты: она же и последняя", () => {
    expect(cardView({ isOwner: false, handOpen: true, hidden: false, focused: false, index: 0, count: 1 })).toBe(
      "face",
    );
  });
});
