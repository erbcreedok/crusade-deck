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

/** Найти на сцене узел по zIndex (хит-зоны движка отличаются именно им). */
function findByZ(node: any, z: number): any {
  if (node.zIndex === z) return node;
  for (const kid of node.children ?? []) {
    const hit = findByZ(kid, z);
    if (hit) return hit;
  }
  return null;
}

/**
 * Проиграть жест «утащить верхнюю карту с колоды и бросить в точку (x,y)».
 *
 * Между движениями пальца обязательно крутим кадры: карта едет за пальцем ПРУЖИНОЙ, и
 * без кадров она так и осталась бы лежать на стопке — жест проверялся бы вхолостую.
 */
function dragTopCardTo(app: any, engine: any, x: number, y: number): void {
  const deckHit = findByZ(app.stage, 10_000); // Z.deckHit
  const anchor = { x: 195, y: 300 };
  deckHit.__emit("pointerdown", { pointerId: 1, global: anchor, pointerType: "touch" });
  // Первый сдвиг переводит нажатие в драг, дальше карта едет за пальцем.
  app.stage.__emit("pointermove", { pointerId: 1, global: { x: anchor.x + 20, y: anchor.y + 20 } });
  for (let i = 0; i < 6; i++) app.ticker.__advance(16);
  app.stage.__emit("pointermove", { pointerId: 1, global: { x, y } });
  for (let i = 0; i < 25; i++) app.ticker.__advance(16); // карта доехала до пальца
  app.stage.__emit("pointerup", { pointerId: 1, global: { x, y } });
  void engine;
}

describe("RoomEngine: карта улетает с колоды", () => {
  // Карта, утащенную с колоды пальцем, обязана покинуть стопку СРАЗУ, не дожидаясь эха
  // сервера: к верхней карте привязаны кирпич колоды и её тень, и пока улетевшая карта
  // числится верхней, вся колода «переезжает» в точку дропа.
  it("улетевшая карта сразу уходит из колоды, а не ждёт эха сервера", async () => {
    const { engine } = await mountEngine();
    engine.setDeck(DECK_36);
    const before = pixi.__liveSprites().length;
    const top = DECK_36[DECK_36.length - 1]!;

    engine.flyCardOff(top, { x: 100, y: 700, rot: 0 }, "me");

    // Спрайт карты в колоде уничтожен, вместо него — один призрак в полёте: счёт тот же.
    expect(pixi.__liveSprites().length).toBe(before);
  });

  // Жест целиком: дилер тащит верхнюю карту и роняет её в свою полосу руки. Раньше при
  // дропе на месте колоды оставалась ОДНА карта, а кирпич с верхней уезжали к руке —
  // потому что улетевшая карта до эха сервера числилась в стопке верхней.
  it("после дропа колода остаётся на месте целиком: низ, кирпич и новая верхняя", async () => {
    const { engine, app } = await mountEngine();
    engine.setSelfId("me");
    engine.setSelfDealState(true, true);
    engine.setCanDeal(true);
    engine.setDeck(DECK_36);
    const dealt: string[] = [];
    engine.setOnDealCard((card: string) => dealt.push(card));
    for (let i = 0; i < 30 && app.ticker.started; i++) app.ticker.__advance(16);

    const deckX = 195;
    dragTopCardTo(app, engine, 195, 740); // полоса своей руки внизу
    for (let i = 0; i < 20; i++) app.ticker.__advance(16); // пружины и синк сцены после дропа

    expect(dealt).toEqual([DECK_36[DECK_36.length - 1]]); // ушла именно верхняя карта

    // Видимые карты колоды снова стоят у своего якоря, а не в точке дропа.
    const visible = pixi
      .__liveSprites()
      .filter((sp: any) => sp.visible && sp.y < 600 && sp.zIndex < 80_000);
    expect(visible.length).toBeGreaterThan(0);
    for (const sp of visible) {
      expect(Math.abs(sp.x - deckX)).toBeLessThan(60);
    }
  });

  it("в режиме свободы дроп в свою руку тоже не уводит колоду с места", async () => {
    const { engine, app } = await mountEngine();
    engine.setSelfId("me");
    engine.setSelfDealState(true, false);
    engine.setFreeMode(true);
    engine.setDeck(DECK_36);
    const taken: string[] = [];
    engine.setOnDealCard((card: string) => taken.push(card));
    for (let i = 0; i < 30 && app.ticker.started; i++) app.ticker.__advance(16);

    dragTopCardTo(app, engine, 195, 740);
    for (let i = 0; i < 20; i++) app.ticker.__advance(16);
    expect(taken).toEqual([DECK_36[DECK_36.length - 1]]);

    // Кирпич колоды (Graphics под картами) обязан остаться у якоря, а не уехать в руку:
    // он рисуется ОТНОСИТЕЛЬНО верхней карты, и именно он «уносил колоду» в точку дропа.
    const body = findByZ(app.stage, 0.5); // Z.deckBody внутри слоя карт
    if (body) expect(body.y).toBeLessThan(600);

    const onTable = pixi
      .__liveSprites()
      .filter((sp: any) => sp.visible && sp.zIndex < 80_000 && sp.y < 600);
    expect(onTable.length).toBeGreaterThan(0);
  });

  // Дроп мимо всех зон: карта просто летит домой. Пока она в пути, она всё ещё верхняя
  // карта колоды — и кирпич стопки летел вместе с ней, будто возвращается вся колода.
  it("карта, брошенная в пустоту, летит домой ОДНА — без кирпича колоды", async () => {
    const { engine, app } = await mountEngine();
    engine.setSelfId("me");
    engine.setSelfDealState(true, false);
    engine.setFreeMode(true);
    engine.setDeck(DECK_36);
    for (let i = 0; i < 60 && app.ticker.started; i++) app.ticker.__advance(16);

    dragTopCardTo(app, engine, 250, 420); // пустое место посреди стола
    app.ticker.__advance(16); // карта только тронулась домой

    const live = new Set(pixi.__liveSprites());
    const cardsOnScene = findByZ(app.stage, 3).children.filter((c: any) => live.has(c) && c.visible);
    const flying = cardsOnScene.filter((sp: any) => sp.x > 150);
    const atSlot = cardsOnScene.filter((sp: any) => sp.x < 150);
    expect(flying.length).toBe(1); // домой летит ровно одна карта
    expect(atSlot.length).toBeGreaterThanOrEqual(2); // а стопка стоит на месте
  });

  it("эхо сервера с той же картой не плодит второй полёт", async () => {
    const { engine } = await mountEngine();
    engine.setDeck(DECK_36);
    const top = DECK_36[DECK_36.length - 1]!;
    engine.flyCardOff(top, { x: 100, y: 700, rot: 0 }, "me");
    const after = pixi.__liveSprites().length;

    engine.setDeck(DECK_36.slice(0, -1)); // пришло состояние без этой карты
    engine.playCardMoved([{ card: top, from: "deck", to: "me" }]);

    expect(pixi.__liveSprites().length).toBe(after);
  });
});

