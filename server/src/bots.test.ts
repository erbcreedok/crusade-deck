import { describe, it, expect } from "vitest";
import { makeBot, botSessionId, isBotId, BOT_COUNT } from "./bots.js";

describe("боты тестовой комнаты", () => {
  it("бот сидит в комнате и уже готов", () => {
    const bot = makeBot(0);
    expect(bot.isBot).toBe(true);
    expect(bot.connected).toBe(true);
    expect(bot.isReady).toBe(true);
    expect(bot.isDealer).toBe(false); // дилер — живой игрок, не бот
  });

  it("у ботов разные id и человекочитаемые имена", () => {
    const ids = new Set<string>();
    const names = new Set<string>();
    for (let i = 0; i < BOT_COUNT; i++) {
      const bot = makeBot(i);
      ids.add(bot.id);
      names.add(bot.name);
      expect(bot.name.trim()).not.toBe("");
    }
    expect(ids.size).toBe(BOT_COUNT);
    expect(names.size).toBe(BOT_COUNT);
  });

  it("id бота отличим от sessionId живого клиента", () => {
    expect(isBotId(botSessionId(0))).toBe(true);
    expect(isBotId("Xk3nQ7pLa")).toBe(false); // так выглядит настоящий sessionId
  });
});
