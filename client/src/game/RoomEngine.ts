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
  phase: number; // фазовый сдвиг idle-покачивания (чтобы стопка не «дышала» унисоном)
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
  private shadowLayer: Container | null = null; // слой под картами
  // ОДНА тень на всю колоду (стопка движется как целое). Раньше была тень на карту —
  // на плотной стопке полупрозрачные тени накапливали альфу в тёмное пятно.
  private deckShadow: Sprite | null = null;
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
  private onDeckDrop: ((zone: "center" | "safe") => void) | null = null;
  private onDragChange: ((active: boolean) => void) | null = null;
  // «Ударная» анимация отбоя при запрещённом дропе: затухающая тряска, t/dur — прогресс.
  private reject: { t: number; dur: number; dirX: number; dirY: number } | null = null;
  private shake = { dx: 0, dy: 0, rot: 0 }; // текущее смещение тряски отбоя (общее для колоды)

  private restJitter: number[] = [];
  private profile: AnimationProfile = resolveProfile(DEFAULT_ANIMATION_SETTINGS);
  private idleEnabled = true; // лёгкая idle-анимация карт (гасится на умеренной)
  private idleT = 0; // накопленное время для фазы idle-колебаний
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

    // Единственная тень колоды — живёт в shadowLayer под картами.
    const deckShadow = new Sprite(this.shadowTex);
    deckShadow.anchor.set(0.5);
    this.shadowLayer.addChild(deckShadow);
    this.deckShadow = deckShadow;

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
    this.updateVisibility();
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

  // Колбэк на дроп колоды в разрешённую зону (React шлёт move_deck на сервер).
  setOnDeckDrop(fn: ((zone: "center" | "safe") => void) | null): void {
    this.onDeckDrop = fn;
  }

  // Колбэк на старт/конец драга колоды (React прячет кнопки действий на время драга).
  setOnDragChange(fn: ((active: boolean) => void) | null): void {
    this.onDragChange = fn;
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
      this.onDragChange?.(true); // React прячет кнопки действий на время драга
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
    this.onDragChange?.(false); // драг закончился — вернуть кнопки действий

    const drop = pickDropZone(px, py, this.layout);
    const droppable = drop ? dropZoneRegions(this.layout)[drop].droppable : false;
    if (drop && droppable && (drop === "center" || drop === "safe") && drop !== this.deckZone) {
      this.deckZone = drop; // оптимистично двигаем локально, сервер подтвердит эхом
      this.onDeckDrop?.(drop);
    } else if (drop && !droppable) {
      // Бросок в запретную зону — «ударная» тряска и возврат на место (см. reject-анимацию).
      this.startReject(px, py);
    }
    // уложить стопку у активного якоря (промах/запрет → вернётся в текущую зону), масштаб назад к 1
    this.cards.forEach((c, i) => c.body.setTarget(this.restTarget(i)));
    this.positionDeckHit();
    this.wake();
  }

  // «Ударная» анимация запрета: короткая затухающая тряска колоды в сторону, откуда
  // её отбили (от текущего якоря к точке запретного дропа), поверх пружинного возврата.
  private startReject(px: number, py: number): void {
    const a = this.activeAnchor();
    let dx = px - a.x;
    let dy = py - a.y;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    this.reject = { t: 0, dur: 0.42, dirX: dx, dirY: dy };
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
    if (!this.dragging) return; // подсветка зон только пока тащим
    const regions = dropZoneRegions(this.layout);
    (Object.keys(regions) as DropZone[]).forEach((z) => {
      const { rect, droppable } = regions[z];
      if (rect.w <= 0 || rect.h <= 0) return;
      const active = this.hoverZone === z;
      // Разрешённые зоны — золотые, запретная — серая (нейтральный сигнал «нельзя»).
      const base = droppable ? 0xd9b154 : 0x8a8a8a;
      const hot = droppable ? 0xffe9a8 : 0xbdbdbd;
      const x = rect.cx - rect.w / 2;
      const y = rect.cy - rect.h / 2;
      if (active) {
        g.roundRect(x, y, rect.w, rect.h, rect.r).fill({ color: droppable ? 0xffe08a : 0x9a9a9a, alpha: 0.12 });
      }
      g.roundRect(x, y, rect.w, rect.h, rect.r).stroke({
        width: active ? 5 : 2.5,
        color: active ? hot : base,
        alpha: active ? 0.95 : droppable ? 0.4 : 0.55,
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

  // Разложить профиль по «железу» движка: FPS-кап, крен, idle-гейт, видимость теней.
  private applyProfile(): void {
    if (this.app) this.app.ticker.maxFPS = this.profile.fpsCap; // 0 = без ограничения
    const tiltScale = this.profile.tilt ? 1 : 0;
    for (const c of this.cards) c.body.tiltScale = tiltScale;
    // idle играет только если проходит по приоритету (полная — да, умеренная — нет).
    this.idleEnabled = shouldPlay(anim.priority.idle, this.profile);
    this.updateVisibility();
  }

  // Видимость спрайта и его тени: колода в чужой зоне скрыта целиком; тень ещё и
  // отдельным тумблером теней в профиле.
  private updateVisibility(): void {
    const away = this.deckZone === "away";
    for (const c of this.cards) c.sprite.visible = !away;
    if (this.deckShadow) {
      this.deckShadow.visible = !away && this.profile.shadows && this.cards.length > 0;
    }
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
    this.syncDeckShadow();
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
    this.deckShadow = null;
    this.cardLayer = null;
    this.cardTex = null;
    this.shadowTex = null;
    this.deckHit = null;
    this.onDeckDoubleClick = null;
    this.onDeckDrop = null;
    this.onDragChange = null;
    this.reject = null;
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

    const frameDt = Math.min(ticker.deltaMS / 1000, 0.05);
    if (this.idleRunning()) this.idleT += frameDt;
    if (this.reject) {
      this.reject.t += frameDt;
      if (this.reject.t >= this.reject.dur) this.reject = null;
    }
    this.shake = this.rejectShake();
    for (const c of this.cards) this.syncVisual(c);
    this.syncDeckShadow();

    // Всё осело, нет растасовки/драга/отбоя И нет живой idle → усыпляем цикл. При
    // включённой idle-анимации цикл не спит (карты постоянно чуть «дышат»).
    if (
      !this.shuffleAnim &&
      !this.press &&
      !this.reject &&
      !this.idleRunning() &&
      this.cards.every((c) => c.body.isResting())
    ) {
      this.sleep();
    }
  }

  // Смещение/угол «ударной» тряски отбоя (одинаковы для всей колоды). Резко затухает.
  private rejectShake(): { dx: number; dy: number; rot: number } {
    if (!this.reject) return { dx: 0, dy: 0, rot: 0 };
    const k = 1 - this.reject.t / this.reject.dur; // 1 → 0
    const osc = Math.sin(this.reject.t * 46) * k * k; // быстрая тряска с резким затуханием
    const amp = this.layout.cardH * 0.22;
    return { dx: this.reject.dirX * amp * osc, dy: this.reject.dirY * amp * osc, rot: osc * 0.14 };
  }

  // Живёт ли idle-анимация прямо сейчас (для keep-awake и накопления фазы).
  private idleRunning(): boolean {
    return this.idleEnabled && this.cards.length > 0 && this.deckZone !== "away";
  }

  private syncVisual(c: CardVisual): void {
    let rot = c.body.rotation;
    let scale = this.baseScale * c.body.scaleVal;

    // Лёгкая idle-«дыхалка»: только в покое (не во время растасовки/драга), когда
    // idle разрешён профилем. Наложение поверх пружинного состояния, тело не трогаем.
    if (this.idleEnabled && !this.shuffleAnim && !this.press && this.deckZone !== "away" && c.body.isResting()) {
      rot += anim.idle.rotAmp * Math.sin(this.idleT * anim.idle.rotFreq + c.phase);
      scale *= 1 + anim.idle.scaleAmp * Math.sin(this.idleT * anim.idle.scaleFreq + c.phase);
    }

    c.sprite.x = c.body.px + this.shake.dx;
    c.sprite.y = c.body.py + this.shake.dy;
    c.sprite.rotation = rot + this.shake.rot;
    c.sprite.scale.set(scale);
  }

  // Одна тень на всю колоду — под нижней картой стопки. Смещение/размер растут с
  // «подъёмом» (scale при захвате), альфа единая → нет накопления от перекрытий.
  private syncDeckShadow(): void {
    const s = this.deckShadow;
    if (!s) return;
    const base = this.cards[0];
    if (!base || this.shuffleAnim || this.deckZone === "away" || !this.profile.shadows) {
      s.visible = false; // при растасовке карты разлетаются — общей тени нет
      return;
    }
    s.visible = true;
    const elev = Math.max(0, base.body.scaleVal - 1); // 0 в покое, ~0.18 при захвате
    const off = this.layout.cardH;
    s.x = base.body.px + this.shake.dx + off * (0.04 + elev * 0.5);
    s.y = base.body.py + this.shake.dy + off * (0.06 + elev * 0.75);
    s.rotation = base.body.rotation + this.shake.rot;
    s.scale.set(this.baseScale * base.body.scaleVal * 1.05);
    s.alpha = 0.5 + elev * 0.4;
  }

  // Привести число спрайтов к deckCount, новые — уложить в стопку у якоря.
  private reconcileCards(): void {
    if (!this.cardLayer || !this.cardTex) return;

    while (this.cards.length < this.deckCount) {
      const sprite = new Sprite(this.cardTex);
      sprite.anchor.set(0.5);
      sprite.zIndex = this.cards.length; // покой: выше по стопке = выше в z (совпадает с restTarget по Y)
      const body = new CardBody();
      body.tiltScale = this.profile.tilt ? 1 : 0;
      body.snapTo(this.restTarget(this.cards.length));
      this.cardLayer.addChild(sprite);
      this.cards.push({ body, sprite, phase: this.cards.length * anim.idle.phaseStep });
    }
    while (this.cards.length > this.deckCount) {
      const c = this.cards.pop()!;
      c.sprite.destroy();
    }
    this.updateVisibility(); // в чужой зоне / при выкл тенях спрайты/тень не «проявятся»
    this.cards.forEach((c) => this.syncVisual(c));
    this.syncDeckShadow();
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

  // Стол больше не рисуется овалом — визуально это весь экран (фон рисует CSS).
  // Метод оставлен пустым как точка расширения (напр. подложка/виньетка позже).
  private buildTable(): void {
    this.tableG?.clear();
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

  // Мягкая тень: вложенные скруглённые прямоугольники с растущей прозрачностью имитируют
  // размытый край (дёшево, без blur-фильтра). Рисуется в текстуру ОДИН раз и живёт как
  // единственный спрайт под колодой, поэтому перекрытий/накопления альфы нет.
  private makeShadowTexture(app: Application): Texture {
    const g = new Graphics();
    const layers = 8; // больше слоёв — мягче градиент края
    for (let i = layers; i >= 1; i--) {
      const grow = i * 5;
      g.roundRect(2 - grow, 2 - grow, TEX_W - 4 + grow * 2, TEX_H - 4 + grow * 2, 16 + grow).fill({
        color: 0x000000,
        alpha: 0.1,
      });
    }
    const tex = app.renderer.generateTexture({ target: g, resolution: 2 });
    g.destroy();
    return tex;
  }
}
