import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PixiFake } from "../test/pixiFake";

// Сетка безопасности для движка: он императивный и владеет сценой целиком, поэтому
// проверяем его СТРУКТУРНЫЕ инварианты — сколько спрайтов на сцене, спит ли цикл,
// прибирается ли всё на destroy. Настоящий Pixi в jsdom не поднимется (нет WebGL),
// поэтому под ним фейк (см. test/pixiFake.ts).
vi.mock("pixi.js", async () => (await import("../test/pixiFake")).pixiFake());

const pixi = (await import("pixi.js")) as unknown as PixiFake;
const { RoomEngine } = await import("./RoomEngine");
const { resolveProfile } = await import("./anim/animationSettings");

const DECK_36 = ["6♠", "7♠", "8♠", "9♠", "10♠", "J♠", "Q♠", "K♠", "A♠"];

async function mountEngine(w = 390, h = 800) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const engine = new RoomEngine();
  // На «полной» анимации карты вечно чуть «дышат» (idle), и цикл принципиально не спит.
  // Берём «умеренную»: там idle отсекается приоритетом — только так проверяется сон.
  engine.setAnimationProfile(resolveProfile({ level: "moderate", speed: 1 }));
  await engine.mount(host, w, h);
  const app = pixi.__apps[pixi.__apps.length - 1];
  return { engine, host, app };
}

/** Все надписи сцены: у фейка Text — обычный контейнер с полем text. */
function allTexts(node: { children?: unknown[]; text?: string }): string[] {
  const out: string[] = [];
  if (typeof node.text === "string") out.push(node.text);
  for (const child of node.children ?? []) out.push(...allTexts(child as { children?: unknown[] }));
  return out;
}

beforeEach(() => {
  pixi.__reset();
  document.body.innerHTML = "";
});

describe("RoomEngine.mount", () => {
  it("создаёт СВОЙ канвас и вставляет его в контейнер", async () => {
    const { host, app } = await mountEngine();
    expect(host.contains(app.canvas)).toBe(true);
  });

  it("повторный mount игнорируется — второго приложения не появляется", async () => {
    const { engine, host } = await mountEngine();
    await engine.mount(host, 390, 800);
    expect(pixi.__apps).toHaveLength(1);
  });

  it("mount после destroy не поднимает сцену (React мог размонтировать нас на await init)", async () => {
    const engine = new RoomEngine();
    engine.destroy();
    const host = document.createElement("div");
    await engine.mount(host, 390, 800);
    expect(host.children).toHaveLength(0);
  });
});

describe("RoomEngine.setDeck", () => {
  it("на каждую карту колоды — свой спрайт", async () => {
    const { engine } = await mountEngine();
    const before = pixi.__liveSprites().length; // тень колоды, тень карты
    engine.setDeck(DECK_36);
    expect(pixi.__liveSprites().length - before).toBe(DECK_36.length);
  });

  it("дубликаты в порядке отбрасываются: карт-близнецов на столе не бывает", async () => {
    const { engine } = await mountEngine();
    const before = pixi.__liveSprites().length;
    engine.setDeck(["A♠", "A♠", "K♥"]);
    expect(pixi.__liveSprites().length - before).toBe(2);
  });

  it("раздача карты убирает её спрайт, остальные переиспользуются", async () => {
    const { engine } = await mountEngine();
    engine.setDeck(DECK_36);
    const after = pixi.__liveSprites().length;
    engine.setDeck(DECK_36.slice(1));
    expect(pixi.__liveSprites().length).toBe(after - 1);
  });

  it("тасовка (тот же набор в другом порядке) новых спрайтов не плодит", async () => {
    const { engine } = await mountEngine();
    engine.setDeck(DECK_36);
    const after = pixi.__liveSprites().length;
    engine.setDeck([...DECK_36].reverse());
    expect(pixi.__liveSprites().length).toBe(after);
  });

  it("состояние, пришедшее ДО монтирования, доигрывается на mount", async () => {
    const engine = new RoomEngine();
    engine.setDeck(DECK_36); // ещё не смонтированы — движок только запомнил порядок
    expect(pixi.__liveSprites()).toHaveLength(0);

    const host = document.createElement("div");
    await engine.mount(host, 390, 800);
    expect(pixi.__liveSprites().length).toBeGreaterThanOrEqual(DECK_36.length);
  });
});

describe("RoomEngine.setHand", () => {
  it("рука живёт отдельной стопкой спрайтов", async () => {
    const { engine } = await mountEngine();
    engine.setDeck(DECK_36);
    const afterDeck = pixi.__liveSprites().length;
    engine.setHand(["2♦", "3♦"]);
    expect(pixi.__liveSprites().length).toBe(afterDeck + 2);
  });

  it("карта ушла из руки — её спрайт уничтожен", async () => {
    const { engine } = await mountEngine();
    engine.setHand(["2♦", "3♦"]);
    const after = pixi.__liveSprites().length;
    engine.setHand(["3♦"]);
    expect(pixi.__liveSprites().length).toBe(after - 1);
  });
});