describe("RoomEngine: отбой запрещённого дропа", () => {
  const bot = {
    id: "bot",
    name: "Бот",
    isBot: true,
    isReady: true,
    isDealer: false,
    connected: true,
    handOpen: false,
    handFanned: false,
    handCount: 0,
    hand: [] as string[],
  };

  // В свободе карту нельзя положить в чужую руку: она отскакивает. Но пока она летит
  // обратно, она всё ещё ВЕРХНЯЯ карта колоды — а к верхней привязаны кирпич и вся
  // видимая стопка. Из-за этого колода «переезжала» на чужое место, а в своём слоте
  // оставалась одна нижняя карта.
  it("отбитая карта не утаскивает за собой кирпич колоды", async () => {
    const { engine, app } = await mountEngine();
    engine.setSelfId("me");
    engine.setSelfDealState(true, false);
    engine.setFreeMode(true);
    engine.setSeats([bot]);
    engine.setDeck(DECK_36);
    for (let i = 0; i < 60 && app.ticker.started; i++) app.ticker.__advance(16);

    const seat = (await import("./seatLayout")).layoutSeats(["bot"], 390, 800, { topOffset: 0 }).seats[0]!;
    dragTopCardTo(app, engine, seat.rect.cx, seat.rect.cy);
    for (let i = 0; i < 6; i++) app.ticker.__advance(16); // отбой ещё идёт

    // Считаем именно КАРТЫ (слой карт), а не тени: тень колоды тоже лежит у якоря.
    const live = new Set(pixi.__liveSprites());
    const cardsOnScene = findByZ(app.stage, 3).children.filter((c: any) => live.has(c) && c.visible);
    // На чужом месте — только сама отбиваемая карта.
    expect(cardsOnScene.filter((sp: any) => sp.y < 200).length).toBe(1);
    // В слоте колоды по-прежнему видна стопка: нижняя карта И новая верхняя.
    expect(cardsOnScene.filter((sp: any) => sp.y > 200).length).toBeGreaterThanOrEqual(2);
  });
});

