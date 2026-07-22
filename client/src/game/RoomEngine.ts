import {
  Application,
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Text,
  Texture,
  type FederatedPointerEvent,
  type Ticker,
} from "pixi.js";
import { CardBody, type CardTargets } from "./CardBody";
import { computeLayout, type RoomLayout } from "./layout";
import type { DeckZone } from "./deckZone";
import { dropZoneRegions, pickDropZone, type DropZone } from "./dropZones";
import { fanCard, fanCrowd, energyEnvelope, pokeEnvelope } from "./fan";
import { parseCard, isCourt, suitColor } from "./card";
import { anim } from "./anim/config";
import {
  DEFAULT_ANIMATION_SETTINGS,
  resolveProfile,
  shouldPlay,
  type AnimationProfile,
} from "./anim/animationSettings";
import { easeOutQuad } from "./anim/easing";

interface CardVisual {
  body: CardBody;
  sprite: Sprite;
  card: string; // идентичность карты ("10♠") — для лицевой текстуры
  phase: number; // фазовый сдвиг idle-покачивания (чтобы стопка не «дышала» унисоном)
}

// Позиция-цель одной карты в анимации растасовки.
interface ShufflePose {
  x: number;
  y: number;
  rot: number;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// Логический размер текстуры рубашки (соотношение 0.7). Спрайты масштабируются от него.
const TEX_W = 160;
const TEX_H = 228;

const DRAG_SCALE = 1.18; // карты «приподнимаются» при захвате (визуальный акцент)
const DRAG_THRESHOLD = 6; // px: меньше — это тап (дабл-клик), больше — реальный драг

// Подписи зон — водяным текстом по центру каждой зоны, видны при отображении дроп-зон.
const ZONE_LABELS: Record<DropZone, string> = {
  center: "ЦЕНТР",
  safe: "СЕЙФ-ЗОНА",
  hand: "РУКА",
};

// Императивный движок комнаты: владеет ОДНИМ Pixi Application, тикером и всеми объектами.
// Никакого React-реконсайлера и «дерева нод на карту» — карты это простые CardVisual,
// которые мы мутируем сами. Именно это отличает подход от прошлого (@pixi/react + краш).
export class RoomEngine {
  private app: Application | null = null;
  private world: Container | null = null;
  private tableG: Graphics | null = null;
  private zoneLayer: Graphics | null = null; // подсветка дроп-зон при драге
  private zoneLabels: Partial<Record<DropZone, Text>> = {}; // текстовые подписи зон
  private rejectText: Text | null = null; // «низяяя» по центру во время отскока
  private shadowLayer: Container | null = null; // слой под картами
  // ОДНА тень на всю колоду (стопка движется как целое). Раньше была тень на карту —
  // на плотной стопке полупрозрачные тени накапливали альфу в тёмное пятно.
  private deckShadow: Sprite | null = null;
  private cardLayer: Container | null = null; // сами карты (сортируется для риффла)
  private backTex: Texture | null = null; // рубашка (общая; стиль сменяем)
  private shadowTex: Texture | null = null;
  private faceCache = new Map<string, Texture>(); // лицевые текстуры по ключу card|fourColor

  private cards: CardVisual[] = [];
  private layout: RoomLayout = computeLayout(1, 1);
  private w = 1;
  private h = 1;
  private baseScale = 1;