describe("RoomEngine: сон рендер-цикла", () => {
  it("в покое цикл засыпает — в простое ноль кадров", async () => {
    const { app } = await mountEngine();
    expect(app.ticker.started).toBe(true); // стартовый кадр
    app.ticker.__advance(16);
    expect(app.ticker.started).toBe(false);
  });

  it("новая колода будит цикл", async () => {
    const { engine, app } = await mountEngine();
    app.ticker.__advance(16);
    engine.setDeck(DECK_36);
    expect(app.ticker.started).toBe(true);
  });

  it("после того как карты улеглись, цикл снова спит", async () => {
    const { engine, app } = await mountEngine();
    engine.setDeck(DECK_36);
    for (let i = 0; i < 200 && app.ticker.started; i++) app.ticker.__advance(16);
    expect(app.ticker.started).toBe(false);
  });
});

describe("RoomEngine: клич «ГОУ!»", () => {
  it("будит цикл и сам же отпускает его, отыграв", async () => {
    const { engine, app } = await mountEngine();
    app.ticker.__advance(16);
    expect(app.ticker.started).toBe(false);

    engine.playShout();
    expect(app.ticker.started).toBe(true);

    // Клич живёт около секунды: за две цикл обязан снова уснуть, иначе он жёг бы батарею
    // (новая анимация должна быть перечислена в engine/idleGate.ts).
    for (let i = 0; i < 125 && app.ticker.started; i++) app.ticker.__advance(16);
    expect(app.ticker.started).toBe(false);
  });

  it("надпись клича живёт отдельно от «низяяя» — их можно показать разом", async () => {
    const { engine, app } = await mountEngine();
    engine.playShout();
    engine.showRejectNotice("карты теперь берут сами");
    app.ticker.__advance(16);
    expect(app.destroyed).toBe(false);
    const texts = allTexts(app.stage);
    expect(texts.some((t) => t.includes("ГО"))).toBe(true);
    expect(texts.some((t) => t.includes("берут сами"))).toBe(true);
  });

  it("клич после destroy ничего не трогает", async () => {
    const { engine } = await mountEngine();
    engine.destroy();
    expect(() => engine.playShout()).not.toThrow();
  });
});

describe("RoomEngine.destroy", () => {
  it("убирает канвас, приложение и все спрайты", async () => {
    const { engine, host, app } = await mountEngine();
    engine.setDeck(DECK_36);
    engine.setHand(["2♦"]);
    engine.destroy();
    expect(app.destroyed).toBe(true);
    expect(host.contains(app.canvas)).toBe(false);
    expect(pixi.__liveSprites()).toHaveLength(0);
  });

  it("снимает тикер: кадров после смерти не бывает", async () => {
    const { engine, app } = await mountEngine();
    engine.destroy();
    expect(app.ticker.listeners).toHaveLength(0);
  });

  it("повторный destroy безопасен", async () => {
    const { engine } = await mountEngine();
    engine.destroy();
    expect(() => engine.destroy()).not.toThrow();
  });
});

describe("RoomEngine: перерисовки без падений", () => {
  const seat = {
    id: "bob",
    name: "Боб",
    isBot: false,
    isReady: true,
    isDealer: false,
    connected: true,
    handOpen: false,
    handFanned: false,
    handCount: 3,
    hand: ["2♣", "3♣", "4♣"],
  };

  it("места, режим раздачи, веер и ресайз переживаются сценой", async () => {
    const { engine, app } = await mountEngine();
    engine.setDeck(DECK_36);
    engine.setSeats([seat]);
    engine.setCanDeal(true);
    engine.setDeckFanned(true);
    engine.setSelectedDecks(["hand"]);
    engine.resize(800, 400);
    app.ticker.__advance(16);
    expect(app.destroyed).toBe(false);
    expect(pixi.__liveSprites().length).toBeGreaterThanOrEqual(DECK_36.length);
  });

  it("смена скина рубашки не пересоздаёт карты", async () => {
    const { engine } = await mountEngine();
    engine.setDeck(DECK_36);
    const after = pixi.__liveSprites().length;
    engine.setCardBack("mosaic");
    expect(pixi.__liveSprites().length).toBe(after);
  });

  it("открытая чужая рука рисуется на месте игрока", async () => {
    const { engine } = await mountEngine();
    engine.setSeats([{ ...seat, handOpen: true, handFanned: true }]);
    // Три карты руки соседа — это три дополнительных спрайта на его месте.
    expect(pixi.__liveSprites().length).toBeGreaterThanOrEqual(3);
  });
});
