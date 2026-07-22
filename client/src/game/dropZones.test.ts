import { describe, it, expect } from "vitest";
import { computeLayout } from "./layout";
import { pickDropZone, dropZoneRegions, pickSeat } from "./dropZones";
import { layoutSeats } from "./seatLayout";

describe("pickDropZone", () => {
  const layout = computeLayout(800, 600);

  it("центр зоны игры → 'center'", () => {
    expect(pickDropZone(layout.centerZone.cx, layout.centerZone.cy, layout)).toBe("center");
  });

  it("центр сейф-зоны → 'safe'", () => {
    expect(pickDropZone(layout.safeAnchor.x, layout.safeAnchor.y, layout)).toBe("safe");
  });

  it("зона руки у нижнего края → 'hand'", () => {
    expect(pickDropZone(layout.handZone.cx, layout.handZone.cy, layout)).toBe("hand");
  });

  it("угол канваса вне всех зон → null", () => {
    expect(pickDropZone(2, 2, layout)).toBeNull();
  });

  it("center/safe можно дропать, hand — пока нельзя", () => {
    const r = dropZoneRegions(layout);
    expect(r.center.droppable).toBe(true);
    expect(r.safe.droppable).toBe(true);
    expect(r.hand.droppable).toBe(false);
  });
});

// Место игрока — прямоугольная дроп-зона. Оно вне центра/сейфа (посадка отжимает их),
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
