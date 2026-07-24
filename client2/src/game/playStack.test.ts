import { describe, expect, it } from "vitest";
import { PLAY_SPREAD_X, PLAY_SPREAD_Y, PLAY_STACK_FOOTPRINT, playStackOffset } from "./playStack";

/** Габарит кучки в долях карты: от самого левого края до самого правого. */
function extent(count: number): { w: number; h: number } {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < count; i++) {
    const o = playStackOffset(i, count);
    xs.push(o.dx);
    ys.push(o.dy);
  }
  return { w: 1 + (Math.max(...xs) - Math.min(...xs)), h: 1 + (Math.max(...ys) - Math.min(...ys)) };
}

describe("playStackOffset", () => {
  it("одна карта лежит ровно в центре ячейки", () => {
    expect(playStackOffset(0, 1)).toEqual({ dx: 0, dy: 0 });
  });

  // Главное требование: по кучке должно быть видно, что лежит на самом дне.
  it("самая нижняя карта выпирает вправо и вниз дальше всех", () => {
    const n = 5;
    const bottom = playStackOffset(0, n);
    for (let i = 1; i < n; i++) {
      expect(bottom.dx).toBeGreaterThan(playStackOffset(i, n).dx);
      expect(bottom.dy).toBeGreaterThan(playStackOffset(i, n).dy);
    }
  });

  it("нижняя карта открывает угол настолько, чтобы читался её индекс", () => {
    // Угловой знак лица занимает нижнюю треть высоты карты — меньший вынос показал бы
    // половину знака (см. комментарий к PLAY_SPREAD_Y).
    const n = 4;
    const gap = playStackOffset(0, n).dy - playStackOffset(1, n).dy;
    expect(gap).toBeGreaterThanOrEqual(PLAY_SPREAD_Y * 0.5);
  });

  it("задние карты торчат из-под передней, а не прячутся в ней", () => {
    const n = 4;
    for (let i = 0; i < n - 1; i++) {
      expect(playStackOffset(i, n).dx).toBeGreaterThan(playStackOffset(i + 1, n).dx);
    }
  });

  it("верхняя карта — начало отсчёта, глубже неё никто не лежит выше", () => {
    const n = 6;
    const top = playStackOffset(n - 1, n);
    for (let i = 0; i < n - 1; i++) expect(playStackOffset(i, n).dy).toBeGreaterThan(top.dy);
  });

  // Сетка зоны тесная: разъезд вширь ограничен жёстко и не зависит от числа карт.
  it("кучка не шире 1.2 карты, сколько бы карт в ней ни было", () => {
    for (const n of [2, 3, 5, 12, 36]) {
      expect(extent(n).w).toBeLessThanOrEqual(1.2 + 1e-9);
    }
  });

  it("габарит кучки не растёт с числом карт", () => {
    expect(extent(36)).toEqual(extent(3));
  });

  it("кучка отцентрована: вынос вверх-влево равен выносу вниз-вправо", () => {
    const n = 7;
    const top = playStackOffset(n - 1, n);
    const bottom = playStackOffset(0, n);
    expect(top.dx).toBeCloseTo(-bottom.dx, 9);
    expect(top.dy).toBeCloseTo(-bottom.dy, 9);
  });

  it("габарит, объявленный сетке, совпадает с настоящим", () => {
    expect(PLAY_STACK_FOOTPRINT.w).toBeCloseTo(extent(5).w, 9);
    expect(PLAY_STACK_FOOTPRINT.h).toBeCloseTo(extent(5).h, 9);
    expect(PLAY_STACK_FOOTPRINT.w).toBeCloseTo(1 + PLAY_SPREAD_X, 9);
  });

  it("средние карты держатся ближе к верхней, чем ко дну", () => {
    const n = 5;
    const middle = playStackOffset(2, n);
    const top = playStackOffset(n - 1, n);
    const bottom = playStackOffset(0, n);
    expect(middle.dy - top.dy).toBeLessThan(bottom.dy - middle.dy);
  });
});
