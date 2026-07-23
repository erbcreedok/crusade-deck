import { describe, it, expect } from "vitest";
import {
  fanCard,
  fanCrowd,
  fanStep,
  fanRevealScale,
  fanDragSpreadAmp,
  clampFanWidth,
  fanMaxAngleDeg,
  energyEnvelope,
  pokeEnvelope,
  fanBandContains,
  fanInsertIndex,
  visibleSliver,
  fanSpreadShift,
  fanSpreadPinned,
} from "./fan";

const anchor = { x: 200, y: 300 };
const W = 344; // ширина зоны руки
const MAX = 30; // градусов
const WF = 0.9;

describe("fanMaxAngleDeg", () => {
  it("две карты — крошечный угол, не полный maxAngleDeg", () => {
    expect(fanMaxAngleDeg(2, 30, 4)).toBeCloseTo(2, 5); // шаг 4° → ±2°
    expect(fanMaxAngleDeg(2, 13.5, 4)).toBeCloseTo(2, 5);
  });

  it("много карт — упирается в maxAngleDeg", () => {
    expect(fanMaxAngleDeg(36, 30, 4)).toBe(30);
    expect(fanMaxAngleDeg(16, 30, 4)).toBe(30); // 15*4/2 = 30
  });

  it("пустая/одна карта — без угла", () => {
    expect(fanMaxAngleDeg(0, 30, 4)).toBe(0);
    expect(fanMaxAngleDeg(1, 30, 4)).toBe(0);
  });
});

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

describe("clampFanWidth", () => {
  const cardW = 40;

  it("мало карт — ширина упирается в maxStep*cardW", () => {
    // 3 карты, idle 0.75 → max span = 2 * 40 * 0.75 = 60 → width = 60/0.9
    expect(clampFanWidth(400, 3, cardW, WF, 0.75)).toBeCloseTo(60 / WF, 5);
  });

  it("много карт — зона не режется", () => {
    expect(clampFanWidth(400, 36, cardW, WF, 0.75)).toBe(400);
  });

  it("при драге потолок выше (0.8 > 0.75)", () => {
    const idle = clampFanWidth(400, 3, cardW, WF, 0.75);
    const drag = clampFanWidth(400, 3, cardW, WF, 0.8);
    expect(drag).toBeGreaterThan(idle);
  });
});

describe("fanRevealScale", () => {
  const cardW = 40;

  it("просторный шаг (как 3 карты на idle-потолке) — раскрытие выкл", () => {
    expect(fanRevealScale(cardW * 0.75, cardW, 0.18, 0.75)).toBe(0);
  });

  it("тесный шаг — полное раскрытие", () => {
    expect(fanRevealScale(cardW * 0.1, cardW, 0.18, 0.75)).toBe(1);
  });

  it("между порогами — плавно", () => {
    const mid = fanRevealScale(cardW * 0.465, cardW, 0.18, 0.75);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
  });

  it("fanStep согласован с clamp: 3 карты → просторно", () => {
    const width = clampFanWidth(400, 3, cardW, WF, 0.75);
    const step = fanStep(3, width, WF);
    expect(fanRevealScale(step, cardW, 0.18, 0.75)).toBe(0);
  });
});

