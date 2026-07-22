import {
  Application,
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Texture,
  type FederatedPointerEvent,
  type Ticker,
} from "pixi.js";
import { CardBody, type CardTargets } from "./CardBody";
import { computeLayout, type RoomLayout } from "./layout";
import type { DeckZone } from "./deckZone";
import { dropZoneRegions, pickDropZone, type DropZone } from "./dropZones";
import { anim } from "./anim/config";
import {
  DEFAULT_ANIMATION_SETTINGS,
  resolveProfile,
  shouldPlay,
  type AnimationProfile,
} from "./anim/animationSettings";
import { easeOutQuad } from "./anim/easing";
import { ShuffleChoreography } from "./choreo/shuffle";
import { SpinChoreography } from "./choreo/spin";
import type { Choreography } from "./choreo/types";

interface CardVisual {
  body: CardBody;
  sprite: Sprite;
  shadow: Sprite;
}

// Логический размер текстуры рубашки (соотношение 0.7). Спрайты масштабируются от него.
const TEX_W = 160;
const TEX_H = 228;

const DRAG_SCALE = 1.18; // карты «приподнимаются» при захвате (визуальный акцент)
const DRAG_THRESHOLD = 6; // px: меньше — это тап (дабл-клик), больше — реальный драг

// Императивный движок комнаты: владеет ОДНИМ Pixi Application, тикером и всеми объектами.
// Никакого React-реконсайлера и «дерева нод на карту» — карты это простые CardVisual,
// которые мы мутируем сами. Именно это отличает подход от прошлого (@pixi/react + краш).
export class RoomEngine {
  private app: Application | null = null;
  private world: Container | null = null;
  private tableG: Graphics | null = null;
  private zoneLayer: Graphics | null = null; // подсветка дроп-зон при драге
  private shadowLayer: Container | null = null; // тени под всеми картами
  private cardLayer: Container | null = null; // сами карты (сортируется для риффла)
  private cardTex: Texture | null = null;
  private shadowTex: Texture | null = null;

  private cards: CardVisual[] = [];
  private layout: RoomLayout = computeLayout(1, 1);
  private w = 1;
  private h = 1;
  private baseScale = 1;

  private deckCount = 0;
  private deckZone: DeckZone = "center";
  private deckHit: Container | null = null;
  private lastDeckTapMs = 0;
  private onDeckDoubleClick: (() => void) | null = null;

  // Драг колоды дилером: press — палец/мышь прижаты у колоды (ещё не факт что драг),
  // dragging — порог смещения пройден, колода реально едет за курсором.
  private deckDraggable = false;
  private press: { id: number; startX: number; startY: number; x: number; y: number } | null = null;
  private dragging = false;
  private hoverZone: DropZone | null = null;
  private onDeckDrop: ((zone: DropZone) => void) | null = null;

  private restJitter: number[] = [];
  private profile: AnimationProfile = resolveProfile(DEFAULT_ANIMATION_SETTINGS);
  private destroyed = false;
  private mounted = false;
  private awake = false;
  private shuffleAnim: { choreo: Choreography; t: number } | null = null;

  // стрелка — стабильная ссылка для ticker.add/remove
  private readonly tick = (ticker: Ticker) => this.onTick(ticker);

