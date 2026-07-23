import { describe, expect, it } from "vitest";
import { TAUNT_DUR, TAUNT_KINDS, TAUNT_LABEL, TAUNT_TEXT, tauntFontSize, tauntPose } from "./taunt";

describe("кричалки — общее", () => {
  it("у каждого вида есть текст, подпись и длительность", () => {
    for (const kind of TAUNT_KINDS) {
      expect(TAUNT_TEXT[kind].length).toBeGreaterThan(0);
      expect(TAUNT_LABEL[kind].length).toBeGreaterThan(0);
      expect(TAUNT_DUR[kind]).toBeGreaterThan(0);
    }
  });

  it("подпись кнопки короткая: длинная не влезает в панель (см. ActionBar)", () => {
    for (const kind of TAUNT_KINDS) expect(TAUNT_LABEL[kind].length).toBeLessThanOrEqual(9);
  });

  it("начинается и заканчивается прозрачной — надпись не появляется и не исчезает рывком", () => {
    for (const kind of TAUNT_KINDS) {
      expect(tauntPose(kind, 0).alpha).toBeCloseTo(0);
      expect(tauntPose(kind, 1).alpha).toBeCloseTo(0);
      expect(tauntPose(kind, 0.5).alpha).toBeCloseTo(1);
    }
  });

  it("прогресс за границами не ломает позу", () => {
    for (const kind of TAUNT_KINDS) {
      expect(tauntPose(kind, -5).alpha).toBe(0);
      expect(tauntPose(kind, 5).alpha).toBe(0);
      expect(Number.isFinite(tauntPose(kind, 99).scale)).toBe(true);
    }
  });
});

describe("tauntFontSize — надпись влезает в экран целиком", () => {
  // Ровно та беда, из-за которой клич «ГОУ!» на 375px читается кусками: кегль был
  // подобран на глаз, а не от ширины. У кричалки он считается.
  const GLYPH_W = 0.62;
  const PEAK = { gkh: 1.1, suck: 1.2 } as const;

  it("на узком телефоне ширина надписи в пике не превышает экран", () => {
    for (const w of [320, 375, 414]) {
      for (const kind of TAUNT_KINDS) {
        const size = tauntFontSize(w, kind);
        const widthAtPeak = TAUNT_TEXT[kind].length * GLYPH_W * size * PEAK[kind];
        expect(widthAtPeak).toBeLessThanOrEqual(w);
      }
    }
  });

  it("на широком экране кегль не растёт бесконечно", () => {
    expect(tauntFontSize(4000, "suck")).toBe(tauntFontSize(8000, "suck"));
  });

  it("на десктопе кричалка крупная, а не подпись под столом", () => {
    expect(tauntFontSize(1541, "suck")).toBeGreaterThan(80);
  });

  it("на совсем узком экране остаётся читаемым, а не схлопывается в ноль", () => {
    expect(tauntFontSize(80, "suck")).toBeGreaterThanOrEqual(14);
  });
});

describe("gkh — личный кашель", () => {
  it("трясётся: за короткий отрезок смещение меняет знак", () => {
    const xs = Array.from({ length: 40 }, (_, i) => tauntPose("gkh", 0.3 + i * 0.002).dx);
    expect(Math.max(...xs)).toBeGreaterThan(0);
    expect(Math.min(...xs)).toBeLessThan(0);
  });

  it("всплывает над местом: к концу уходит вверх", () => {
    expect(tauntPose("gkh", 0.9).dy).toBeLessThan(tauntPose("gkh", 0.1).dy);
  });

  it("наклон дрожит, но остаётся мелким — надпись не кувыркается", () => {
    for (let i = 0; i <= 100; i++) expect(Math.abs(tauntPose("gkh", i / 100).rot)).toBeLessThan(0.1);
  });
});

describe("suck — общий вопль", () => {
  it("не трясётся: всем показывается одинаково, без дрожи и наклона", () => {
    for (let i = 0; i <= 100; i++) {
      const pose = tauntPose("suck", i / 100);
      expect(pose.dx).toBe(0);
      expect(pose.dy).toBe(0);
      expect(pose.rot).toBe(0);
    }
  });

  it("раздувается из центра, а не выпрыгивает в полный рост", () => {
    expect(tauntPose("suck", 0).scale).toBeLessThan(tauntPose("suck", 1).scale);
    expect(tauntPose("suck", 0).scale).toBeLessThan(0.6);
  });
});
