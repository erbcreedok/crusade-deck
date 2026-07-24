import { describe, expect, it } from "vitest";
import { TablePool, type TableSlot } from "./tablePool";
import type { CardTargets } from "../CardBody";
import type { CardVisual } from "./types";

// Фейковое тело: записывает snapTo/setTarget, чтобы проверять полёты без Pixi.
function fakeVisual(card: string): CardVisual {
  const body = {
    snaps: [] as CardTargets[],
    targets: [] as CardTargets[],
    snapTo(t: CardTargets) {
      this.snaps.push(t);
    },
    setTarget(t: CardTargets) {
      this.targets.push(t);
    },
  };
  return { body, sprite: {}, card, phase: 0 } as unknown as CardVisual;
}

// Якорь: по боксу разводим x, по within — y. Достаточно, чтобы различать места.
function anchor(slot: TableSlot): CardTargets {
  const bx: Record<string, number> = { deck: 0, hand: 100, discard: 200 };
  return { x: bx[slot.box] ?? 300, y: slot.within, rot: 0, scale: 1 };
}

function makePool() {
  const created: string[] = [];
  const entered: string[] = [];
  const placed: string[] = [];
  const left: string[] = [];
  const pool = new TablePool({
    create: (card) => {
      created.push(card);
      return fakeVisual(card);
    },
    anchor,
    onEnter: (_v, s) => entered.push(`${s.card}@${s.box}`),
    onPlace: (_v, s) => placed.push(`${s.card}@${s.box}`),
    onLeave: (_v, card) => left.push(card),
  });
  return { pool, created, entered, placed, left };
}

const slot = (card: string, box: string, within = 0): TableSlot => ({ card, box, within });

describe("TablePool", () => {
  it("новая карта создаётся, встаёт у якоря и летит в слот", () => {
    const { pool, created, entered } = makePool();
    pool.apply([slot("A♠", "deck")]);
    expect(created).toEqual(["A♠"]);
    expect(entered).toEqual(["A♠@deck"]);
    const v = pool.get("A♠")! as unknown as { body: { snaps: CardTargets[]; targets: CardTargets[] } };
    expect(v.body.snaps).toHaveLength(1); // поставлена у источника
    expect(v.body.targets.at(-1)).toMatchObject({ x: 0 }); // и нацелена в слот колоды
  });

  it("переход бокс→бокс СОХРАНЯЕТ спрайт (один нод летит), create не зовётся снова", () => {
    const { pool, created, placed } = makePool();
    pool.apply([slot("A♠", "deck")]);
    const same = pool.get("A♠");
    pool.apply([slot("A♠", "hand")]); // та же карта уехала в руку
    expect(created).toEqual(["A♠"]); // НЕ пересоздана
    expect(pool.get("A♠")).toBe(same); // тот же объект
    expect(placed).toEqual(["A♠@hand"]);
    const v = same! as unknown as { body: { targets: CardTargets[] } };
    expect(v.body.targets.at(-1)).toMatchObject({ x: 100 }); // летит к якорю руки
  });

  it("исчезнувшая из состава карта уходит через onLeave и вычищается", () => {
    const { pool, left } = makePool();
    pool.apply([slot("A♠", "deck"), slot("K♥", "deck", 1)]);
    pool.apply([slot("A♠", "deck")]); // K♥ ушла (в чужое место)
    expect(left).toEqual(["K♥"]);
    expect(pool.has("K♥")).toBe(false);
    expect(pool.size).toBe(1);
  });

  it("inBox отдаёт карты бокса по порядку within", () => {
    const { pool } = makePool();
    pool.apply([slot("A♠", "play:0", 1), slot("K♥", "play:0", 0), slot("Q♦", "hand", 0)]);
    expect(pool.inBox("play:0").map((v) => v.card)).toEqual(["K♥", "A♠"]);
    expect(pool.inBox("hand").map((v) => v.card)).toEqual(["Q♦"]);
  });

  it("apply возвращает разбиение entered/moved/left", () => {
    const { pool } = makePool();
    pool.apply([slot("A♠", "deck"), slot("K♥", "deck", 1)]);
    const r = pool.apply([slot("A♠", "hand"), slot("Q♦", "deck")]);
    expect(r.entered).toEqual(["Q♦"]);
    expect(r.moved).toEqual(["A♠"]);
    expect(r.left).toEqual(["K♥"]);
  });

  it("clear отпускает пул", () => {
    const { pool } = makePool();
    pool.apply([slot("A♠", "deck")]);
    pool.clear();
    expect(pool.size).toBe(0);
    expect(pool.slots).toEqual([]);
  });
});