  private deckCards: string[] = []; // порядок колоды (из состояния сервера)
  private fourColor = false; // четырёхцветная колода (♦ оранж, ♣ голубой) для слабовидящих
  private deckCount = 0;
  private deckZone: DeckZone = "center";
  private deckFanned = false; // колода в сейф-зоне раскрыта веером (дабл-клик тоглит)
  private deckFaceUp = false; // колода перевёрнута лицом вверх (кнопка «Перевернуть»)
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
  private fanWiggling = false; // сейчас активна волна/дрожание тесного веера
  private fanCrowdNow = 0; // текущая теснота (0..1) — сила эффекта
  private fanWavePhase = 0; // интегрированная фаза бегущей волны (freq меняется с энергией)
  private fanJitterPhase = 0; // интегрированная фаза дрожания
  private fanKickT = 0; // время с последнего «толчка» (раскрытие/тык) — для спада энергии
  private fanEnergy = 1; // текущий множитель энергии (boost→1)
  private poke: { index: number; t: number } | null = null; // локальное «раскрытие» у тыка
  private destroyed = false;
  private mounted = false;
  private awake = false;
  // Настоящая растасовка: каждая карта летит из старого положения в новый слот ПО СВОЕЙ
  // дельте (|new-old|): близкие — коротко/низко/почти незаметно, далёкие — долго/высокой
  // дугой. z-порядок карты меняем в её апексе (когда она приподнята, далеко от слота).
  private shuffleAnim: {
    t: number;
    totalDur: number;
    entries: {
      v: CardVisual;
      from: ShufflePose;
      to: ShufflePose;
      dur: number; // своя длительность (от дельты)
      lift: number; // высота дуги (от дельты)
      lean: number; // крен в сторону движения (знак+амплитуда)
      newZ: number;
      zSwapped: boolean;
    }[];
  } | null = null;
  // «Сумбур» на время сетевого запроса: карты хаотично меняются местами, пока не пришёл
  // новый порядок (тогда оседают в него через shuffleAnim). Только у инициатора.
  private scrambleAnim: { t: number; nextAt: number } | null = null;

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

    // Подписи зон живут в zoneLayer (под тенями/картами) — «водяной» текст на фоне.
    (Object.keys(ZONE_LABELS) as DropZone[]).forEach((z) => {
      const t = new Text({
        text: ZONE_LABELS[z],
        style: { fontFamily: "VT323, monospace", fontSize: 24, fill: 0xffffff, letterSpacing: 2 },
      });
      t.anchor.set(0.5);
      t.visible = false;
      this.zoneLayer!.addChild(t);
      this.zoneLabels[z] = t;
    });

    // «низяяя» — крупный текст поверх карт, всплывает по центру во время отскока.
    this.rejectText = new Text({
      text: "низяяя",
      style: {
        fontFamily: "VT323, monospace",
        fontSize: 64,
        fill: 0xff5a4a,
        stroke: { color: 0x2a0f0c, width: 6 },
        letterSpacing: 3,
        align: "center",
      },
    });
    this.rejectText.anchor.set(0.5);
    this.rejectText.visible = false;
    this.rejectText.zIndex = 5000; // поверх карт (world.sortableChildren)
    this.world.addChild(this.rejectText);
    this.styleZoneLabels();

    this.backTex = this.makeCardBackTexture(app);
    this.shadowTex = this.makeShadowTexture(app);
    this.baseScale = this.layout.cardH / TEX_H;
    this.buildTable();

    // Единственная тень колоды — живёт в shadowLayer под картами.
    const deckShadow = new Sprite(this.shadowTex);
    deckShadow.anchor.set(0.5);
    this.shadowLayer.addChild(deckShadow);
    this.deckShadow = deckShadow;

    // Карты приедут через setDeck() (порядок из состояния сервера) — на mount их нет.

    // Невидимая интерактивная зона поверх колоды — старт драга + дабл-тап.
    const hit = new Container();
    hit.eventMode = "static";
    hit.cursor = "grab";
    hit.zIndex = 10_000; // всегда над картами
    hit.on("pointerdown", (e: FederatedPointerEvent) => this.onDeckDown(e));
    hit.on("pointertap", (e: FederatedPointerEvent) => this.handleDeckTap(e));
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

  // Порядок колоды из состояния сервера (["10♠","A♥",…]). Спрайты привязаны к ИДЕНТИЧНОСТИ
  // карты (не к индексу), поэтому реордер (растасовка) можно проиграть по-настоящему:
  // каждая карта летит из старого слота в новый. Клампим сверху (защита от абсурда).
  setDeck(cards: string[]): void {
    const newOrder = cards.slice(0, 60);
    const oldOrder = this.cards.map((c) => c.card);
    this.deckCards = newOrder;
    this.deckCount = newOrder.length;
    this.ensureJitter(this.deckCount);
    if (!this.cardLayer || !this.backTex) return; // ещё не смонтированы

    this.reconcileByIdentity(newOrder); // this.cards переставлен в новый порядок, тела на месте

    // Тот же набор карт, другой порядок → это растасовка: играем настоящий реордер
    // (если анимации разрешены). Иначе (раздача/первый заход/выкл) — просто уложить.
    const sameSet =
      oldOrder.length === newOrder.length &&
      newOrder.length > 0 &&
      [...oldOrder].sort().join("|") === [...newOrder].sort().join("|");
    const changed = oldOrder.join("|") !== newOrder.join("|");
    if (sameSet && changed && shouldPlay(anim.priority.shuffle, this.profile)) {
      this.scrambleAnim = null; // сумбур закончился — оседаем в реальный порядок
      this.startShuffleAnim(oldOrder);
    } else if (!this.shuffleAnim && !this.scrambleAnim) {
      this.cards.forEach((c, i) => {
        c.body.snapTo(this.restTarget(i));
        c.sprite.zIndex = i;
      });
    }

    this.applyCardTextures();
    this.updateVisibility();
    this.cards.forEach((c) => this.syncVisual(c));
    this.syncDeckShadow();
    this.wake();
  }

