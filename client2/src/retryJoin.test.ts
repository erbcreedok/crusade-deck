import { describe, it, expect, vi } from "vitest";
import { retryJoin, isRetriable } from "./retryJoin";

const noSleep = () => Promise.resolve();

describe("retryJoin", () => {
  it("с первого раза — повторов нет", async () => {
    const join = vi.fn().mockResolvedValue("room");
    expect(await retryJoin(join, { sleep: noSleep })).toBe("room");
    expect(join).toHaveBeenCalledTimes(1);
  });

  it("оборвался сокет на спящем сервере — вторая попытка проходит", async () => {
    const join = vi
      .fn()
      .mockRejectedValueOnce(new Error("socket hang up"))
      .mockResolvedValue("room");
    expect(await retryJoin(join, { sleep: noSleep })).toBe("room");
    expect(join).toHaveBeenCalledTimes(2);
  });

  it("сервер так и не проснулся — отдаём последнюю ошибку, не вешаемся навсегда", async () => {
    const join = vi.fn().mockRejectedValue(new Error("socket hang up"));
    await expect(retryJoin(join, { attempts: 3, sleep: noSleep })).rejects.toThrow("socket hang up");
    expect(join).toHaveBeenCalledTimes(3);
  });

  it("смысловой отказ не повторяем — ответ будет тот же", async () => {
    const join = vi.fn().mockRejectedValue(new Error("Комната с таким кодом не найдена"));
    await expect(retryJoin(join, { sleep: noSleep })).rejects.toThrow("не найдена");
    expect(join).toHaveBeenCalledTimes(1);
  });

  it("пауза растёт с номером попытки — не долбим сервер в упор", async () => {
    const delays: number[] = [];
    const join = vi.fn().mockRejectedValue(new Error("socket hang up"));
    await expect(
      retryJoin(join, {
        attempts: 3,
        delayMs: 100,
        sleep: (ms) => {
          delays.push(ms);
          return Promise.resolve();
        },
      }),
    ).rejects.toThrow();
    expect(delays).toEqual([100, 200]);
  });
});

describe("isRetriable", () => {
  it("сетевые обрывы повторяем", () => {
    for (const m of ["socket hang up", "network error", "Failed to fetch", "ETIMEDOUT timeout", "502 Bad Gateway"]) {
      expect(isRetriable(new Error(m))).toBe(true);
    }
  });

  it("смысловые отказы не повторяем", () => {
    for (const m of ["Комната с таким кодом не найдена", "room is locked", "seat reservation expired"]) {
      expect(isRetriable(new Error(m))).toBe(false);
    }
  });

  it("пустая ошибка считается сетевой — это почти всегда оборванный сокет", () => {
    expect(isRetriable(new Error(""))).toBe(true);
    expect(isRetriable(undefined)).toBe(true);
  });
});
