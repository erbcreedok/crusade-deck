import { describe, it, expect } from "vitest";
import { activeDropZones, zoneActivityMap } from "./dropZoneActivity";

const game = (o: Partial<Parameters<typeof activeDropZones>[0]> = {}) =>
  activeDropZones({ boardFan: null, source: "none", gameMode: true, ...o });

describe("activeDropZones", () => {
  it("в раздаче доска не размечена: живы стол и рука", () => {
    const zones = activeDropZones({ boardFan: null, source: "none", gameMode: false });
    expect([...zones].sort()).toEqual(["center", "hand"]);
  });

  it("в игре без веера работают стол, рука и сброс — колода закрыта всегда", () => {
    expect([...game()].sort()).toEqual(["center", "discard", "hand"]);
    expect(game().has("deck")).toBe(false);
  });

  it("веер раскрыт, ничего не тащат — жив только сброс", () => {
    expect([...game({ boardFan: "deck" })]).toEqual(["discard"]);
  });

  it("веером раскрыт сам сброс — не живёт ничего: он сейчас веер, а не стопка", () => {
    expect([...game({ boardFan: "discard" })]).toEqual([]);
  });

  // Веер доски занимает центр — игровая зона (center) при открытом вееере отключается.
  it("веер открыт: карту из веера кладут в руку или сброс, но НЕ в игровую зону", () => {
    for (const fan of ["deck", "discard"] as const) {
      const zones = [...game({ boardFan: fan, source: "board" })].sort();
      expect(zones).toEqual(["discard", "hand"]);
      expect(zones).not.toContain("center");
    }
  });

  it("веер открыт: карту из руки — только в сброс (центр занят веером)", () => {
    for (const fan of ["deck", "discard"] as const) {
      expect([...game({ boardFan: fan, source: "hand" })]).toEqual(["discard"]);
    }
  });

  it("колода не принимает карты ни в одном раскладе игры", () => {
    for (const boardFan of [null, "deck", "discard"] as const) {
      for (const source of ["none", "board", "hand"] as const) {
        expect(activeDropZones({ boardFan, source, gameMode: true }).has("deck")).toBe(false);
      }
    }
  });
});

describe("zoneActivityMap", () => {
  it("отвечает по каждой зоне, а не только по живым", () => {
    const map = zoneActivityMap({ boardFan: "discard", source: "none", gameMode: true });
    expect(map).toEqual({ center: false, hand: false, deck: false, discard: false });
  });
});