  // Движок сам ВЛАДЕЕТ канвасом: создаёт свежий на каждый mount и вставляет в контейнер.
  // Ключевой момент — НЕ переиспользовать один <canvas> между инстансами: StrictMode
  // монтирует эффект дважды, а второй init на канвасе с уже уничтоженным WebGL-контекстом
  // ловит «context lost» и не компилит шейдеры. Свежий канвас = свежий контекст.
  async mount(container: HTMLElement, w: number, h: number): Promise<void> {
    if (this.mounted || this.destroyed) return; // защита от повторного/позднего mount
    this.mounted = true;
    this.w = Math.max(1, Math.round(w));
    this.h = Math.max(1, Math.round(h));
    this.layout = computeLayout(this.w, this.h);

    const app = new Application();
    await app.init({
      width: this.w,
      height: this.h,
      backgroundAlpha: 0, // прозрачный канвас — под ним пиксельный CSS-фон
      antialias: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
      autoStart: false, // цикл запускаем сами — рендерим только когда что-то движется
    });

    // React мог размонтировать нас, пока шёл await init — тогда просто сворачиваемся.
    if (this.destroyed) {
      app.destroy({ removeView: true }, { children: true, texture: true });
      return;
    }

    container.appendChild(app.canvas);
    this.app = app;
    this.world = new Container();
    this.world.sortableChildren = true;
    app.stage.addChild(this.world);

    // Слои по zIndex: стол → подсветка зон → тени → карты → невидимый хит колоды.
    this.tableG = new Graphics();
    this.tableG.zIndex = 0;
    this.zoneLayer = new Graphics();
    this.zoneLayer.zIndex = 1;
    this.shadowLayer = new Container();
    this.shadowLayer.zIndex = 2;
    this.cardLayer = new Container();
    this.cardLayer.zIndex = 3;
    this.cardLayer.sortableChildren = true; // чересполосица половин в риффле
    this.world.addChild(this.tableG, this.zoneLayer, this.shadowLayer, this.cardLayer);

    this.cardTex = this.makeCardBackTexture(app);
    this.shadowTex = this.makeShadowTexture(app);
    this.baseScale = this.layout.cardH / TEX_H;
    this.buildTable();
    this.reconcileCards();

    // Невидимая интерактивная зона поверх колоды — старт драга + дабл-тап.
    const hit = new Container();
    hit.eventMode = "static";
    hit.cursor = "grab";
    hit.zIndex = 10_000; // всегда над картами
    hit.on("pointerdown", (e: FederatedPointerEvent) => this.onDeckDown(e));
    hit.on("pointertap", () => this.handleDeckTap());
    this.world.addChild(hit);
    this.deckHit = hit;
    this.positionDeckHit();

    // Move/up ловим на всей сцене — палец может уйти далеко за пределы колоды.
    app.stage.eventMode = "static";
    app.stage.hitArea = new Rectangle(0, 0, this.w, this.h);
    app.stage.on("pointermove", (e: FederatedPointerEvent) => this.onPointerMove(e));
    app.stage.on("pointerup", (e: FederatedPointerEvent) => this.onPointerUp(e));
    app.stage.on("pointerupoutside", (e: FederatedPointerEvent) => this.onPointerUp(e));

    app.ticker.add(this.tick);
    this.applyProfile(); // применить текущий профиль (FPS-кап, tilt) к свежему тикеру/картам
    this.wake(); // нарисовать стартовый кадр; следующий тик усыпит, раз всё в покое
  }

  // Разбудить рендер-цикл (что-то будет двигаться). Идемпотентно.
  private wake(): void {
    if (this.destroyed || !this.app || this.awake) return;
    this.awake = true;
    this.app.ticker.start();
  }

  // Усыпить рендер-цикл: в простое ноль rAF/рендеров (не жжёт CPU/GPU, не вешает вкладку).
  private sleep(): void {
    if (!this.app || !this.awake) return;
    this.app.ticker.stop(); // текущий кадр дорисуется, следующий rAF не планируется
    this.awake = false;
  }

  // Сколько карт в собранной колоде (из состояния сервера). Идемпотентно.
  setDeckCount(n: number): void {
    // клампим сверху — защита от абсурдного состояния, чтобы не наплодить тысячи спрайтов
    this.deckCount = Math.min(60, Math.max(0, Math.floor(n)));
    this.ensureJitter(this.deckCount);
    this.reconcileCards();
    this.wake();
  }

