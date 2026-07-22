import { describe, it, expect } from "vitest";
import { computeLayout } from "./layout";
import { pickDropTarget, dropZoneRegions, pickSeat } from "./dropZones";
import { layoutSeats } from "./seatLayout";

describe("pickDropTarget", () => {
  const layout = computeLayout(800, 600);

  it("центр стола → 'center'", () => {
    expect(pickDropTarget(layout.centerZone.cx, layout.centerZone.cy, layout)).toEqual({ zone: "center" });
  });

  it("зона руки → 'hand' (единственное место, где колода раскрывается веером)", () => {
    expect(pickDropTarget(layout.handAnchor.x, layout.handAnchor.y, layout)).toEqual({ zone: "hand" });
  });

  it("сейф — одна зона: слот выбирать не надо, разложится само", () => {
    expect(pickDropTarget(layout.safeZone.cx, layout.safeZone.cy, layout)).toEqual({ zone: "safe" });
  });

  it("угол канваса вне всех зон → null", () => {
    expect(pickDropTarget(2, 2, layout)).toBeNull();
  });

  it("все зоны доступны для дропа — запретных больше нет", () => {
    const r = dropZoneRegions(layout);
    expect(Object.values(r).every((z) => z.droppable)).toBe(true);
    expect(Object.keys(r).sort()).toEqual(["center", "hand", "safe"]);
  });

  it("рука и сейф не перекрываются: точка в сейфе никогда не «рука»", () => {
    const z = layout.safeZone;
    for (const dy of [-z.h / 3, 0, z.h / 3]) {
      expect(pickDropTarget(z.cx, z.cy + dy, layout)?.zone).toBe("safe");
    }
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
