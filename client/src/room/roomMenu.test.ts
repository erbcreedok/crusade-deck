import { describe, expect, it } from "vitest";
import { roomMenu, type RoomMenuFlags } from "./roomMenu";

const BASE: RoomMenuFlags = {
  freeMode: false,
  amIDealer: false,
  autoDealing: false,
  phase: "lobby",
  handFanOpen: false,
  handSize: 0,
  handOpen: false,
};

const ids = (f: Partial<RoomMenuFlags>) => roomMenu({ ...BASE, ...f }).map((i) => i.id);

describe("roomMenu", () => {
  // Веер рендерит список развёрнутым (см. ActionBar), поэтому ПОСЛЕДНИЙ пункт массива
  // оказывается ВЕРХНИМ на экране — «Выйти в меню» должен быть именно им.
  it("выход и настройки есть всегда; выход — последний в списке, то есть верхний в веере", () => {
    expect(ids({}).slice(-2)).toEqual(["settings", "leave"]);
  });

  it("в режиме свободы сбора и сброса в меню нет: сбор живёт в кнопке «Перераздача»", () => {
    const free = ids({ amIDealer: true, freeMode: true });
    expect(free).not.toContain("collect_hands");
    expect(free).not.toContain("reset_deck");
  });

  it("сбор, сброс и автораздача — только дилеру и только в раздаче", () => {
    const dealer = ids({ amIDealer: true });
    expect(dealer).toEqual(expect.arrayContaining(["collect_hands", "reset_deck", "auto_deal"]));
    expect(ids({ amIDealer: false })).not.toContain("collect_hands");
  });

  it("во время автораздачи пункт становится «стопом»", () => {
    const running = ids({ amIDealer: true, autoDealing: true });
    expect(running).toContain("auto_deal_stop");
    expect(running).not.toContain("auto_deal");
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
});
