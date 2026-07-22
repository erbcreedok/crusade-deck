import { describe, expect, it } from "vitest";
import {
  isCollapseSwipe,
  isSwipeUp,
  movedEnough,
  pressIntent,
  pushSample,
  SAMPLE_LIMIT,
  type PressContext,
} from "./gestureIntent";

const CARD_H = 90;

// Спокойное ведение пальцем вбок по раскрытому вееру колоды.
const BASE: PressContext = {
  dx: 30,
  dy: 0,
  vx: 200,
  vy: 0,
  travelUp: 0,
  travelDown: 0,
  cardH: CARD_H,
  fromHand: false,
  dealDrag: false,
  canGrab: false,
  swipeable: true,
  canShuffle: true,
};

describe("pushSample", () => {
  it("держит окно последних точек, а не всю историю", () => {
    const samples: { x: number; y: number; t: number }[] = [];
    for (let i = 0; i < SAMPLE_LIMIT + 5; i++) pushSample(samples, { x: i, y: 0, t: i });
    expect(samples).toHaveLength(SAMPLE_LIMIT);
    expect(samples[0]!.x).toBe(5); // старые выброшены
  });
});

describe("movedEnough", () => {
  it("дрожание пальца — это ещё тап", () => {
    expect(movedEnough(2, 2)).toBe(false);
  });

  it("заметное смещение — уже жест", () => {
    expect(movedEnough(20, 0)).toBe(true);
    expect(movedEnough(0, -20)).toBe(true);
  });
});

describe("isSwipeUp", () => {
  it("быстрый бросок вверх с пройденным путём — свайп", () => {
    expect(isSwipeUp(0, -2000, CARD_H, CARD_H)).toBe(true);
  });

  it("движение вниз свайпом вверх не считается", () => {
    expect(isSwipeUp(0, 2000, CARD_H, CARD_H)).toBe(false);
  });

  it("горизонтальная протяжка — это глиссандо, а не свайп", () => {
    expect(isSwipeUp(3000, -200, CARD_H, CARD_H)).toBe(false);
  });

  it("без пройденного вверх пути скорость не спасает (мелкое дрожание)", () => {
    expect(isSwipeUp(0, -2000, 1, CARD_H)).toBe(false);
  });
});

describe("isCollapseSwipe", () => {
  it("бросок вниз на достаточную длину складывает руку", () => {
    expect(isCollapseSwipe(0, 2000, CARD_H, CARD_H)).toBe(true);
  });

  it("короткий или медленный жест руку не складывает", () => {
    expect(isCollapseSwipe(0, 2000, 2, CARD_H)).toBe(false);
    expect(isCollapseSwipe(0, 5, CARD_H, CARD_H)).toBe(false);
  });
});

describe("pressIntent", () => {
  it("пока палец не сдвинулся — ждём (это может оказаться тап)", () => {
    expect(pressIntent({ ...BASE, dx: 1, dy: 1 })).toBe("wait");
  });

  it("раздача перебивает всё: свайпы во время неё не срабатывают", () => {
    expect(pressIntent({ ...BASE, dealDrag: true, vy: -2000, travelUp: CARD_H })).toBe("deal");
  });

  it("бросок вниз по руке складывает руку", () => {
    expect(pressIntent({ ...BASE, fromHand: true, vy: 2000, travelDown: CARD_H })).toBe("collapse-hand");
  });

  it("бросок вниз по КОЛОДЕ руку не складывает — там своя стрелка", () => {
    expect(pressIntent({ ...BASE, vy: 2000, travelDown: CARD_H })).not.toBe("collapse-hand");
  });

  it("бросок вверх по колоде тасует", () => {
    expect(pressIntent({ ...BASE, vy: -2000, travelUp: CARD_H })).toBe("shuffle");
  });

  it("кому нельзя тасовать — тот продолжает глиссандо, а не тасует", () => {
    expect(pressIntent({ ...BASE, vy: -2000, travelUp: CARD_H, canShuffle: false })).toBe("glissando");
  });

  it("на собранном вееере свайп вверх ничего не тасует", () => {
    expect(pressIntent({ ...BASE, vy: -2000, travelUp: CARD_H, swipeable: false, canGrab: true })).toBe("grab");
  });

  it("медленное ведение по зажатому вееру раскрывает его под пальцем", () => {
    expect(pressIntent(BASE)).toBe("glissando");
  });

  it("если карта видна — то же движение её берёт", () => {
    expect(pressIntent({ ...BASE, canGrab: true })).toBe("grab");
  });

  it("свайп вверх по РУКЕ картой не тасует колоду", () => {
    expect(pressIntent({ ...BASE, fromHand: true, canGrab: true, vy: -2000, travelUp: CARD_H })).toBe("grab");
  });
});
