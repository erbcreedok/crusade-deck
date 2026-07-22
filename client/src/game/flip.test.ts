import { describe, it, expect } from "vitest";
import { spinAngle, spinScale, spinShowsOther, flipTilt, flipTransform, stretchOffset } from "./flip";


describe("spinAngle / spinScale / spinShowsOther", () => {
  it("колода делает 1.5 оборота (540°), одиночная карта — пол-оборота", () => {
    expect(spinAngle(1, 3)).toBeCloseTo(3 * Math.PI, 6); // 540°
    expect(spinAngle(1, 1)).toBeCloseTo(Math.PI, 6);
    expect(spinAngle(0, 3)).toBe(0);
  });

  it("ширина схлопывается на каждом ребре и всегда неотрицательна — зеркала нет", () => {
    expect(spinScale(0)).toBeCloseTo(1, 6);
    expect(spinScale(Math.PI / 2)).toBeCloseTo(0, 6);
    expect(spinScale(Math.PI)).toBeCloseTo(1, 6); // развернулась другой стороной, но не зеркальна
    expect(spinScale(3 * Math.PI)).toBeCloseTo(1, 6);
    for (let k = 0; k <= 40; k++) expect(spinScale((k / 40) * 3 * Math.PI)).toBeGreaterThanOrEqual(0);
  });

  it("сторона меняется на каждом полуобороте, а в конце 540° — противоположная исходной", () => {
    expect(spinShowsOther(0)).toBe(false);
    expect(spinShowsOther(Math.PI * 0.6)).toBe(true); // первый полуоборот
    expect(spinShowsOther(Math.PI * 1.6)).toBe(false); // второй — снова исходная
    expect(spinShowsOther(3 * Math.PI - 0.01)).toBe(true); // финал — другая сторона
  });

  it("пол-оборота карты тоже заканчивается другой стороной", () => {
    expect(spinShowsOther(spinAngle(1, 1) - 0.01)).toBe(true);
  });
});

describe("flipTransform", () => {
  const base = { cx: 100, cy: 50, rot: 0, scale: 2 };

  it("в начале переворота — обычный масштаб без искажений", () => {
    const m = flipTransform(base.cx, base.cy, base.rot, base.scale, Math.PI / 2, 1);
    expect(m.a).toBeCloseTo(2, 6);
    expect(m.d).toBeCloseTo(2, 6);
    expect(m.b).toBeCloseTo(0, 6);
    expect(m.c).toBeCloseTo(0, 6);
    expect(m.tx).toBe(100);
    expect(m.ty).toBe(50);
  });

  it("на ребре площадь вырождается в ноль (карта видна с торца)", () => {
    const m = flipTransform(base.cx, base.cy, base.rot, base.scale, Math.PI / 2, 0);
    expect(m.a * m.d - m.b * m.c).toBeCloseTo(0, 6);
  });

  it("ось свайпа не сжимается, поперёк оси — сжимается", () => {
    // свайп вниз (ось x): ширина сохраняется, высота схлопывается
    const m = flipTransform(0, 0, 0, 1, Math.PI / 2, 0);
    expect(Math.abs(m.a)).toBeCloseTo(1, 6); // x-масштаб цел
    expect(Math.abs(m.d)).toBeCloseTo(0, 6); // y схлопнут
    // свайп вбок (ось y): наоборот
    const side = flipTransform(0, 0, 0, 1, 0, 0);
    expect(Math.abs(side.a)).toBeCloseTo(0, 6);
    expect(Math.abs(side.d)).toBeCloseTo(1, 6);
  });

  it("к концу переворота карта в норме: не зеркальна и не искажена", () => {
    const m = flipTransform(10, 20, 0, 2, Math.PI / 4, spinScale(spinAngle(1, 3)));
    expect(m.a * m.d - m.b * m.c).toBeGreaterThan(0); // не зеркало
    expect(m.a).toBeCloseTo(2, 6);
    expect(m.d).toBeCloseTo(2, 6);
    expect(m.b).toBeCloseTo(0, 6); // без перекоса
    expect(m.c).toBeCloseTo(0, 6);
  });

  it("собственный поворот карты сохраняется (веер не «выпрямляется»)", () => {
    const m = flipTransform(0, 0, Math.PI / 6, 1, Math.PI / 2, 1);
    expect(Math.atan2(m.b, m.a)).toBeCloseTo(Math.PI / 6, 6);
  });
});

describe("stretchOffset", () => {
  it("тянется в сторону жеста и возвращается — как резина", () => {
    expect(stretchOffset(0, 0, 100)).toEqual({ dx: 0, dy: 0 });
    const mid = stretchOffset(0.3, 0, 100);
    expect(mid.dx).toBeGreaterThan(0);
    expect(Math.hypot(...Object.values(stretchOffset(1, 0, 100)))).toBeCloseTo(0, 6);
  });

  it("направление совпадает с углом жеста", () => {
    const up = stretchOffset(0.3, -Math.PI / 2, 100);
    expect(up.dy).toBeLessThan(0);
    expect(up.dx).toBeCloseTo(0, 6);
  });

  it("на обратном ходе проскакивает через ноль — резина «отдаёт»", () => {
    const back = stretchOffset(0.8, 0, 100);
    expect(back.dx).toBeLessThan(0);
  });
});


describe("flipTilt", () => {
  const AMP = 0.22;

  it("наклон появляется в середине переворота и ПЛАВНО уходит в ноль к концу", () => {
    expect(flipTilt(0, 0, AMP)).toBeCloseTo(0, 6);
    expect(flipTilt(1, 0, AMP)).toBeCloseTo(0, 6);
    expect(Math.abs(flipTilt(0.5, 0, AMP))).toBeCloseTo(AMP, 6);
  });

  it("наклоняет в сторону жеста: вправо и влево — зеркально", () => {
    expect(flipTilt(0.5, 0, AMP)).toBeCloseTo(-flipTilt(0.5, Math.PI, AMP), 6);
  });

  it("строго вертикальный жест наклона не даёт — крутить не за что", () => {
    expect(flipTilt(0.5, Math.PI / 2, AMP)).toBeCloseTo(0, 6);
  });

  it("диагональ наклоняет слабее, чем чистая горизонталь", () => {
    expect(Math.abs(flipTilt(0.5, Math.PI / 4, AMP))).toBeLessThan(Math.abs(flipTilt(0.5, 0, AMP)));
  });
});
