import { describe, it, expect } from "vitest";
import { computeLayout } from "./layout";
import { pickDropZone, dropZoneRegions } from "./dropZones";

describe("pickDropZone", () => {
  const layout = computeLayout(800, 600);

  it("центр стола → 'center'", () => {
    expect(pickDropZone(layout.center.cx, layout.center.cy, layout)).toBe("center");
  });

  it("точка у нижнего якоря → 'safe'", () => {
    expect(pickDropZone(layout.safeAnchor.x, layout.safeAnchor.y, layout)).toBe("safe");
  });

  it("угол канваса вне всех зон → null", () => {
    expect(pickDropZone(2, 2, layout)).toBeNull();
  });

  it("зоны имеют положительные радиусы и различимы по позиции", () => {
    const r = dropZoneRegions(layout);
    expect(r.center.rx).toBeGreaterThan(0);
    expect(r.safe.ry).toBeGreaterThan(0);
    expect(r.safe.cy).toBeGreaterThan(r.center.cy); // сейф ниже центра
  });
});
