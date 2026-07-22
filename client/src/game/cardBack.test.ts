import { describe, it, expect } from "vitest";
import { CARD_BACKS, isCardBackId, latticeCenters, mosaicTiles } from "./cardBack";

const W = 160;
const H = 228;

describe("CARD_BACKS", () => {
  it("пока два скина, id уникальны и у каждого есть подпись", () => {
    expect(CARD_BACKS.length).toBe(2);
    expect(new Set(CARD_BACKS.map((s) => s.id)).size).toBe(2);
    for (const s of CARD_BACKS) expect(s.label.length).toBeGreaterThan(0);
  });

  it("isCardBackId отсеивает мусор из localStorage", () => {
    expect(isCardBackId("ruby")).toBe(true);
    expect(isCardBackId("mosaic")).toBe(true);
    expect(isCardBackId("нет такого")).toBe(false);
    expect(isCardBackId(null)).toBe(false);
  });
});

describe("latticeCenters", () => {
  const pts = latticeCenters(W, H, 4, 6, 20);

  it("сетка нужного размера", () => {
    expect(pts.length).toBe(24);
  });

  it("все центры внутри поля с отступом", () => {
    for (const p of pts) {
      expect(p.x).toBeGreaterThanOrEqual(20);
      expect(p.x).toBeLessThanOrEqual(W - 20);
      expect(p.y).toBeGreaterThanOrEqual(20);
      expect(p.y).toBeLessThanOrEqual(H - 20);
    }
  });

  it("шахматный признак чередуется по столбцам и строкам — ромбы и квадраты вперемешку", () => {
    const at = (col: number, row: number) => pts[row * 4 + col].odd;
    expect(at(0, 0)).toBe(at(1, 1));
    expect(at(0, 0)).not.toBe(at(1, 0));
    expect(at(0, 0)).not.toBe(at(0, 1));
  });

  it("вырожденная сетка не падает", () => {
    expect(latticeCenters(W, H, 0, 3, 10)).toEqual([]);
    expect(latticeCenters(W, H, 3, 0, 10)).toEqual([]);
  });
});

describe("mosaicTiles", () => {
  const tiles = mosaicTiles(W, H, 5, 7, 12);

  it("плитки покрывают поле без дыр и нахлёстов", () => {
    expect(tiles.length).toBe(35);
    const area = tiles.reduce((s, t) => s + t.w * t.h, 0);
    expect(area).toBeCloseTo((W - 24) * (H - 24), 5);
  });

  it("оттенок детерминирован и лежит в границах палитры", () => {
    for (const t of tiles) {
      expect(Number.isInteger(t.shade)).toBe(true);
      expect(t.shade).toBeGreaterThanOrEqual(0);
      expect(t.shade).toBeLessThan(3);
    }
    expect(mosaicTiles(W, H, 5, 7, 12).map((t) => t.shade)).toEqual(tiles.map((t) => t.shade));
  });

  it("оттенки реально перемешаны, а не один на всю карту", () => {
    expect(new Set(tiles.map((t) => t.shade)).size).toBeGreaterThan(1);
  });
});