  // Четырёхцветная колода (для слабовидящих) — переключение перекрашивает лица.
  setFourColor(v: boolean): void {
    if (v === this.fourColor) return;
    this.fourColor = v;
    this.applyCardTextures(); // фейсы возьмут новый цвет (кэш по fourColor)
    this.wake();
  }

  // Перевернуть колоду лицом вверх / рубашкой вверх (кнопка). Не зависит от веера/зоны.
  setDeckFaceUp(v: boolean): void {
    if (v === this.deckFaceUp) return;
    this.deckFaceUp = v;
    this.applyCardTextures();
    this.wake();
  }

  // Зона колоды с точки зрения локального игрока (см. deckZone.ts). "center"/"safe"
  // — рисуем у соответствующего якоря; "away" (чужая сейф-зона) — колода прячется.
  setDeckZone(zone: DeckZone): void {
    if (zone === this.deckZone) return;
    this.deckZone = zone;
    if (zone !== "safe") this.deckFanned = false; // веер живёт только в сейф-зоне
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

    const drop = pickDropZone(px, py, this.layout);
    const droppable = drop ? dropZoneRegions(this.layout)[drop].droppable : false;
    const rejecting = !!drop && !droppable;
    if (rejecting) {
      // Бросок в недоступную зону — «ударный» отскок. Колода ЗАДЕРЖИВАЕТСЯ у точки дропа
      // и там играет отскок; домой уходит только по завершении reject (в onTick), иначе
      // мгновенный полёт назад «съедает» анимацию. Кнопки действий тоже НЕ возвращаем
      // здесь — onDragChange(false) вызовется в onTick, когда отскок доиграет.
      this.startReject(px, py);
    } else {
      if (drop && droppable && (drop === "center" || drop === "safe") && drop !== this.deckZone) {
        this.deckZone = drop; // оптимистично двигаем локально, сервер подтвердит эхом
        if (drop !== "safe") this.deckFanned = false; // веер живёт только в сейф-зоне
        this.onDeckDrop?.(drop);
      }
      // Всегда укладываем колоду у якоря активной зоны (новой при переносе, текущей при
      // промахе/дропе в ту же зону). Иначе карты остались бы в точке отпускания — врозь
      // с хит-зоной колоды (она у якоря), и колоду нельзя было бы снова схватить.
      this.cards.forEach((c, i) => c.body.setTarget(this.restTarget(i)));
      this.onDragChange?.(false); // взаимодействие завершено — вернуть кнопки
    }
    this.positionDeckHit();
    this.wake();
  }

  // «Ударный» отскок при запрещённом дропе: колода держится у точки удара и делает
  // затухающие колебания В СТОРОНУ ДОМА (как отбитая от зоны), затем возвращается.
  private startReject(px: number, py: number): void {
    const a = this.activeAnchor();
    let dx = a.x - px; // направление к дому — туда «отскакивает» колода
    let dy = a.y - py;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    this.reject = { t: 0, dur: 0.5, dirX: dx, dirY: dy };
    // Держим колоду у точки удара на время отскока (не улетает домой сразу).
    for (let i = 0; i < this.cards.length; i++) {
      this.cards[i].body.setTarget({ x: px, y: py - i * anim.deck.stackDy, scale: DRAG_SCALE, rot: this.restJitter[i] ?? 0 });
    }
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
    const regions = dropZoneRegions(this.layout);
    (Object.keys(regions) as DropZone[]).forEach((z) => {
      const { rect, droppable } = regions[z];
      const label = this.zoneLabels[z];
      // Зоны и подписи видны только пока тащим колоду.
      if (!this.dragging || rect.w <= 0 || rect.h <= 0) {
        if (label) label.visible = false;
        return;
      }
      const active = this.hoverZone === z;
      // Разрешённые зоны — золотые, недоступная (рука) — серая.
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
      if (label) {
        label.x = rect.cx;
        label.y = rect.cy;
        label.visible = true;
        label.tint = active ? hot : base;
        label.alpha = active ? 0.5 : 0.22; // «водяной» текст на фоне
      }
    });
  }

