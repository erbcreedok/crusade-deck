import { describe, it, expect } from "vitest";
import { computeLayout } from "./layout";
import { pickDropTarget, dropZoneRegions, pickSeat, pickDealTarget } from "./dropZones";
import { layoutSeats } from "./seatLayout";

describe("pickDropTarget", () => {
  const layout = computeLayout(800, 600);

  it("центр стола → 'center'", () => {
    expect(pickDropTarget(layout.centerZone.cx, layout.centerZone.cy, layout)).toEqual({ zone: "center" });
  });

  it("зона руки → 'hand' (единственное место, где колода раскрывается веером)", () => {
    expect(pickDropTarget(layout.handAnchor.x, layout.handAnchor.y, layout)).toEqual({ zone: "hand" });
  });


  it("угол канваса вне всех зон → null", () => {
    expect(pickDropTarget(2, 2, layout)).toBeNull();
  });

  it("все зоны доступны для дропа — запретных больше нет", () => {
    const r = dropZoneRegions(layout);
    expect(Object.values(r).every((z) => z.droppable)).toBe(true);
    expect(Object.keys(r).sort()).toEqual(["center", "hand"]);
  });

});

// Место игрока — прямоугольная дроп-зона. Оно вне центра и руки (посадка отжимает их),
// поэтому конфликтов быть не должно, но проверяем явно.
describe("pickSeat — места игроков как дроп-зоны", () => {
  const seats = layoutSeats(["a", "b", "c"], 900, 700).seats;

  it("точка внутри места отдаёт его id", () => {
    const s = seats[1];
    expect(pickSeat(s.rect.cx, s.rect.cy, seats)).toBe("b");
  });

  it("мимо мест — null", () => {
    expect(pickSeat(450, 690, seats)).toBeNull();
  });

  it("пустой стол — null, без падения", () => {
    expect(pickSeat(10, 10, [])).toBeNull();
  });

  it("центр стола не перекрывается местами", () => {
    const { seats: s, insets } = layoutSeats(["a", "b", "c"], 900, 700);
    const l = computeLayout(900, 700, insets);
    expect(pickSeat(l.centerZone.cx, l.centerZone.cy, s)).toBeNull();
  });
});

describe("pickDealTarget — раздача, в том числе себе", () => {
  const layout = computeLayout(800, 600);
  const seats = layoutSeats(["a", "b"], 800, 600).seats;

  it("дроп на чужое место — ему", () => {
    const s = seats[0]!;
    expect(pickDealTarget(s.rect.cx, s.rect.cy, seats, layout, "me")).toBe("a");
  });

  it("дроп в свою полосу руки — себе", () => {
    expect(pickDealTarget(layout.handAnchor.x, layout.handAnchor.y, seats, layout, "me")).toBe("me");
  });

  it("мимо мест и руки — null", () => {
    expect(pickDealTarget(2, 2, seats, layout, "me")).toBeNull();
  });

  it("без selfId рука не принимает", () => {
    expect(pickDealTarget(layout.handAnchor.x, layout.handAnchor.y, seats, layout, null)).toBeNull();
  });

  it("не готовый игрок — дроп-зона выключена", () => {
    const s = seats[0]!;
    const ready = new Set<string>(); // никто не готов
    expect(pickDealTarget(s.rect.cx, s.rect.cy, seats, layout, "me", ready)).toBeNull();
  });

  it("готовый игрок принимает карту", () => {
    const s = seats[0]!;
    const ready = new Set(["a"]);
    expect(pickDealTarget(s.rect.cx, s.rect.cy, seats, layout, "me", ready)).toBe("a");
  });

  it("своя рука всегда принимает (дилер себе), даже без ready", () => {
    const ready = new Set<string>();
    expect(pickDealTarget(layout.handAnchor.x, layout.handAnchor.y, seats, layout, "me", ready)).toBe("me");
  });

  it("в режиме свободы чужие места не принимают карту — только своя рука", () => {
    const s = seats[0]!;
    const ready = new Set(["a"]);
    expect(pickDealTarget(s.rect.cx, s.rect.cy, seats, layout, "me", ready, true)).toBeNull();
    expect(pickDealTarget(layout.handAnchor.x, layout.handAnchor.y, seats, layout, "me", ready, true)).toBe(
      "me",
    );
  });
});