  // Зона колоды с точки зрения локального игрока (см. deckZone.ts). "center"/"safe"
  // — рисуем у соответствующего якоря; "away" (чужая сейф-зона) — колода прячется.
  setDeckZone(zone: DeckZone): void {
    if (zone === this.deckZone) return;
    this.deckZone = zone;
    const away = zone === "away";
    for (const c of this.cards) {
      c.sprite.visible = !away;
      c.shadow.visible = !away;
    }
    if (this.deckHit) this.deckHit.eventMode = away ? "none" : "static";
    // Не «away» — карты плавно летят к новому якорю (setTarget, а не snap).
    if (!away) this.cards.forEach((c, i) => c.body.setTarget(this.restTarget(i)));
    this.positionDeckHit();
    this.wake();
  }

  // Можно ли сейчас таскать колоду (дилер в лобби). Гейтит и драг, и курсор.
  setDeckDraggable(v: boolean): void {
    this.deckDraggable = v;
    if (this.deckHit) this.deckHit.cursor = v ? "grab" : "pointer";
  }

  // Колбэк на дабл-клик по колоде (решение «куда двигать» принимает React-слой).
  setOnDeckDoubleClick(fn: (() => void) | null): void {
    this.onDeckDoubleClick = fn;
  }

  // Колбэк на дроп колоды в дроп-зону (React шлёт move_deck на сервер).
  setOnDeckDrop(fn: ((zone: DropZone) => void) | null): void {
    this.onDeckDrop = fn;
  }

  // Якорь, у которого сейчас покоится колода: центр или своя сейф-зона.
  private activeAnchor(): { x: number; y: number } {
    return this.deckZone === "safe" ? this.layout.safeAnchor : this.layout.deckAnchor;
  }

  // ——— драг колоды ———

  private onDeckDown(e: FederatedPointerEvent): void {
    if (!this.deckDraggable || this.deckZone === "away" || this.press) return;
    this.press = { id: e.pointerId, startX: e.global.x, startY: e.global.y, x: e.global.x, y: e.global.y };
    if (this.deckHit) this.deckHit.cursor = "grabbing";
  }

  private onPointerMove(e: FederatedPointerEvent): void {
    if (!this.press || e.pointerId !== this.press.id) return;
    this.press.x = e.global.x;
    this.press.y = e.global.y;
    if (!this.dragging) {
      const dx = this.press.x - this.press.startX;
      const dy = this.press.y - this.press.startY;
      if (dx * dx + dy * dy < DRAG_THRESHOLD * DRAG_THRESHOLD) return; // ещё тап, не драг
      this.dragging = true;
    }
    this.hoverZone = pickDropZone(this.press.x, this.press.y, this.layout);
    this.applyDragTargets();
    this.drawZones();
    this.wake();
  }

  private onPointerUp(e: FederatedPointerEvent): void {
    if (!this.press || e.pointerId !== this.press.id) return;
    const wasDragging = this.dragging;
    const px = this.press.x;
    const py = this.press.y;
    this.press = null;
    this.dragging = false;
    this.hoverZone = null;
    if (this.deckHit) this.deckHit.cursor = this.deckDraggable ? "grab" : "pointer";
    this.drawZones();

    // Не было смещения — это тап, дабл-клик обработает pointertap. Ничего не двигаем.
    if (!wasDragging) {
      this.wake();
      return;
    }

    const drop = pickDropZone(px, py, this.layout);
    if (drop && drop !== this.deckZone) {
      this.deckZone = drop; // оптимистично двигаем локально, сервер подтвердит эхом
      this.onDeckDrop?.(drop);
    }
    // уложить стопку у активного якоря (drop=null → вернётся в текущую зону), масштаб назад к 1
    this.cards.forEach((c, i) => c.body.setTarget(this.restTarget(i)));
    this.positionDeckHit();
    this.wake();
  }

  private applyDragTargets(): void {
    if (!this.press) return;
    const { x, y } = this.press;
    for (let i = 0; i < this.cards.length; i++) {
      this.cards[i].body.setTarget({
        x,
        y: y - i * anim.deck.stackDy,
        scale: DRAG_SCALE,
        rot: this.restJitter[i] ?? 0,
      });
    }
  }