  // Размер шрифта подписей/«низяяя» от размера карты (обновляется на ресайзе).
  private styleZoneLabels(): void {
    const size = Math.min(44, Math.max(14, this.layout.cardH * 0.5));
    for (const z of Object.keys(this.zoneLabels) as DropZone[]) {
      const t = this.zoneLabels[z];
      if (t) t.style.fontSize = size;
    }
    if (this.rejectText) this.rejectText.style.fontSize = Math.min(110, Math.max(34, this.layout.cardH * 1.2));
  }

  // «низяяя» по центру экрана во время отскока: та же тряска, что и у колоды, плюс
  // пульс масштаба и затухание к концу анимации.
  private syncRejectText(): void {
    const t = this.rejectText;
    if (!t) return;
    if (!this.reject) {
      if (t.visible) t.visible = false;
      return;
    }
    const p = this.reject.t / this.reject.dur; // 0 → 1
    t.visible = true;
    t.x = this.w / 2 + this.shake.dx;
    t.y = this.h / 2 + this.shake.dy;
    t.rotation = this.shake.rot;
    t.scale.set(1 + 0.3 * (1 - p)); // крупнее в начале, оседает к 1
    t.alpha = Math.max(0, Math.min(1, (1 - p) * 1.8)); // держится, затем гаснет
  }

  private handleDeckTap(e: FederatedPointerEvent): void {
    if (!this.deckDraggable) return; // двигать/раскрывать колоду может только дилер (в лобби)
    const now = performance.now();
    const isDouble = now - this.lastDeckTapMs < 350;
    this.lastDeckTapMs = isDouble ? 0 : now;

    if (this.deckZone === "safe" && this.deckFanned) {
      // Одиночный тык = «поковырять»: ре-энергия + локально раздвинуть карты у тыка.
      this.pokeFan(e.global.x);
      if (isDouble) this.toggleFan(); // двойной — собрать веер
    } else if (this.deckZone === "safe") {
      if (isDouble) this.toggleFan(); // раскрыть веер
    } else if (isDouble) {
      // В центре дабл-клик переносит колоду в сейф-зону и СРАЗУ раскрывает веер.
      this.deckZone = "safe";
      this.deckFanned = true;
      this.cards.forEach((c, i) => c.body.setTarget(this.restTarget(i)));
      this.positionDeckHit();
      this.onDeckDoubleClick?.(); // сервер подтвердит перенос эхом
      this.wake();
    }
  }

  private toggleFan(): void {
    this.deckFanned = !this.deckFanned;
    this.cards.forEach((c, i) => c.body.setTarget(this.restTarget(i)));
    this.positionDeckHit();
    this.wake();
  }

  private positionDeckHit(): void {
    if (!this.deckHit) return;
    // Раскрытый веер — расширяем хит-зону на всю сейф-зону, чтобы дабл-клик по любой
    // карте веера собирал его обратно (и чтобы можно было схватить всю колоду).
    if (this.deckZone === "safe" && this.deckFanned) {
      const z = this.layout.safeZone;
      this.deckHit.hitArea = new Rectangle(z.cx - z.w / 2, z.cy - z.h / 2, z.w, z.h);
      return;
    }
    const a = this.activeAnchor();
    const w = this.layout.cardW * 1.3;
    const h = this.layout.cardH * 1.3;
    this.deckHit.hitArea = new Rectangle(a.x - w / 2, a.y - h / 2, w, h);
  }

