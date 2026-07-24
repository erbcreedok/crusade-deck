import { describe, expect, it } from "vitest";
import { FaceTextureCache } from "./faceTextureCache";

// Ручной планировщик вместо setTimeout: тест сам решает, когда «наступил кадр».
function manualScheduler() {
  const queue: (() => void)[] = [];
  let next = 1;
  const ids = new Map<number, () => void>();
  return {
    schedule: ((fn: () => void) => {
      const id = next++;
      ids.set(id, fn);
      queue.push(fn);
      return id as unknown as ReturnType<typeof setTimeout>;
    }) as (fn: () => void, ms: number) => ReturnType<typeof setTimeout>,
    cancel: ((id: unknown) => {
      const fn = ids.get(id as number);
      if (fn) queue.splice(queue.indexOf(fn), 1);
    }) as (id: ReturnType<typeof setTimeout>) => void,
    /** Проиграть один запланированный шаг. */
    tick(): boolean {
      const fn = queue.shift();
      if (!fn) return false;
      fn();
      return true;
    },
    pending: () => queue.length,
  };
}

function makeCache(sched = manualScheduler()) {
  const made: string[] = [];
  const destroyed: string[] = [];
  const cache = new FaceTextureCache<string>({
    make: (card, fourColor) => {
      const tex = `${card}:${fourColor ? "4c" : "2c"}`;
      made.push(tex);
      return tex;
    },
    destroy: (tex) => destroyed.push(tex),
    schedule: sched.schedule,
    cancel: sched.cancel,
  });
  return { cache, made, destroyed, sched };
}

describe("FaceTextureCache", () => {
  it("печёт текстуру один раз и переиспользует её", () => {
    const { cache, made } = makeCache();
    expect(cache.get("A♠", false)).toBe("A♠:2c");
    expect(cache.get("A♠", false)).toBe("A♠:2c");
    expect(made).toEqual(["A♠:2c"]);
  });

  it("четырёхцветная палитра — отдельная текстура той же карты", () => {
    const { cache, made } = makeCache();
    cache.get("A♠", false);
    cache.get("A♠", true);
    expect(made).toEqual(["A♠:2c", "A♠:4c"]);
    expect(cache.size).toBe(2);
  });

  it("прогрев идёт порциями по три, а не всё в одном кадре", () => {
    const { cache, made, sched } = makeCache();
    cache.warm(["1", "2", "3", "4", "5"], false);
    expect(made).toHaveLength(0); // до первого «кадра» ничего не печём

    sched.tick();
    expect(made).toHaveLength(3);
    sched.tick();
    expect(made).toHaveLength(5);
    expect(sched.pending()).toBe(0); // очередь закончилась — таймер не тикает вхолостую
  });

  it("повторный warm во время прогрева не сбрасывает очередь", () => {
    const { cache, made, sched } = makeCache();
    cache.warm(["1", "2", "3", "4"], false);
    cache.warm(["1", "2", "3", "4"], false); // второй вызов — no-op
    sched.tick();
    sched.tick();
    expect(made).toEqual(["1:2c", "2:2c", "3:2c", "4:2c"]);
  });

  it("уже прогретые карты в очередь не попадают", () => {
    const { cache, made, sched } = makeCache();
    cache.get("1", false);
    cache.warm(["1", "2"], false);
    sched.tick();
    expect(made).toEqual(["1:2c", "2:2c"]);
  });

  it("прогрев останавливается, если движок умер", () => {
    const { cache, made, sched } = makeCache();
    let alive = true;
    cache.warm(["1", "2", "3", "4"], false, () => alive);
    alive = false;
    sched.tick();
    expect(made).toHaveLength(0);
    expect(sched.pending()).toBe(0);
  });

  it("clear освобождает текстуры и снимает запланированный прогрев", () => {
    const { cache, destroyed, sched } = makeCache();
    cache.get("A♠", false);
    cache.warm(["2", "3", "4", "5"], false);
    cache.clear();
    expect(destroyed).toEqual(["A♠:2c"]);
    expect(cache.size).toBe(0);
    expect(sched.pending()).toBe(0);
  });
});
