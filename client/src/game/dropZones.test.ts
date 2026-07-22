import { describe, it, expect } from "vitest";
import { computeLayout } from "./layout";
import { pickDropZone, dropZoneRegions } from "./dropZones";

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
