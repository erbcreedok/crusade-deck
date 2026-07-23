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
    expect(zoneAction("center", "deck")).toContain("стол");
    expect(zoneAction("hand", "deck")).toContain("руку");
  });

  it("для колоды и для одной карты действия разные", () => {
    expect(zoneAction("center", "deck")).not.toBe(zoneAction("center", "card"));
    expect(zoneAction("hand", "deck")).not.toBe(zoneAction("hand", "card"));
  });

  it("в режиме свободы карта со стола «берётся себе», а не «оставляется в руке»", () => {
    expect(zoneAction("hand", "take")).toContain("взять");
    expect(zoneAction("hand", "take")).not.toBe(zoneAction("hand", "card"));
  });

  it("все подписи непустые и короткие — это надпись поверх зоны", () => {
    for (const zone of ["center", "hand"] as const) {
      expect(zoneTitle(zone).length).toBeGreaterThan(0);
      for (const kind of ["deck", "card", "take"] as const) {
        const t = zoneAction(zone, kind);
        expect(t.length).toBeGreaterThan(0);
        expect(t.length).toBeLessThanOrEqual(20);
      }
    }
  });
});
