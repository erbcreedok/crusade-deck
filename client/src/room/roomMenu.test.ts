import { describe, expect, it } from "vitest";
import { roomMenu, type RoomMenuFlags } from "./roomMenu";

const BASE: RoomMenuFlags = {
  dealMode: true,
  amIDealer: false,
  phase: "lobby",
  handFanOpen: false,
  handSize: 0,
  handOpen: false,
  showDeckPlaceholder: false,
  showDeckTools: false,
};

const ids = (f: Partial<RoomMenuFlags>) => roomMenu({ ...BASE, ...f }).map((i) => i.id);

describe("roomMenu", () => {
  it("выход и настройки есть всегда и идут последними", () => {
    expect(ids({}).slice(-2)).toEqual(["leave", "settings"]);
  });

  it("сбор и сброс колоды — только дилеру в раздаче", () => {
    expect(ids({ amIDealer: true })).toContain("collect_hands");
    expect(ids({ amIDealer: false })).not.toContain("collect_hands");
    expect(ids({ amIDealer: true, dealMode: false })).not.toContain("reset_deck");
  });

  it("сортировка появляется только у раскрытого веера с двумя и более картами", () => {
    expect(ids({ handFanOpen: true, handSize: 5 })).toEqual(
      expect.arrayContaining(["sort_suit", "sort_rank"]),
    );
    expect(ids({ handFanOpen: true, handSize: 1 })).not.toContain("sort_suit");
    expect(ids({ handFanOpen: false, handSize: 5 })).not.toContain("sort_suit");
  });

  it("подпись режима руки отражает текущее состояние", () => {
    expect(roomMenu({ ...BASE, handOpen: true }).find((i) => i.id === "toggle_hand")!.label).toContain("открыта");
    expect(roomMenu({ ...BASE, handOpen: false }).find((i) => i.id === "toggle_hand")!.label).toContain("закрыта");
  });

  it("вне лобби режим руки не переключить", () => {
    expect(ids({ phase: "playing" })).not.toContain("toggle_hand");
  });

  it("вернуть колоду в центр может только дилер и только когда её унесли", () => {
    expect(ids({ showDeckPlaceholder: true, amIDealer: true })).toContain("deck_to_center");
    expect(ids({ showDeckPlaceholder: true, amIDealer: false })).not.toContain("deck_to_center");
    expect(ids({ showDeckPlaceholder: false, amIDealer: true })).not.toContain("deck_to_center");
  });

  it("переворот колоды прячется при раскрытом вееере, тасовка остаётся", () => {
    expect(ids({ showDeckTools: true })).toContain("flip_deck");
    const fanned = ids({ showDeckTools: true, handFanOpen: true, handSize: 3 });
    expect(fanned).toContain("shuffle");
    expect(fanned).not.toContain("flip_deck");
  });
});
