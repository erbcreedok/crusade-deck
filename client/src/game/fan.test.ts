import { describe, it, expect } from "vitest";
import { fanCard, fanCrowd, energyEnvelope, pokeEnvelope } from "./fan";

const anchor = { x: 200, y: 300 };
const W = 344; // ширина сейф-зоны
const MAX = 30; // градусов
const WF = 0.9;

describe("fanCard", () => {
  it("крайние карты наклонены ровно на ±maxAngleDeg", () => {
    const n = 36;
    const first = fanCard(0, n, anchor, W, MAX, WF);
    const last = fanCard(n - 1, n, anchor, W, MAX, WF);
    expect((first.rot * 180) / Math.PI).toBeCloseTo(-MAX, 5);
    expect((last.rot * 180) / Math.PI).toBeCloseTo(+MAX, 5);
  });

  it("ни одна карта не наклонена круче maxAngleDeg", () => {
    const n = 36;
    const maxRad = (MAX * Math.PI) / 180;
    for (let i = 0; i < n; i++) {
      expect(Math.abs(fanCard(i, n, anchor, W, MAX, WF).rot)).toBeLessThanOrEqual(maxRad + 1e-9);
    }
  });

  it("центральная карта почти без наклона и у якоря", () => {
    const mid = fanCard(17, 35, anchor, W, MAX, WF); // индекс 17 из 35 → центр
    expect(mid.rot).toBeCloseTo(0, 5);
    expect(mid.x).toBeCloseTo(anchor.x, 5);
    expect(mid.y).toBeCloseTo(anchor.y, 5);
  });

  it("симметрия: края зеркальны по x, одинаковы по y (арка — края ниже центра)", () => {
    const n = 36;
    const first = fanCard(0, n, anchor, W, MAX, WF);
    const last = fanCard(n - 1, n, anchor, W, MAX, WF);
    expect(first.x - anchor.x).toBeCloseTo(-(last.x - anchor.x), 5);
    expect(first.y).toBeCloseTo(last.y, 5);
    expect(first.y).toBeGreaterThan(anchor.y); // края ниже центра (арка ∩)
  });

  it("веер занимает заданную долю ширины зоны", () => {
    const n = 36;
    const first = fanCard(0, n, anchor, W, MAX, WF);
    const last = fanCard(n - 1, n, anchor, W, MAX, WF);
    expect(last.x - first.x).toBeCloseTo(W * WF, 1);
  });

  it("одна карта — по центру без наклона", () => {
    const only = fanCard(0, 1, anchor, W, MAX, WF);
    expect(only.rot).toBe(0);
    expect(only.x).toBeCloseTo(anchor.x, 5);
  });
});

describe("fanCrowd", () => {
  const cardW = 45;
  const gap = 0.18;
  const ramp = 0.5;

  it("просторный веер (мало карт) → 0", () => {
    expect(fanCrowd(10, W, cardW, WF, gap, ramp)).toBe(0);
  });

  it("тесный веер → больше нуля и не превышает 1", () => {
    const c = fanCrowd(52, W, cardW, WF, gap, ramp);
    expect(c).toBeGreaterThan(0);
    expect(c).toBeLessThanOrEqual(1);
  });

  it("чем больше карт (теснее) — тем сильнее (монотонность)", () => {
    expect(fanCrowd(52, W, cardW, WF, gap, ramp)).toBeGreaterThan(fanCrowd(40, W, cardW, WF, gap, ramp));
  });

  it("вырожденные входы безопасны", () => {
    expect(fanCrowd(1, W, cardW, WF, gap, ramp)).toBe(0);
    expect(fanCrowd(52, W, 0, WF, gap, ramp)).toBe(0);
  });
});

describe("energyEnvelope", () => {
  it("в момент тычка = boost, к decayTime = 1 (базовое)", () => {
    expect(energyEnvelope(0, 4, 2.2)).toBeCloseTo(2.2, 5);
    expect(energyEnvelope(4, 4, 2.2)).toBeCloseTo(1, 5);
  });

  it("монотонно спадает", () => {
    expect(energyEnvelope(1, 4, 2.2)).toBeGreaterThan(energyEnvelope(3, 4, 2.2));
    expect(energyEnvelope(3, 4, 2.2)).toBeGreaterThan(1);
  });
});

describe("pokeEnvelope", () => {
  const IN = 0.15;
  const HOLD = 2.5;
  const OUT = 0.8;

  it("держится на 1 во время hold", () => {
    expect(pokeEnvelope(1.0, IN, HOLD, OUT)).toBe(1);
    expect(pokeEnvelope(HOLD, IN, HOLD, OUT)).toBe(1);
  });

  it("нарастает к началу и гаснет после hold", () => {
    expect(pokeEnvelope(0, IN, HOLD, OUT)).toBe(0);
    expect(pokeEnvelope(IN, IN, HOLD, OUT)).toBeCloseTo(1, 5);
    expect(pokeEnvelope(HOLD + OUT, IN, HOLD, OUT)).toBeCloseTo(0, 10);
    expect(pokeEnvelope(HOLD + OUT + 1, IN, HOLD, OUT)).toBe(0);
  });
});
