import { describe, it, expect } from "vitest";
import { zoneTitle, zoneAction, zoneLabelPlacement } from "./zoneLabels";

describe("zoneTitle", () => {
  it("в покое зона подписана тем, что она есть", () => {
    expect(zoneTitle("center")).toBe("стол");
    expect(zoneTitle("hand")).toBe("рука");
  });

  it("в игре центр называется игрой, в раздаче — столом", () => {
    expect(zoneTitle("center", true)).not.toBe(zoneTitle("center", false));
  });
});

describe("zoneAction", () => {
  it("глаголы КРАТКИЕ — призыв к действию, а не предложение", () => {
    expect(zoneAction("discard", "card")).toBe("сброс");
    expect(zoneAction("hand", "take")).toBe("в руку");
    expect(zoneAction("center", "take", true)).toBe("на стол");
  });

  it("в игре центр — «на стол», в раздаче — «в колоду»", () => {
    expect(zoneAction("center", "card", true)).toBe("на стол");
    expect(zoneAction("center", "card", false)).toBe("в колоду");
  });

  it("рука ВСЕГДА «в руку» — и своя карта, и взятая со стола, без разнобоя", () => {
    expect(zoneAction("hand", "card")).toBe("в руку");
    expect(zoneAction("hand", "take")).toBe("в руку");
  });

  it("все подписи непустые и короткие — это призыв поверх зоны", () => {
    for (const zone of ["center", "hand", "deck", "discard"] as const) {
      for (const inGame of [false, true]) {
        expect(zoneTitle(zone, inGame).length).toBeGreaterThan(0);
        for (const kind of ["card", "take"] as const) {
          const t = zoneAction(zone, kind, inGame);
          expect(t.length).toBeGreaterThan(0);
          expect(t.length).toBeLessThanOrEqual(10); // глагол лаконичный
        }
      }
    }
  });
});

describe("zoneLabelPlacement", () => {
  it("у колоды подпись СНАРУЖИ (внутри её закрывают карты стопки)", () => {
    expect(zoneLabelPlacement("deck")).toBe("outside");
  });

  it("у стола, руки и сброса — по центру бокса", () => {
    for (const zone of ["center", "hand", "discard"] as const) {
      expect(zoneLabelPlacement(zone)).toBe("center");
    }
  });
});
