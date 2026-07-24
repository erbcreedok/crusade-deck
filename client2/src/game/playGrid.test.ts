import { describe, expect, it } from "vitest";
import { PLAY_MIN_SCALE, pickPlayCell, playGrid } from "./playGrid";
import type { RoundedRect } from "./layout";

const ZONE: RoundedRect = { cx: 200, cy: 150, w: 300, h: 200, r: 8 };
const CARD_W = 60;
const CARD_H = 86;

const grid = (count: number, scrollY = 0, zone = ZONE) => playGrid(zone, CARD_W, CARD_H, count, scrollY);

function overlaps(a: { cx: number; cy: number; w: number; h: number }, b: typeof a): boolean {
  return Math.abs(a.cx - b.cx) < (a.w + b.w) / 2 && Math.abs(a.cy - b.cy) < (a.h + b.h) / 2;
}

describe("playGrid", () => {
  it("на каждую кучку по ячейке", () => {
    expect(grid(3).cells).toHaveLength(3);
  });

  // Место под следующую кучку есть ВСЕГДА, даже когда сетка забита ровно под край:
  // иначе на полном столе некуда было бы уронить карту «отдельно».
  it("пустая зона всё равно показывает, куда класть первую кучку", () => {
    const g = grid(0);
    expect(g.cells).toHaveLength(0);
    expect(g.addCell.w).toBeGreaterThan(0);
  });

  it("ячейка «сюда новую» идёт следующей за последней кучкой", () => {
    const g = grid(2);
    expect(overlaps(g.cells[1], g.addCell)).toBe(false);
    expect(g.addCell.cx + g.addCell.cy).toBeGreaterThan(g.cells[0].cx + g.cells[0].cy);
  });

  it("ячейки не налезают друг на друга", () => {
    const g = grid(7);
    const all = [...g.cells, g.addCell];
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) expect(overlaps(all[i], all[j])).toBe(false);
    }
  });

  it("ячейки не вылезают из зоны по ширине", () => {
    const g = grid(9);
    for (const c of [...g.cells, g.addCell]) {
      expect(c.cx - c.w / 2).toBeGreaterThanOrEqual(ZONE.cx - ZONE.w / 2 - 0.001);
      expect(c.cx + c.w / 2).toBeLessThanOrEqual(ZONE.cx + ZONE.w / 2 + 0.001);
    }
  });

  it("карта не крупнее своего обычного размера, сколько бы места ни было", () => {
    expect(grid(1).cardW).toBeLessThanOrEqual(CARD_W);
  });

  it("чем больше кучек, тем мельче карты", () => {
    expect(grid(10).cardW).toBeLessThan(grid(2).cardW);
  });

  // Договорённость по задаче: сначала сжимаем, и только упёршись в пол — скроллим.
  it("сжатие упирается в пол, дальше зона прокручивается", () => {
    const g = grid(60);
    expect(g.cardW).toBeCloseTo(CARD_W * PLAY_MIN_SCALE, 5);
    expect(g.scrollMax).toBeGreaterThan(0);
  });

  it("пока всё влезает, прокрутки нет", () => {
    expect(grid(4).scrollMax).toBe(0);
  });

  it("прокрутка уводит ячейки вверх ровно на свою величину", () => {
    const at0 = grid(60, 0);
    const at40 = grid(60, 40);
    expect(at40.cells[0].cy).toBeCloseTo(at0.cells[0].cy - 40, 5);
  });

  it("прокрутка зажата: за края содержимого не уехать", () => {
    const g = grid(60, 0);
    expect(grid(60, -100).cells[0].cy).toBeCloseTo(g.cells[0].cy, 5);
    expect(grid(60, g.scrollMax + 500).cells[0].cy).toBeCloseTo(g.cells[0].cy - g.scrollMax, 5);
  });

  it("зоны нет (раздача) — нет и сетки", () => {
    const g = grid(3, 0, { cx: 0, cy: 0, w: 0, h: 0, r: 0 });
    expect(g.cells).toHaveLength(0);
    expect(g.scrollMax).toBe(0);
  });
});

describe("pickPlayCell", () => {
  it("палец на кучке — её индекс", () => {
    const g = grid(3);
    expect(pickPlayCell(g, g.cells[1].cx, g.cells[1].cy)).toBe(1);
  });

  // Ровно это правило создаёт новые кучки: мимо карт — значит «отдельно».
  it("палец мимо кучек — null, это заявка на новую кучку", () => {
    const g = grid(1);
    expect(pickPlayCell(g, g.addCell.cx, g.addCell.cy)).toBeNull();
  });

  it("палец вне зоны — null", () => {
    const g = grid(3);
    expect(pickPlayCell(g, ZONE.cx + ZONE.w, ZONE.cy)).toBeNull();
  });
});