  // Собрать анимацию настоящей растасовки, ПО ДЕЛЬТЕ каждой карты (|new-old|): близкие
  // едут коротко/низко/почти незаметно, далёкие — долго высокой дугой с креном в сторону
  // движения. this.cards уже в новом порядке; oldOrder — прежний (для дельты).
  private startShuffleAnim(oldOrder: string[]): void {
    const n = this.cards.length;
    if (n === 0) return;
    const oldIndex = new Map<string, number>();
    oldOrder.forEach((c, i) => oldIndex.set(c, i));
    const speed = Math.max(1, this.profile.speed);
    const H = this.layout.cardH;
    const entries = this.cards.map((v, j) => {
      const oi = oldIndex.get(v.card) ?? j;
      const nd = n > 1 ? Math.abs(j - oi) / (n - 1) : 0; // 0..1 нормированная дельта
      const to = this.restTarget(j);
      const toPose: ShufflePose = { x: to.x ?? 0, y: to.y ?? 0, rot: to.rot ?? 0 };
      const from: ShufflePose = { x: v.body.px, y: v.body.py, rot: v.body.rotation };
      const lean = (toPose.x >= from.x ? 1 : -1) * lerp(0.04, 0.5, nd);
      return {
        v,
        from,
        to: toPose,
        dur: lerp(0.14, 0.9, nd) / speed, // близкие быстро, далёкие долго
        lift: lerp(H * 0.12, H * 1.4, nd), // маленькая/большая дуга
        lean,
        newZ: j,
        zSwapped: false,
      };
    });
    const totalDur = entries.reduce((m, e) => Math.max(m, e.dur), 0);
    this.shuffleAnim = { t: 0, totalDur, entries };
  }

  // «Сумбур» на время запроса: запускается по нажатию «Растасовать» (до прихода нового
  // порядка). Карты хаотично меняются местами; когда порядок придёт — оседают в него.
  startScramble(): void {
    if (this.destroyed || this.cards.length === 0 || this.shuffleAnim) return;
    if (!shouldPlay(anim.priority.shuffle, this.profile)) return; // на выкл-анимациях без сумбура
    this.scrambleAnim = { t: 0, nextAt: 0 };
    this.wake();
  }

  // Шаг «сумбура»: раз в ~0.16с раскидываем карты по СЛУЧАЙНОЙ перестановке слотов —
  // они хаотично меняются местами. Прервётся, когда придёт новый порядок (setDeck).
  private stepScramble(dt: number): void {
    const sc = this.scrambleAnim;
    if (!sc) return;
    sc.t += dt;
    if (sc.t >= sc.nextAt) {
      const n = this.cards.length;
      const slots = this.cards.map((_, i) => this.restTarget(i));
      const perm = [...Array(n).keys()];
      for (let i = n - 1; i > 0; i--) {
        const k = Math.floor(Math.random() * (i + 1));
        [perm[i], perm[k]] = [perm[k], perm[i]];
      }
      const rise = this.layout.cardH * 0.3;
      this.cards.forEach((c, i) => {
        const s = slots[perm[i]];
        c.body.setTarget({ x: s.x ?? 0, y: (s.y ?? 0) - rise, rot: (s.rot ?? 0) + (Math.random() * 2 - 1) * 0.15 });
        c.sprite.zIndex = perm[i];
      });
      sc.nextAt = sc.t + 0.16;
    }
    // Страховка от «вечного» сумбура, если новый порядок так и не пришёл.
    if (sc.t > 1.4) {
      this.scrambleAnim = null;
      this.cards.forEach((c, i) => c.body.setTarget(this.restTarget(i)));
    }
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
    this.styleZoneLabels();
    this.drawZones();
    this.wake();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.shuffleAnim = null;
    this.scrambleAnim = null;
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
    this.zoneLabels = {};
    this.rejectText = null;
    this.shadowLayer = null;
    this.deckShadow = null;
    this.cardLayer = null;
    this.backTex = null;
    this.shadowTex = null;
    this.faceCache.forEach((t) => t.destroy(true));
    this.faceCache.clear();
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

      if (this.scrambleAnim) this.stepScramble(dt);

      if (this.shuffleAnim) {
        const sa = this.shuffleAnim;
        sa.t += dt;
        for (const e of sa.entries) {
          const p = Math.min(1, e.dur > 0 ? sa.t / e.dur : 1);
          const u = easeOutQuad(p);
          const arc = Math.sin(Math.PI * p); // 0 → 1 (апекс) → 0
          e.v.body.setTarget({
            x: lerp(e.from.x, e.to.x, u),
            y: lerp(e.from.y, e.to.y, u) - e.lift * arc,
            rot: lerp(e.from.rot, e.to.rot, u) + e.lean * arc,
          });
          // z-порядок карты меняем в ЕЁ апексе (она приподнята над слотом) — без «поп».
          if (p >= 0.5 && !e.zSwapped) {
            e.v.sprite.zIndex = e.newZ;
            e.zSwapped = true;
          }
        }
        if (sa.t >= sa.totalDur) {
          for (const e of sa.entries) {
            e.v.body.setTarget(e.to);
            e.v.sprite.zIndex = e.newZ;
          }
          this.shuffleAnim = null;
        }
      }

      for (const c of this.cards) c.body.step(dt);
    } while (remaining > 0);

