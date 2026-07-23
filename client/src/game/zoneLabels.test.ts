import { describe, it, expect } from "vitest";
import { zoneTitle, zoneAction } from "./zoneLabels";

describe("zoneTitle", () => {
  it("в покое зона подписана тем, что она есть", () => {
    expect(zoneTitle("center")).toBe("стол");
    expect(zoneTitle("hand")).toBe("рука");
  });
});

describe("zoneAction", () => {
  it("во время драга подпись говорит, ЧТО произойдёт при дропе", () => {
    expect(zoneAction("center", "card")).toContain("колод"); // в раздаче центр — место колоды
    expect(zoneAction("hand", "card")).toContain("руке");
  });

  it("своя карта и карта, которую тянут со стола, подписаны по-разному", () => {
    expect(zoneAction("center", "card")).not.toBe(zoneAction("center", "take"));
    expect(zoneAction("hand", "card")).not.toBe(zoneAction("hand", "take"));
  });

  it("в режиме свободы карта со стола «берётся себе», а не «оставляется в руке»", () => {
    expect(zoneAction("hand", "take")).toContain("взять");
    expect(zoneAction("hand", "take")).not.toBe(zoneAction("hand", "card"));
  });

  // В игре центр стола — не место колоды, а игральная зона: карта туда КЛАДЁТСЯ и там
  // остаётся. Обещать «вернуть в колоду» значило бы врать про то, что сейчас произойдёт.
  it("в игре центр стола обещает выложить карту, а не вернуть её в колоду", () => {
    expect(zoneAction("center", "card", true)).toContain("выложить");
    expect(zoneAction("center", "card", true)).not.toBe(zoneAction("center", "card", false));
  });

  it("остальные зоны в игре подписаны так же, как в раздаче", () => {
    for (const zone of ["hand", "deck", "discard"] as const) {
      expect(zoneAction(zone, "card", true)).toBe(zoneAction(zone, "card", false));
    }
  });

  it("в игре центр называется игрой, в раздаче — столом", () => {
    expect(zoneTitle("center", true)).not.toBe(zoneTitle("center", false));
  });

  it("все подписи непустые и короткие — это надпись поверх зоны", () => {
    for (const zone of ["center", "hand", "deck", "discard"] as const) {
      for (const inGame of [false, true]) {
        expect(zoneTitle(zone, inGame).length).toBeGreaterThan(0);
        for (const kind of ["card", "take"] as const) {
          const t = zoneAction(zone, kind, inGame);
          expect(t.length).toBeGreaterThan(0);
          expect(t.length).toBeLessThanOrEqual(20);
        }
      }
    }
  });
});
