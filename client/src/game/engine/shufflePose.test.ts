import { describe, expect, it } from "vitest";
import { shufflePose, shuffleProgress, shouldSwapZ, type ShuffleFlightShape } from "./shufflePose";

const FLIGHT: ShuffleFlightShape = {
  from: { x: 0, y: 100, rot: 0 },
  to: { x: 200, y: 100, rot: 0.2 },
  lift: 40,
  bulge: 30,
  lean: 0.3,
};

describe("shuffleProgress", () => {
  it("до своей очереди в каскаде карта не стартует", () => {
    expect(shuffleProgress(0.1, 0.3, 0.5)).toBe(-1);
  });

  it("считает долю пройденного времени", () => {
    expect(shuffleProgress(0.5, 0.3, 0.4)).toBeCloseTo(0.5);
  });

  it("не выходит за единицу", () => {
    expect(shuffleProgress(10, 0, 0.4)).toBe(1);
  });

  it("нулевая длительность — карта сразу на месте", () => {
    expect(shuffleProgress(0, 0, 0)).toBe(1);
  });
});

describe("shufflePose", () => {
  it("начало и конец совпадают со слотами", () => {
    expect(shufflePose(FLIGHT, 0)).toEqual(FLIGHT.from);
    const end = shufflePose(FLIGHT, 1);
    expect(end.x).toBeCloseTo(FLIGHT.to.x);
    expect(end.y).toBeCloseTo(FLIGHT.to.y);
    expect(end.rot).toBeCloseTo(FLIGHT.to.rot);
  });

  it("в середине карта приподнята — иначе перелёт читается как подмена на месте", () => {
    const mid = shufflePose(FLIGHT, 0.5);
    expect(mid.y).toBeLessThan(FLIGHT.from.y - 20); // выше линии стола
  });

  it("боковой вынос максимален в апексе и обнуляется к концам", () => {
    const straight = { ...FLIGHT, bulge: 0 };
    expect(shufflePose(FLIGHT, 0.5).x).toBeGreaterThan(shufflePose(straight, 0.5).x);
    expect(shufflePose(FLIGHT, 1).x).toBeCloseTo(shufflePose(straight, 1).x);
  });

  it("знак выноса задаёт сторону дуги", () => {
    const left = { ...FLIGHT, bulge: -30 };
    expect(shufflePose(left, 0.5).x).toBeLessThan(shufflePose(FLIGHT, 0.5).x);
  });

  it("движение замедляется к концу (ease-out): первая половина пути проходится быстрее", () => {
    const half = shufflePose(FLIGHT, 0.5).x - FLIGHT.bulge; // без вклада дуги
    expect(half).toBeGreaterThan(FLIGHT.to.x / 2);
  });
});

describe("shouldSwapZ", () => {
  it("z-порядок меняется в апексе, а не на старте и не в конце", () => {
    expect(shouldSwapZ(0.1)).toBe(false);
    expect(shouldSwapZ(0.5)).toBe(true);
    expect(shouldSwapZ(0.9)).toBe(true);
  });
});