  private drawZones(): void {
    const g = this.zoneLayer;
    if (!g) return;
    g.clear();
    if (!this.dragging) return; // подсветка только пока тащим
    const regions = dropZoneRegions(this.layout);
    (Object.keys(regions) as DropZone[]).forEach((z) => {
      const e = regions[z];
      const active = this.hoverZone === z;
      if (active) g.ellipse(e.cx, e.cy, e.rx, e.ry).fill({ color: 0xffe08a, alpha: 0.12 });
      g.ellipse(e.cx, e.cy, e.rx, e.ry).stroke({
        width: active ? 5 : 2.5,
        color: active ? 0xffe9a8 : 0xd9b154,
        alpha: active ? 0.95 : 0.4,
      });
    });
  }

  private handleDeckTap(): void {
    const now = performance.now();
    if (now - this.lastDeckTapMs < 350) {
      this.lastDeckTapMs = 0;
      this.onDeckDoubleClick?.();
    } else {
      this.lastDeckTapMs = now;
    }
  }

  private positionDeckHit(): void {
    if (!this.deckHit) return;
    const a = this.activeAnchor();
    const w = this.layout.cardW * 1.3;
    const h = this.layout.cardH * 1.3;
    this.deckHit.hitArea = new Rectangle(a.x - w / 2, a.y - h / 2, w, h);
  }

  // Запуск анимации растасовки. Реальную тасовку делает сервер — тут только фил.
  shuffle(): void {
    if (this.destroyed || this.cards.length === 0) return;

    // Анимации выключены ИЛИ растасовка не проходит по приоритету → просто уложить стопку.
    if (!shouldPlay(anim.priority.shuffle, this.profile)) {
      this.cards.forEach((c, i) => c.body.snapTo(this.restTarget(i)));
      this.wake();
      return;
    }
    const seed = (Math.floor(Math.random() * 0xffffffff) >>> 0) || 1;
    // Полная — риффл-бридж (веер + чересполосица), умеренная — короткий оборот по часовой.
    const anchor = this.activeAnchor();
    const choreo: Choreography =
      this.profile.shuffleVariant === "spin"
        ? new SpinChoreography({ count: this.cards.length, anchor, seed })
        : new ShuffleChoreography({
            count: this.cards.length,
            anchor,
            seed,
            feel: { stagger: this.profile.stagger, jitter: this.profile.jitter, scaleBump: this.profile.scaleBump ? 1 : 0 },
          });
    // z-порядок по чересполосице: чем позже стартует карта, тем выше слой — половины
    // визуально прошивают друг друга при складывании (riffle-bridge), а не лежат пачками.
    choreo.startOrder().forEach((cardIdx, k) => {
      if (this.cards[cardIdx]) this.cards[cardIdx].sprite.zIndex = k;
    });
    this.shuffleAnim = { choreo, t: 0 };
    this.wake();
  }

  // Применить пользовательский профиль анимации (уровень + скорость → движок).
  setAnimationProfile(profile: AnimationProfile): void {
    this.profile = profile;
    this.applyProfile();
    this.wake();
  }

  // Разложить профиль по «железу» движка: FPS-кап тикера + сила крена на всех картах.
  private applyProfile(): void {
    if (this.app) this.app.ticker.maxFPS = this.profile.fpsCap; // 0 = без ограничения
    const tiltScale = this.profile.tilt ? 1 : 0;
    for (const c of this.cards) c.body.tiltScale = tiltScale;
  }

