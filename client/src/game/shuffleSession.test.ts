import { describe, it, expect } from "vitest";
import { ShuffleSession, SHUFFLE_PROGRESS_MS, SHUFFLE_IDLE_MS } from "./shuffleSession";

const A = ["A♠", "2♠"];
const B = ["2♠", "A♠"];

describe("ShuffleSession", () => {
  it("первое изменение открывает сессию и уходит сразу (ведущий фронт)", () => {
    const s = new ShuffleSession();
    expect(s.push(A, 0)).toEqual({ start: true, send: A });
  });

  it("частые изменения не спамят сеть — уходит не чаще одного раза за интервал", () => {
    const s = new ShuffleSession();
    s.push(A, 0);
    expect(s.push(B, 100).send).toBeNull(); // копится
    expect(s.push(A, 200).send).toBeNull();
    expect(s.tick(SHUFFLE_PROGRESS_MS - 1).send).toBeNull();
    expect(s.tick(SHUFFLE_PROGRESS_MS).send).toEqual(A); // ушло последнее состояние, не все
  });

  it("сессия открывается один раз, а не на каждое изменение", () => {
    const s = new ShuffleSession();
    s.push(A, 0);
    expect(s.push(B, 50).start).toBe(false);
    expect(s.push(A, SHUFFLE_PROGRESS_MS + 10).start).toBe(false);
  });

  it("после затишья уходит финальный порядок и сессия закрывается", () => {
    const s = new ShuffleSession();
    s.push(A, 0);
    s.push(B, 100);
    expect(s.tick(SHUFFLE_IDLE_MS + 100).final).toBe(true);
    expect(s.tick(SHUFFLE_IDLE_MS + 100).send).toBeNull(); // второй раз не шлём
  });

  it("финал шлёт ПОСЛЕДНИЙ порядок, даже если он уже уходил прогрессом", () => {
    const s = new ShuffleSession();
    s.push(A, 0); // ушло сразу
    const out = s.tick(SHUFFLE_IDLE_MS + 1);
    expect(out.final).toBe(true);
    expect(out.send).toEqual(A);
  });

  it("новое изменение после финала открывает новую сессию", () => {
    const s = new ShuffleSession();
    s.push(A, 0);
    s.tick(SHUFFLE_IDLE_MS + 1);
    expect(s.push(B, SHUFFLE_IDLE_MS + 200)).toEqual({ start: true, send: B });
  });

  it("без изменений тики молчат", () => {
    const s = new ShuffleSession();
    expect(s.tick(0)).toEqual({ send: null, final: false });
    expect(s.tick(10_000)).toEqual({ send: null, final: false });
  });

  it("интервал прогресса — не чаще пары раз в секунду, затишье длиннее интервала", () => {
    expect(SHUFFLE_PROGRESS_MS).toBeGreaterThanOrEqual(400);
    expect(SHUFFLE_IDLE_MS).toBeGreaterThan(SHUFFLE_PROGRESS_MS);
  });
});
