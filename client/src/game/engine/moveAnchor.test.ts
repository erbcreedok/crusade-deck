import { describe, expect, it } from "vitest";
import { cardMoveAnchor } from "./moveAnchor";
import { computeLayout } from "../layout";
import type { SeatBox } from "../seatLayout";

const layout = computeLayout(390, 800, undefined, true); // игра: есть слоты доски
const seats: SeatBox[] = [{ id: "bob", side: "top", rect: { cx: 100, cy: 60, w: 80, h: 90, r: 8 } }];
const ctx = { layout, selfId: "me", seats };

describe("cardMoveAnchor", () => {
  it("колода — свой якорь", () => {
    expect(cardMoveAnchor("deck", ctx)).toMatchObject({ x: layout.deckAnchor.x, y: layout.deckAnchor.y });
  });

  it("сброс — слот сброса", () => {
    const a = cardMoveAnchor("discard", ctx);
    expect(a.x).toBeCloseTo(layout.discardSlot!.cx, 5);
  });

  it("зона (play и play:N) — центр доски, а НЕ колода", () => {
    for (const p of ["play", "play:2"]) {
      const a = cardMoveAnchor(p, ctx);
      expect(a.x).toBeCloseTo(layout.boardFanAnchor.x, 5);
      expect(Math.abs(a.x - layout.deckAnchor.x) + Math.abs(a.y - layout.deckAnchor.y)).toBeGreaterThan(1);
    }
  });

  it("своя рука — по selfId", () => {
    expect(cardMoveAnchor("me", ctx)).toMatchObject({ x: layout.handAnchor.x, y: layout.handAnchor.y });
  });

  it("место соседа — его бокс", () => {
    expect(cardMoveAnchor("bob", ctx)).toMatchObject({ x: 100, y: 60 });
  });

  it("неизвестная метка — центр стола, а не колода", () => {
    const a = cardMoveAnchor("???", ctx);
    expect(a.x).toBeCloseTo(layout.centerZone.cx, 5);
    expect(a.y).toBeCloseTo(layout.centerZone.cy, 5);
  });
});