  resize(w: number, h: number): void {
    const nw = Math.max(1, Math.round(w));
    const nh = Math.max(1, Math.round(h));
    if (nw === this.w && nh === this.h) return; // без реальной смены размера — ничего не делаем (гасит ResizeObserver-петли)
    this.w = nw;
    this.h = nh;
    this.layout = computeLayout(this.w, this.h);
    this.baseScale = this.layout.cardH / TEX_H;
    if (this.destroyed || !this.app) return;
    this.app.renderer.resize(this.w, this.h);
    this.app.stage.hitArea = new Rectangle(0, 0, this.w, this.h);
    this.buildTable();
    // при ресайзе не анимируем — телепортируем стопку к новому якорю
    this.cards.forEach((c, i) => c.body.snapTo(this.restTarget(i)));
    this.cards.forEach((c) => this.syncVisual(c));
    this.positionDeckHit();
    this.drawZones();
    this.wake();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.shuffleAnim = null;
    this.press = null;
    this.dragging = false;
    if (this.app) {
      this.app.ticker.remove(this.tick); // сперва глушим цикл, потом рушим сцену
      this.app.destroy({ removeView: true }, { children: true, texture: true }); // removeView убирает канвас из DOM
      this.app = null;
    }
    this.world = null;
    this.tableG = null;
    this.zoneLayer = null;
    this.shadowLayer = null;
    this.cardLayer = null;
    this.cardTex = null;
    this.shadowTex = null;
    this.deckHit = null;
    this.onDeckDoubleClick = null;
    this.onDeckDrop = null;
    this.cards = [];
  }

  // ——— внутреннее ———

  private onTick(ticker: Ticker): void {
    if (this.destroyed || !this.app) return;

    // Скорость (1х/2х/3х) масштабирует время. Интегрируем сабстепами не крупнее maxStepSec —
    // иначе на 3х пружина «взрывается». Реальный лаг кадра тоже клампим (защита от фризов вкладки).
    let remaining = Math.min(ticker.deltaMS / 1000, 0.05) * this.profile.speed;
    do {
      const dt = Math.min(remaining, anim.maxStepSec);
      remaining -= dt;

      if (this.shuffleAnim) {
        this.shuffleAnim.t += dt;
        // Ease-out воспроизведения: время растасовки замедляется под конец (мягкое оседание).
        const dur = this.shuffleAnim.choreo.durationSec;
        const warped = dur > 0 ? easeOutQuad(this.shuffleAnim.t / dur) * dur : dur;
        const targets = this.shuffleAnim.choreo.sample(warped);
        for (let i = 0; i < this.cards.length && i < targets.length; i++) {
          this.cards[i].body.setTarget(targets[i]);
        }
        if (this.shuffleAnim.t >= dur) {
          this.shuffleAnim = null;
          this.cards.forEach((c, i) => (c.sprite.zIndex = i)); // вернуть z-порядок ровной стопки
        }
      }

      for (const c of this.cards) c.body.step(dt);
    } while (remaining > 0);

    for (const c of this.cards) this.syncVisual(c);

    // Всё осело и нет активной растасовки/драга → усыпляем цикл до следующего события.
    if (!this.shuffleAnim && !this.press && this.cards.every((c) => c.body.isResting())) {
      this.sleep();
    }
  }

  private syncVisual(c: CardVisual): void {
    c.sprite.x = c.body.px;
    c.sprite.y = c.body.py;
    c.sprite.rotation = c.body.rotation;
    c.sprite.scale.set(this.baseScale * c.body.scaleVal);

    // Тень: смещена вниз-вправо, тем сильнее, чем выше «приподнята» карта (scale > 1).
    // Даёт балатро-объём — карта отрывается от стола при захвате, а в покое лёгкий контакт.
    const elev = Math.max(0, c.body.scaleVal - 1); // 0 в покое, ~0.18 при драге
    const off = this.layout.cardH;
    c.shadow.x = c.body.px + off * (0.04 + elev * 0.55);
    c.shadow.y = c.body.py + off * (0.06 + elev * 0.8);
    c.shadow.rotation = c.body.rotation;
    c.shadow.scale.set(this.baseScale * c.body.scaleVal * 1.04);
    c.shadow.alpha = 0.26 + elev * 0.5;
  }