describe("RoomEngine: веера не складываются сами", () => {
  // Веер колоды и веер руки независимы и переживают любые жесты с картами. Складывает их
  // только явное намерение: стрелка, свайп вниз или тап мимо.
  it("драг карты с колоды в руку не снимает фокус руки", async () => {
    const { engine, app } = await mountEngine();
    engine.setSelfId("me");
    engine.setSelfDealState(true, true);
    engine.setCanDeal(true);
    engine.setDeck(DECK_36);
    engine.setHand(["2♦", "3♦"]);
    engine.setSelectedDecks(["hand"]); // рука раскрыта
    for (let i = 0; i < 60 && app.ticker.started; i++) app.ticker.__advance(16);

    let collapsed = 0;
    let emptyTaps = 0;
    engine.setOnFanCollapse(() => collapsed++);
    engine.setOnEmptyTap(() => emptyTaps++);

    dragTopCardTo(app, engine, 195, 740); // в свою полосу руки
    // Pixi после драга шлёт pointertap на общего предка — это НЕ тап по пустому месту.
    app.stage.__emit("pointertap", {});

    expect(collapsed).toBe(0);
    expect(emptyTaps).toBe(0);
  });

  it("честный тап по пустому месту по-прежнему снимает выделение", async () => {
    const { engine, app } = await mountEngine();
    engine.setHand(["2♦"]);
    let emptyTaps = 0;
    engine.setOnEmptyTap(() => emptyTaps++);

    app.stage.__emit("pointertap", {});

    expect(emptyTaps).toBe(1);
  });
});

describe("RoomEngine: веер колоды в игре", () => {
  function tapDeck(app: any): void {
    findByZ(app.stage, 10_000).__emit("pointertap", {
      pointerId: 3,
      global: { x: 61, y: 362 },
      pointerType: "touch",
      stopPropagation: () => {},
    });
  }

  it("тап по колоде раскрывает веер и складывает обратно", async () => {
    const { engine, app } = await mountEngine();
    engine.setSelfId("me");
    engine.setFreeMode(true);
    engine.setDeck(DECK_36);
    const asked: boolean[] = [];
    engine.setOnDeckFanChange((open: boolean) => asked.push(open));

    tapDeck(app);
    expect(asked).toEqual([true]);

    engine.setDeckFanned(true); // React вернул флаг обратно в движок
    tapDeck(app);
    expect(asked).toEqual([true, false]);
  });

  it("раскрытие веера будит цикл и отпускает его, когда карты доехали", async () => {
    const { engine, app } = await mountEngine();
    engine.setFreeMode(true);
    engine.setDeck(DECK_36);
    for (let i = 0; i < 80 && app.ticker.started; i++) app.ticker.__advance(16);
    expect(app.ticker.started).toBe(false);

    engine.setDeckFanned(true);
    expect(app.ticker.started).toBe(true);
    for (let i = 0; i < 200 && app.ticker.started; i++) app.ticker.__advance(16);
    expect(app.ticker.started).toBe(false); // веер разъехался — цикл снова спит
  });

  it("из раскрытого веера тянется карта ПОД ПАЛЬЦЕМ, а не верхняя", async () => {
    const { engine, app } = await mountEngine();
    engine.setSelfId("me");
    engine.setFreeMode(true);
    engine.setDeck(DECK_36);
    engine.setDeckFanned(true);
    for (let i = 0; i < 60 && app.ticker.started; i++) app.ticker.__advance(16);

    const taken: string[] = [];
    engine.setOnDealCard((card: string) => taken.push(card));
    // Тянем с левого края веера — там лежат НЕ верхние карты.
    const deckHit = findByZ(app.stage, 10_000);
    deckHit.__emit("pointerdown", { pointerId: 4, global: { x: 40, y: 362 }, pointerType: "touch" });
    app.stage.__emit("pointermove", { pointerId: 4, global: { x: 60, y: 380 } });
    for (let i = 0; i < 6; i++) app.ticker.__advance(16);
    app.stage.__emit("pointermove", { pointerId: 4, global: { x: 195, y: 740 } });
    for (let i = 0; i < 25; i++) app.ticker.__advance(16);
    app.stage.__emit("pointerup", { pointerId: 4, global: { x: 195, y: 740 } });

    expect(taken).toHaveLength(1);
    expect(taken[0]).not.toBe(DECK_36[DECK_36.length - 1]);
  });

  it("сосед забрал карту — раскрытый веер доезжает пружиной, а не моргает", async () => {
    const { engine, app } = await mountEngine();
    engine.setFreeMode(true);
    engine.setDeck(DECK_36);
    engine.setDeckFanned(true);
    for (let i = 0; i < 80 && app.ticker.started; i++) app.ticker.__advance(16);

    // Позиции спрайтов веера, отсортированные: карты по одной не различаем — важно, КАК
    // едет вся раскладка.
    const xs = (): number[] => {
      const live = new Set(pixi.__liveSprites());
      return findByZ(app.stage, 3)
        .children.filter((c: any) => live.has(c) && c.visible)
        .map((c: any) => c.x)
        .sort((p: number, q: number) => p - q);
    };
    const maxDelta = (a: number[], b: number[]): number =>
      Math.max(...a.map((v, i) => Math.abs(v - (b[i] ?? v))));

    engine.setDeck(DECK_36.slice(1)); // сосед забрал карту из веера
    const atOnce = xs(); // спрайты ещё на старых местах
    app.ticker.__advance(16);
    const nextFrame = xs();
    for (let i = 0; i < 80; i++) app.ticker.__advance(16);
    const settled = xs();

    expect(maxDelta(atOnce, nextFrame)).toBeLessThan(6); // за кадр почти не сдвинулись
    expect(maxDelta(atOnce, settled)).toBeGreaterThan(6); // но в итоге переехали
  });
});