describe("fanDragSpreadAmp", () => {
  it("на просторном веере доп. раздвиг при драге выкл — хватает дырки слота", () => {
    expect(fanDragSpreadAmp(16, 0)).toBe(0);
  });

  it("на тесном — полный amp", () => {
    expect(fanDragSpreadAmp(16, 1)).toBe(16);
  });

  it("между — пропорционально", () => {
    expect(fanDragSpreadAmp(16, 0.5)).toBe(8);
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

describe("fanBandContains", () => {
  // Веер на широком экране: дуга проседает намного ниже зоны руки, поэтому попадание
  // по крайним картам НЕЛЬЗЯ проверять прямоугольником зоны — только полосой дуги.
  const WIDE = 1204; // зона руки на десктопе
  const CARD_W = 90;
  const CARD_H = 128;
  const hit = (x: number, y: number, zoneW = WIDE) =>
    fanBandContains(x, y, anchor, zoneW, MAX, WF, CARD_W, CARD_H, 0);

  it("центральная карта веера — попадание", () => {
    expect(hit(anchor.x, anchor.y)).toBe(true);
  });

  it("нижняя часть крайних карт (далеко под якорем) — попадание", () => {
    const n = 52;
    for (const i of [0, n - 1]) {
      const c = fanCard(i, n, anchor, WIDE, MAX, WF);
      // точка у нижнего края крайней карты, вдоль её собственного наклона
      const px = c.x - Math.sin(c.rot) * (CARD_H * 0.45);
      const py = c.y + Math.cos(c.rot) * (CARD_H * 0.45);
      expect(py).toBeGreaterThan(anchor.y + 100); // и правда сильно ниже якоря
      expect(hit(px, py)).toBe(true);
    }
  });

  it("за угловым краем веера — промах", () => {
    const last = fanCard(51, 52, anchor, WIDE, MAX, WF);
    expect(hit(last.x + CARD_W * 2, last.y)).toBe(false);
  });

  it("выше веера (к центру дуги) и ниже полосы — промах", () => {
    expect(hit(anchor.x, anchor.y - CARD_H)).toBe(false);
    expect(hit(anchor.x, anchor.y + CARD_H)).toBe(false);
  });

  it("симметричен относительно якоря", () => {
    const c = fanCard(0, 52, anchor, WIDE, MAX, WF);
    const dx = c.x - anchor.x;
    expect(hit(anchor.x + dx, c.y)).toBe(hit(anchor.x - dx, c.y));
  });

  it("pad расширяет полосу (запас под палец)", () => {
    const y = anchor.y + CARD_H;
    expect(hit(anchor.x, y)).toBe(false);
    expect(fanBandContains(anchor.x, y, anchor, WIDE, MAX, WF, CARD_W, CARD_H, CARD_H)).toBe(true);
  });
});

describe("fanInsertIndex", () => {
  const N = 36;
  const idx = (x: number) => fanInsertIndex(x, anchor, W, N, MAX, WF);

  it("обратен fanCard: по x карты возвращает её же индекс", () => {
    for (let i = 0; i < N; i++) {
      expect(idx(fanCard(i, N, anchor, W, MAX, WF).x)).toBe(i);
    }
  });

  it("по центру веера — середина", () => {
    expect(idx(anchor.x)).toBe(Math.round((N - 1) / 2));
  });

  it("далеко за краями — крайние слоты, без выхода за диапазон", () => {
    expect(idx(anchor.x - W * 5)).toBe(0);
    expect(idx(anchor.x + W * 5)).toBe(N - 1);
  });

  it("колода из одной карты / пустая — слот 0", () => {
    expect(fanInsertIndex(anchor.x + 100, anchor, W, 1, MAX, WF)).toBe(0);
    expect(fanInsertIndex(anchor.x, anchor, W, 0, MAX, WF)).toBe(0);
  });
});

describe("visibleSliver", () => {
  // Карты в веере перекрывают друг друга: снизу лежит i, сверху i+1. Схватить карту
  // можно только за видимую полоску — расстояние до соседа, который её накрывает.
  it("полоска = расстояние до следующей карты (она сверху)", () => {
    expect(visibleSliver([0, 6, 12, 40], 1)).toBe(6);
    expect(visibleSliver([0, 6, 12, 40], 2)).toBe(28);
  });

  it("последняя (правая) карта сверху — видна целиком, тянется свободно", () => {
    expect(visibleSliver([0, 6, 12, 40], 3)).toBe(Infinity);
  });

  it("одна карта — полоска бесконечна (перекрывать нечем)", () => {
    expect(visibleSliver([100], 0)).toBe(Infinity);
  });

  it("индекс за границами — 0, чтобы не разрешить захват по ошибке", () => {
    expect(visibleSliver([0, 6], 5)).toBe(0);
    expect(visibleSliver([], 0)).toBe(0);
  });

  it("раздвинутый тыком участок даёт полоску шире зажатого", () => {
    const tight = [0, 6, 12, 18, 24];
    const poked = [0, 6, 30, 54, 60]; // вокруг индекса 2 раскрыто
    expect(visibleSliver(poked, 2)).toBeGreaterThan(visibleSliver(tight, 2));
  });
});

describe("fanSpreadShift", () => {
  const CARDS = 5;
  const AMP = 9;
  const shift = (i: number, center: number, env = 1) => fanSpreadShift(i, center, CARDS, AMP, env);

  it("в самой точке раскрытия сдвига нет — раздвигаются соседи", () => {
    expect(shift(10, 10)).toBe(0);
  });

  it("слева уезжают влево, справа вправо; при bias=1 симметрично", () => {
    expect(shift(9, 10)).toBeLessThan(0);
    expect(shift(11, 10)).toBeGreaterThan(0);
    expect(shift(9, 10)).toBeCloseTo(-shift(11, 10), 10);
  });

  it("rightBias>1 толкает правую сторону сильнее левой", () => {
    const bias = 1.7;
    const right = fanSpreadShift(11, 10, CARDS, AMP, 1, bias);
    const left = fanSpreadShift(9, 10, CARDS, AMP, 1, bias);
    expect(right).toBeCloseTo(-left * bias, 10); // правая ветка ×bias
    expect(Math.abs(right)).toBeGreaterThan(Math.abs(left));
  });

  it("растёт линейно внутри окна и упирается в потолок за ним", () => {
    expect(Math.abs(shift(11, 10))).toBeLessThan(Math.abs(shift(12, 10)));
    const ceiling = (AMP / 2) * 1;
    expect(shift(13, 10)).toBeCloseTo(ceiling, 10); // окно ±2.5 слота — дальше константа
    expect(shift(40, 10)).toBeCloseTo(ceiling, 10);
  });

  it("огибающая масштабирует раздвиг, на нуле его нет", () => {
    expect(shift(12, 10, 0.5)).toBeCloseTo(shift(12, 10, 1) / 2, 10);
    expect(shift(12, 10, 0)).toBe(0);
  });

  it("широкое окно раздвигает мягче узкого на той же дистанции", () => {
    expect(Math.abs(fanSpreadShift(11, 10, 12, AMP, 1))).toBeLessThan(Math.abs(shift(11, 10)));
  });
});

describe("fanSpreadPinned", () => {
  const N = 20;
  const CARDS = 5;
  const AMP = 4;
  const shift = (i: number, center: number) => fanSpreadPinned(i, N, center, CARDS, AMP);

  it("края веера прибиты: общая ширина при раздвиге не меняется", () => {
    for (const center of [0, 5, 10, 19]) {
      expect(shift(0, center)).toBeCloseTo(0, 10);
      expect(shift(N - 1, center)).toBeCloseTo(0, 10);
    }
  });

  it("вокруг точки вставки зазор раскрывается: соседи разъезжаются в стороны", () => {
    const center = 10;
    expect(shift(9, center)).toBeLessThan(0); // левый сосед уходит левее
    expect(shift(11, center)).toBeGreaterThan(0); // правый — правее
  });

  it("дальше от точки вставки веер, наоборот, поджимается", () => {
    const center = 10;
    // Между зазором и прибитым краем карты должны сдвигаться к краю, а не от него.
    expect(Math.abs(shift(16, center))).toBeLessThan(Math.abs(shift(12, center)));
  });

  it("порядок карт сохраняется — соседи не проскакивают друг сквозь друга", () => {
    const center = 7;
    for (let i = 1; i < N; i++) {
      expect(i + shift(i, center)).toBeGreaterThan(i - 1 + shift(i - 1, center));
    }
  });

  it("нулевая амплитуда ничего не двигает", () => {
    for (let i = 0; i < N; i++) expect(fanSpreadPinned(i, N, 10, CARDS, 0)).toBe(0);
  });

  it("вырожденные размеры безопасны", () => {
    expect(fanSpreadPinned(0, 1, 0, CARDS, AMP)).toBe(0);
    expect(fanSpreadPinned(0, 0, 0, CARDS, AMP)).toBe(0);
  });
});
