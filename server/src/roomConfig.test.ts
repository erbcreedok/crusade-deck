import { afterEach, describe, expect, it } from "vitest";
import { getEmptyRoomTtlMs, getShuffleLockMs, getVoteTimeoutMs } from "./roomConfig.js";

const KEYS = ["VOTE_TIMEOUT_MS", "SHUFFLE_LOCK_MS", "EMPTY_ROOM_TTL_MS"] as const;

afterEach(() => {
  for (const k of KEYS) delete process.env[k];
});

describe("тайминги комнаты", () => {
  it("без переменных окружения — значения по умолчанию", () => {
    expect(getVoteTimeoutMs()).toBe(10_000);
    expect(getShuffleLockMs()).toBe(5_000);
    expect(getEmptyRoomTtlMs()).toBe(30 * 60_000);
  });

  it("читаются на КАЖДЫЙ вызов — тест может подставить короткий таймаут на лету", () => {
    process.env.VOTE_TIMEOUT_MS = "50";
    expect(getVoteTimeoutMs()).toBe(50);
    process.env.VOTE_TIMEOUT_MS = "70";
    expect(getVoteTimeoutMs()).toBe(70);
  });

  it("мусор и неположительные значения игнорируются", () => {
    for (const bad of ["", "нет", "0", "-5", "NaN"]) {
      process.env.SHUFFLE_LOCK_MS = bad;
      expect(getShuffleLockMs()).toBe(5_000);
    }
  });
});