    const frameDt = Math.min(ticker.deltaMS / 1000, 0.05);
    if (this.idleRunning()) this.idleT += frameDt;

    // «Червячок» тесного веера + локальный поке.
    const wiggle = this.fanWiggleActive();
    if (wiggle) {
      if (!this.fanWiggling) this.fanKickT = 0; // старт — с буста энергии
      const w = anim.fan.wiggle;
      this.fanKickT += frameDt;
      this.fanCrowdNow = this.fanCrowd();
      this.fanEnergy = energyEnvelope(this.fanKickT, w.decayTime, w.boost);
      const baseFreq = this.profile.tilt ? w.freq : w.moderateFreq; // умеренная медленнее
      this.fanWavePhase += baseFreq * this.fanEnergy * frameDt; // быстрее при высокой энергии
      this.fanJitterPhase += w.jitterFreq * this.fanEnergy * frameDt;
      if (this.poke) {
        this.poke.t += frameDt;
        if (pokeEnvelope(this.poke.t, w.poke.in, w.poke.hold, w.poke.out) <= 0 && this.poke.t > w.poke.in) {
          this.poke = null; // поке доиграл
        }
      }
      this.applyFanWave();
    } else if (this.fanWiggling) {
      // эффект закончился (собрали веер / стало просторно / поке доиграл) — ровный веер
      this.cards.forEach((c, i) => c.body.setTarget(this.restTarget(i)));
      this.fanCrowdNow = 0;
      this.poke = null;
    }
    this.fanWiggling = wiggle;

    if (this.reject) {
      this.reject.t += frameDt;
      if (this.reject.t >= this.reject.dur) {
        this.reject = null;
        // Отскок доигран — укладываем колоду у якоря и только ТЕПЕРЬ возвращаем кнопки.
        this.cards.forEach((c, i) => c.body.setTarget(this.restTarget(i)));
        this.onDragChange?.(false);
      }
    }
    this.shake = this.rejectShake();
    for (const c of this.cards) this.syncVisual(c);
    this.syncDeckShadow();
    this.syncRejectText();

    // Всё осело, нет растасовки/драга/отбоя И нет живой idle → усыпляем цикл. При
    // включённой idle-анимации цикл не спит (карты постоянно чуть «дышат»).
    if (
      !this.shuffleAnim &&
      !this.scrambleAnim &&
      !this.press &&
      !this.reject &&
      !this.idleRunning() &&
      !this.fanWiggling &&
      this.cards.every((c) => c.body.isResting())
    ) {
      this.sleep();
    }
  }