describe("RoomEngine: сброс", () => {
  /** Утащить карту из раскрытой руки в точку (x,y). */
  function dragHandCardTo(app: any, x: number, y: number): void {
    const handHit = findByZ(app.stage, 10_100); // Z.handHit
    const start = { x: 195, y: 700 };
    handHit.__emit("pointerdown", { pointerId: 2, global: start, pointerType: "touch" });
    app.stage.__emit("pointermove", { pointerId: 2, global: { x: start.x + 20, y: start.y - 20 } });
    for (let i = 0; i < 6; i++) app.ticker.__advance(16);
    app.stage.__emit("pointermove", { pointerId: 2, global: { x, y } });
    for (let i = 0; i < 25; i++) app.ticker.__advance(16);
    app.stage.__emit("pointerup", { pointerId: 2, global: { x, y } });
  }

  it("карту из руки роняют в слот сброса — уходит ровно она", async () => {
    const { engine, app } = await mountEngine();
    engine.setSelfId("me");
    engine.setFreeMode(true);
    engine.setHand(["2♦", "3♦", "4♦"]);
    engine.setSelectedDecks(["hand"]); // рука в фокусе: веер, карты берутся по одной
    for (let i = 0; i < 60 && app.ticker.started; i++) app.ticker.__advance(16);

    const discarded: string[] = [];
    engine.setOnDiscardCard((card: string) => discarded.push(card));
    const slot = (await import("./layout")).computeLayout(390, 800, undefined, true).discardSlot!;
    dragHandCardTo(app, slot.cx, slot.cy);

    expect(discarded).toHaveLength(1);
    expect(["2♦", "3♦", "4♦"]).toContain(discarded[0]);
  });

  it("сброс с сервера лежит стопкой в своём слоте", async () => {
    const { engine, app } = await mountEngine();
    engine.setFreeMode(true);
    const before = pixi.__liveSprites().length;
    engine.setDiscard(["2♦", "3♦"]);
    for (let i = 0; i < 20; i++) app.ticker.__advance(16);

    expect(pixi.__liveSprites().length - before).toBe(2);
    const slot = (await import("./layout")).computeLayout(390, 800, undefined, true).discardSlot!;
    const live = new Set(pixi.__liveSprites());
    const onScene = findByZ(app.stage, 3).children.filter((c: any) => live.has(c) && c.visible);
    const atSlot = onScene.filter((sp: any) => Math.abs(sp.x - slot.cx) < 60 && Math.abs(sp.y - slot.cy) < 60);
    expect(atSlot.length).toBeGreaterThan(0);
  });
});

describe("RoomEngine: разметка игрового стола", () => {
  it("после «ГОУ!» колода уезжает в левый слот", async () => {
    const { engine, app } = await mountEngine();
    engine.setDeck(DECK_36);
    for (let i = 0; i < 60 && app.ticker.started; i++) app.ticker.__advance(16);
    const dealingX = pixi.__liveSprites().filter((s: any) => s.visible)[0]?.x ?? 0;

    engine.setFreeMode(true);
    for (let i = 0; i < 60 && app.ticker.started; i++) app.ticker.__advance(16);
    const gameX = pixi.__liveSprites().filter((s: any) => s.visible)[0]?.x ?? 0;

    expect(gameX).toBeLessThan(dealingX - 20);
    expect(gameX).toBeGreaterThan(0); // но не за краем экрана
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
