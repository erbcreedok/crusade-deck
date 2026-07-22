import { describe, it, expect } from "vitest";
import { seatHandKind, seatCardFaceUp, layoutSeatHand } from "./seatHand";

const rect = { cx: 200, cy: 80, w: 120, h: 90 };

describe("seatHandKind", () => {
  it("вне раздачи и при пустой руке ничего не рисуем", () => {
    expect(seatHandKind(false, 5, true)).toBe("empty");
    expect(seatHandKind(true, 0, true)).toBe("empty");
  });

  it("раскладку задаёт только веер, не handOpen", () => {
    expect(seatHandKind(true, 3, false)).toBe("stack");
    expect(seatHandKind(true, 3, true)).toBe("fan");
  });
});

describe("seatCardFaceUp", () => {
  it("открытая рука — лица, закрытая — рубашки", () => {
    expect(seatCardFaceUp(true)).toBe(true);
    expect(seatCardFaceUp(false)).toBe(false);
  });
});

describe("layoutSeatHand", () => {
  const base = {
    rect,
    tableCardW: 70,
    tableCardH: 100,
    seatScale: 0.45,
    dealMode: true,
  };

  it("пустая — без карт и без счётчика", () => {
    const L = layoutSeatHand({ ...base, count: 0, handFanned: false });
    expect(L.kind).toBe("empty");
    expect(L.cards).toHaveLength(0);
    expect(L.counter).toBeNull();
  });

  it("без веера — стопка", () => {
    const L = layoutSeatHand({ ...base, count: 5, handFanned: false });
    expect(L.kind).toBe("stack");
    expect(L.cards).toHaveLength(5);
    expect(L.counter).not.toBeNull();
  });

  it("с веером — веер из count карт + счётчик", () => {
    const L = layoutSeatHand({ ...base, count: 4, handFanned: true });
    expect(L.kind).toBe("fan");
    expect(L.cards).toHaveLength(4);
    expect(L.cards[0]!.x).toBeLessThan(L.cards[3]!.x);
    expect(L.counter).not.toBeNull();
  });
});