  // Привести число спрайтов к deckCount, новые — уложить в стопку у якоря.
  private reconcileCards(): void {
    if (!this.cardLayer || !this.shadowLayer || !this.cardTex || !this.shadowTex) return;

    while (this.cards.length < this.deckCount) {
      const shadow = new Sprite(this.shadowTex);
      shadow.anchor.set(0.5);
      shadow.alpha = 0.26;
      this.shadowLayer.addChild(shadow);

      const sprite = new Sprite(this.cardTex);
      sprite.anchor.set(0.5);
      sprite.zIndex = this.cards.length; // покой: выше по стопке = выше в z (совпадает с restTarget по Y)
      const body = new CardBody();
      body.tiltScale = this.profile.tilt ? 1 : 0;
      body.snapTo(this.restTarget(this.cards.length));
      this.cardLayer.addChild(sprite);
      this.cards.push({ body, sprite, shadow });
    }
    while (this.cards.length > this.deckCount) {
      const c = this.cards.pop()!;
      c.sprite.destroy();
      c.shadow.destroy();
    }
    // В чужой сейф-зоне колода скрыта — новые спрайты не должны «проявиться».
    const away = this.deckZone === "away";
    this.cards.forEach((c) => {
      c.sprite.visible = !away;
      c.shadow.visible = !away;
    });
    this.cards.forEach((c) => this.syncVisual(c));
  }

  private restTarget(i: number): CardTargets {
    const a = this.activeAnchor();
    return { x: a.x, y: a.y - i * anim.deck.stackDy, rot: this.restJitter[i] ?? 0, scale: 1 };
  }

  private ensureJitter(n: number): void {
    while (this.restJitter.length < n) {
      this.restJitter.push((Math.random() * 2 - 1) * anim.shuffle.settle.jitter);
    }
  }

  private buildTable(): void {
    const g = this.tableG;
    if (!g) return;
    g.clear();
    const { table, center } = this.layout;

    // виртуальный овал стола: полупрозрачное сукно + золотая кромка (не буквальный стол)
    g.ellipse(table.cx, table.cy, table.rx, table.ry)
      .fill({ color: 0x123726, alpha: 0.55 })
      .stroke({ width: 6, color: 0xd9b154, alpha: 0.85 });
    // зона центра — тонкое золотое кольцо
    g.ellipse(center.cx, center.cy, center.rx, center.ry).stroke({ width: 3, color: 0xd9b154, alpha: 0.3 });
  }

  private makeCardBackTexture(app: Application): Texture {
    const g = new Graphics();
    g.roundRect(2, 2, TEX_W - 4, TEX_H - 4, 16)
      .fill({ color: 0x14281c })
      .stroke({ width: 5, color: 0xd9b154 });
    g.roundRect(16, 16, TEX_W - 32, TEX_H - 32, 10).stroke({ width: 3, color: 0x3a6b4b });
    // центральный ромб-эмблема в пиксельно-казуальном духе
    const cx = TEX_W / 2;
    const cy = TEX_H / 2;
    g.poly([cx, cy - 34, cx + 26, cy, cx, cy + 34, cx - 26, cy])
      .fill({ color: 0xd9b154, alpha: 0.9 })
      .stroke({ width: 3, color: 0x14281c });
    const tex = app.renderer.generateTexture({ target: g, resolution: 2 });
    g.destroy();
    return tex;
  }

  // Мягкая тень: несколько вложенных скруглённых прямоугольников с растущей прозрачностью
  // имитируют размытие (дёшево, без blur-фильтра). Спрайт красится в чёрный через alpha.
  private makeShadowTexture(app: Application): Texture {
    const g = new Graphics();
    const layers = 5;
    for (let i = layers; i >= 1; i--) {
      const grow = i * 6;
      g.roundRect(2 - grow, 2 - grow, TEX_W - 4 + grow * 2, TEX_H - 4 + grow * 2, 16 + grow).fill({
        color: 0x000000,
        alpha: 0.16,
      });
    }
    const tex = app.renderer.generateTexture({ target: g, resolution: 2 });
    g.destroy();
    return tex;
  }
}