  // Смещение/угол «ударного» отскока (одинаковы для всей колоды). Стартует с МАКСИМУМА
  // (cos(0)=1) — читается резкий удар — и затухает колебаниями к нулю.
  private rejectShake(): { dx: number; dy: number; rot: number } {
    if (!this.reject) return { dx: 0, dy: 0, rot: 0 };
    const p = this.reject.t / this.reject.dur; // 0 → 1
    const env = (1 - p) * (1 - p); // квадратичное затухание
    const osc = Math.cos(this.reject.t * 34) * env; // старт на максимуме, затем колебания
    const amp = this.layout.cardH * 0.38;
    return { dx: this.reject.dirX * amp * osc, dy: this.reject.dirY * amp * osc, rot: osc * 0.18 };
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
    if (this.idleEnabled && !this.shuffleAnim && !this.scrambleAnim && !this.press && !this.reject && this.deckZone !== "away" && c.body.isResting()) {
      rot += anim.idle.rotAmp * Math.sin(this.idleT * anim.idle.rotFreq + c.phase);
      scale *= 1 + anim.idle.scaleAmp * Math.sin(this.idleT * anim.idle.scaleFreq + c.phase);
    }

    // Дрожание тесного веера — только на полной анимации (умеренная = лишь волна),
    // амплитуда ×crowd×energy (теснее/после тыка — сильнее). Поверх пружинного состояния.
    if (this.fanWiggling && this.profile.tilt) {
      const w = anim.fan.wiggle;
      rot += this.fanCrowdNow * this.fanEnergy * w.jitterRotAmp * Math.sin(this.fanJitterPhase + c.phase);
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
    if (!base || this.shuffleAnim || this.scrambleAnim || this.deckZone === "away" || !this.profile.shadows) {
      s.visible = false; // при растасовке/сумбуре карты разлетаются — общей тени нет
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

  // Переставить this.cards в порядок newOrder, ПЕРЕИСПОЛЬЗУЯ спрайты по идентичности карты
  // (тела остаются на текущих местах — их двигает анимация). Новые карты создаём и кладём
  // на место сразу; исчезнувшие (раздача) — уничтожаем.
  private reconcileByIdentity(newOrder: string[]): void {
    const byCard = new Map<string, CardVisual>();
    for (const c of this.cards) if (c.card) byCard.set(c.card, c);

    const next: CardVisual[] = [];
    for (let j = 0; j < newOrder.length; j++) {
      const card = newOrder[j];
      let v = byCard.get(card);
      if (v) {
        byCard.delete(card); // переиспользуем — СТАРЫЙ zIndex сохраняем (растасовка сменит в апексе)
      } else {
        v = this.createCardVisual(card);
        v.body.snapTo(this.restTarget(j)); // новая карта появляется сразу на месте
        v.sprite.zIndex = j;
      }
      v.card = card;
      v.phase = j * anim.idle.phaseStep;
      next.push(v);
    }
    for (const leftover of byCard.values()) leftover.sprite.destroy(); // раздали/убрали из колоды
    this.cards = next;
  }

  private createCardVisual(card: string): CardVisual {
    const sprite = new Sprite(this.backTex!);
    sprite.anchor.set(0.5);
    const body = new CardBody();
    body.tiltScale = this.profile.tilt ? 1 : 0;
    this.cardLayer!.addChild(sprite);
    return { body, sprite, card, phase: 0 };
  }

  // Лицо или рубашка на каждой карте — по флагу deckFaceUp (кнопка «Перевернуть»).
  // Не зависит от веера/зоны. Рубашка/лицо — сменяемые текстуры (стиль колоды).
  private applyCardTextures(): void {
    for (const c of this.cards) {
      c.sprite.texture = this.deckFaceUp && c.card ? this.faceTexFor(c.card) : this.backTex!;
    }
  }

  private faceTexFor(card: string): Texture {
    const key = `${card}|${this.fourColor ? 1 : 0}`;
    let tex = this.faceCache.get(key);
    if (!tex) {
      tex = this.makeCardFaceTexture(card);
      this.faceCache.set(key, tex);
    }
    return tex;
  }

  // Лицевая текстура: кремовый фон, ранг+масть по углам и крупный символ по центру
  // (для J/Q/K — буква-заглушка, картинки добавим позже), цвет по масти (четырёхцв./классика).
  private makeCardFaceTexture(card: string): Texture {
    if (!this.app) return this.backTex!;
    const { rank, suit } = parseCard(card);
    const color = suitColor(suit, this.fourColor);
    const root = new Container();

    const bg = new Graphics();
    bg.roundRect(2, 2, TEX_W - 4, TEX_H - 4, 16).fill({ color: 0xf4ecd8 }).stroke({ width: 4, color: 0x14281c });
    root.addChild(bg);

    const cornerStyle = { fontFamily: "VT323, monospace", fontSize: 40, fill: color, align: "center" as const, lineHeight: 34 };
    const tl = new Text({ text: `${rank}\n${suit}`, style: cornerStyle });
    tl.anchor.set(0.5);
    tl.position.set(28, 42);
    root.addChild(tl);
    const br = new Text({ text: `${rank}\n${suit}`, style: cornerStyle });
    br.anchor.set(0.5);
    br.position.set(TEX_W - 28, TEX_H - 42);
    br.rotation = Math.PI;
    root.addChild(br);

    const court = isCourt(rank);
    const center = new Text({
      text: court ? rank : suit,
      style: { fontFamily: "VT323, monospace", fontSize: court ? 96 : 120, fill: color },
    });
    center.anchor.set(0.5);
    center.position.set(TEX_W / 2, TEX_H / 2 + 6);
    root.addChild(center);

    const tex = this.app.renderer.generateTexture({ target: root, resolution: 2 });
    root.destroy({ children: true });
    return tex;
  }

  private restTarget(i: number): CardTargets {
    if (this.deckZone === "safe" && this.deckFanned) return this.fanTarget(i);
    const a = this.activeAnchor();
    return { x: a.x, y: a.y - i * anim.deck.stackDy, rot: this.restJitter[i] ?? 0, scale: 1 };
  }

  // Веер-дуга в сейф-зоне (чистая математика — см. fan.ts). i может быть дробным
  // (для волны «червячка», где карта плавно ездит между слотами).
  private fanTarget(i: number): CardTargets {
    const c = fanCard(
      i,
      Math.max(1, this.deckCount),
      this.layout.safeAnchor,
      this.layout.safeZone.w,
      anim.fan.maxAngleDeg,
      anim.fan.widthFactor,
    );
    return { x: c.x, y: c.y, rot: c.rot, scale: 1 };
  }

  // Теснота текущего веера (0..1) — по ней включается/масштабируется «червячок».
  private fanCrowd(): number {
    const w = anim.fan.wiggle;
    return fanCrowd(this.deckCount, this.layout.safeZone.w, this.layout.cardW, anim.fan.widthFactor, w.gap, w.ramp);
  }

  // Активен ли «червячок»: раскрытый веер в сейф-зоне (тесно ИЛИ идёт локальный поке),
  // и не идёт другая анимация.
  private fanWiggleActive(): boolean {
    return (
      this.deckZone === "safe" &&
      this.deckFanned &&
      this.deckCount > 1 &&
      !this.shuffleAnim &&
      !this.scrambleAnim &&
      !this.press &&
      (this.fanCrowd() > 0 || this.poke !== null)
    );
  }

  // Индекс карты веера, ближайшей по x к точке тыка (по текущим позициям спрайтов).
  private nearestFanIndex(x: number): number {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < this.cards.length; i++) {
      const d = Math.abs(this.cards[i].sprite.x - x);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  // Тык по вееру: ре-энергия (волна/дрожь ускоряются), гребень волны — от точки тыка,
  // и локальное «раскрытие» ~cards карт вокруг, чтобы прочитать номиналы.
  private pokeFan(x: number): void {
    if (this.deckZone !== "safe" || !this.deckFanned || this.deckCount < 2) return;
    const n = Math.max(2, this.deckCount);
    const pi = this.nearestFanIndex(x);
    this.poke = { index: pi, t: 0 };
    this.fanKickT = 0; // ре-энергия
    // Гребень бегущей волны стартует у точки тыка — «усиленно с того места».
    this.fanWavePhase = anim.fan.wiggle.cycles * Math.PI * 2 * (pi / (n - 1)) - Math.PI / 2;
    this.wake();
  }

  // Локальный сдвиг карты i из-за поке: карты слева от тыка едут влево, справа — вправо,
  // раздвигая ~cards карт у точки тыка (в окне — линейно, дальше — постоянный сдвиг).
  private pokeShiftAt(i: number): number {
    if (!this.poke) return 0;
    const p = anim.fan.wiggle.poke;
    const env = pokeEnvelope(this.poke.t, p.in, p.hold, p.out);
    if (env <= 0) return 0;
    const half = p.cards / 2;
    const s = Math.max(-1, Math.min(1, (i - this.poke.index) / half)); // -1..1 через окно
    return p.amp * env * s * 0.5;
  }

  // Бегущая волна + локальный поке: каждая карта ездит вдоль веера. Волна ×crowd×energy,
  // фаза интегрируется (см. onTick). Дрожание — оверлеем в syncVisual (только полная).
  private applyFanWave(): void {
    const n = Math.max(2, this.deckCount);
    const w = anim.fan.wiggle;
    const waveScale = this.fanCrowdNow * w.amp * this.fanEnergy;
    for (let i = 0; i < this.cards.length; i++) {
      const wave = waveScale * Math.sin(w.cycles * Math.PI * 2 * (i / (n - 1)) - this.fanWavePhase);
      const vi = Math.max(0, Math.min(n - 1, i + wave + this.pokeShiftAt(i)));
      const t = this.fanTarget(vi);
      this.cards[i].body.setTarget({ x: t.x, y: t.y, rot: t.rot });
    }
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
