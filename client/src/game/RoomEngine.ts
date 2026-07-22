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
import {
  fanCard,
  fanCrowd,
  energyEnvelope,
  pokeEnvelope,
  fanBandContains,
  fanInsertIndex,
  visibleSliver,
  fanSpreadShift,
} from "./fan";
import { shuffleFlight, bulgeDir } from "./shuffleFlight";
import { moveCard } from "./deckOrder";
import {
  swipeStrength,
  swipeCardCount,
  swipeDirections,
  swipeVelocity,
  swipeCardIndices,
  type Dir,
  type SwipeSample,
} from "./swipeShuffle";
import {
  stackOffset,
  stackExtent,
  stackStripeIndices,
  lightShadowOffset,
  deckZoneScale,
} from "./deckStack";
import { parseCard, isCourt, suitColor } from "./card";
import {
  cardBackSkin,
  latticeCenters,
  mosaicTiles,
  DEFAULT_CARD_BACK,
  type CardBackId,
} from "./cardBack";
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

const ZERO_SHAKE = { dx: 0, dy: 0, rot: 0 };

// Кромка карты (толщина бумаги): низ светло-серый, бока темнее — свет сверху справа.
const CARD_EDGE = { bottom: 0xa8a8a8, side: 0x6e6e6e, width: 4 };

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
  private cardBack: CardBackId = DEFAULT_CARD_BACK; // скин рубашки (меню → Графика)
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
  // Драг ОДНОЙ карты из раскрытого веера. Жест — длинное нажатие (holdMs): коротким
  // тапом «ковыряют» веер (poke), поэтому хватать карту сразу нельзя. Пока веер раскрыт,
  // драг всей колоды выключен — тащим карту; собери веер, чтобы двигать колоду.
  private cardPress: {
    id: number;
    startX: number;
    startY: number;
    x: number;
    y: number;
    index: number;
    canGrab: boolean; // на момент нажатия карта была видна достаточно, чтобы её взять
    samples: SwipeSample[]; // короткая история движения — по ней считается скорость свайпа
  } | null = null;
  private cardDrag: { id: number; v: CardVisual; insertAt: number; x: number; y: number } | null = null;
  private cardShadow: Sprite | null = null;
  // «Выплеск» по свайпу вверх: несколько карт вылетают из веера и возвращаются, пока
  // сервер тасует. Базовая точка каждой карты берётся из restTarget КАЖДЫЙ кадр, поэтому
  // если новый порядок придёт в полёте, карта просто вернётся уже в новый слот.
  private splashAnim: { t: number; dur: number; entries: { v: CardVisual; dir: Dir; dist: number; spin: number; z: number }[] } | null = null;
  private onSwipeShuffle: ((cards: string[]) => void) | null = null;

  // «Кирпич» колоды: торцы карт под верхней, одной Graphics вместо полусотни спрайтов.
  private deckBody: Graphics | null = null;
  private deckBodyCount = -1; // на сколько карт нарисован блок (перерисовываем при смене)
  private skipNextTap = false; // гасит pointertap, прилетающий сразу после дропа карты
  private onCardReorder: ((card: string, to: number) => void) | null = null;
  // Разрешено ли класть карту в зоны (центр/рука). Во время раздачи — нет: карту можно
  // только переставить внутри веера. Сеттер — задел под игровые правила.
  private cardDropZonesAllowed = false;

  // «Ударная» анимация отбоя при запрещённом дропе: затухающая тряска, t/dur — прогресс.
  private reject: { t: number; dur: number; dirX: number; dirY: number } | null = null;
  // Если отбой относится к одной карте (а не ко всей колоде) — трясём только её.
  private rejectCard: CardVisual | null = null;
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
  // Локальное «раскрытие» у тыка (тач). index — анимированный (плавно едет к target),
  // чтобы повторный тык рядом ПЕРЕВОЗИЛ раскрытие, а не перезапускал его рывком.
  private poke: { index: number; target: number; t: number } | null = null;
  // Ховер мышью (десктоп) заменяет тык: раскрытие следует за курсором, держится пока навёл.
  private hoverIndex = 0;
  private hoverTarget = 0; // 1 пока курсор над веером, иначе 0
  private hoverEnv = 0; // сглаженная огибающая ховера (0..1)
  private destroyed = false;
  private mounted = false;
  private awake = false;
  // Настоящая растасовка: каждая карта летит из старого положения в новый слот ПО СВОЕЙ
  // дельте (|new-old|) — дальние дольше и выше, ближние с бо́льшим боковым выносом, но
  // ЗАМЕТНО летят все (см. shuffleFlight.ts). z-порядок меняем в апексе карты, когда она
  // приподнята и вынесена вбок — там перещёлк не читается как подмена карты на месте.
  private shuffleAnim: {
    t: number;
    totalDur: number;
    entries: {
      v: CardVisual;
      from: ShufflePose;
      to: ShufflePose;
      delay: number; // сдвиг старта — каскад волной по колоде
      dur: number; // своя длительность (от дельты)
      lift: number; // высота дуги (от дельты)
      bulge: number; // боковой вынос на апексе (знак = сторона)
      lean: number; // крен в сторону выноса (знак+амплитуда)
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

    // Отдельная тень под ОДНОЙ картой, которую тащат из веера (общая тень колоды в этот
    // момент лежит под самим веером и «поднятую» карту не показывает).
    const cardShadow = new Sprite(this.shadowTex);
    cardShadow.anchor.set(0.5);
    cardShadow.visible = false;
    this.shadowLayer.addChild(cardShadow);
    this.cardShadow = cardShadow;

    // «Кирпич» колоды живёт в слое карт под ними: верхняя карта — настоящий спрайт,
    // всё, что под ней, рисуется одной Graphics (см. drawDeckBody).
    const body = new Graphics();
    body.zIndex = -1;
    this.cardLayer.addChild(body);
    this.deckBody = body;

    // Карты приедут через setDeck() (порядок из состояния сервера) — на mount их нет.

    // Невидимая интерактивная зона поверх колоды — старт драга + дабл-тап.
    const hit = new Container();
    hit.eventMode = "static";
    hit.cursor = "grab";
    hit.zIndex = 10_000; // всегда над картами
    hit.on("pointerdown", (e: FederatedPointerEvent) => this.onDeckDown(e));
    hit.on("pointertap", (e: FederatedPointerEvent) => this.handleDeckTap(e));
    hit.on("pointermove", (e: FederatedPointerEvent) => this.onDeckHover(e)); // ховер мышью (десктоп)
    hit.on("pointerout", (e: FederatedPointerEvent) => this.onDeckHoverOut(e));
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
    } else if (sameSet && !changed) {
      // Порядок ровно тот же — это эхо нашего же оптимистичного реордера (драг карты).
      // Ничего не двигаем: карта как раз доезжает пружиной в новый слот.
    } else if (!this.shuffleAnim && !this.scrambleAnim && !this.cardDrag) {
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

  // Скин рубашки: перерисовываем текстуру и раздаём её картам (лица не трогаем).
  setCardBack(id: CardBackId): void {
    if (id === this.cardBack) return;
    this.cardBack = id;
    if (!this.app) return;
    const old = this.backTex;
    this.backTex = this.makeCardBackTexture(this.app);
    this.applyCardTextures();
    this.drawDeckBody(); // торцы блока красятся под скин
    old?.destroy(true);
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

  // Колбэк на перестановку карты в колоде (драг карты в раскрытом веере) — React шлёт
  // reorder_deck на сервер, тот подтверждает эхом.
  setOnCardReorder(fn: ((card: string, to: number) => void) | null): void {
    this.onCardReorder = fn;
  }

  // Свайп вверх по вееру: движок играет выплеск, React шлёт на сервер список выброшенных
  // карт (scatter_cards) — врезаются обратно только они.
  setOnSwipeShuffle(fn: ((cards: string[]) => void) | null): void {
    this.onSwipeShuffle = fn;
  }

  // Можно ли уронить ОДНУ карту в зоны (центр/рука). Во время раздачи — нельзя (отскок).
  setCardDropZonesAllowed(v: boolean): void {
    this.cardDropZonesAllowed = v;
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
    this.skipNextTap = false; // новый жест — прошлое подавление тапа больше не актуально
    if (!this.deckDraggable || this.deckZone === "away") return;
    // Веер раскрыт → жест относится к КАРТЕ, а не к колоде: колода целиком не таскается,
    // пока веер не собран. Драг карты начнётся только после удержания (см. onTick).
    if (this.fanOpen()) {
      if (this.cardPress || this.cardDrag) return;
      const index = this.nearestFanIndex(e.global.x);
      // Зажатый веер не таскаем: пока карта не показала достаточную полоску, её не за что
      // взять. Но палец не игнорируем — ведение по вееру раскрывает его под пальцем
      // («глиссандо», см. onPointerMove), и уже в открытый зазор карту можно брать.
      const canGrab = this.canGrabAt(index);
      this.cardPress = {
        id: e.pointerId,
        startX: e.global.x,
        startY: e.global.y,
        x: e.global.x,
        y: e.global.y,
        index,
        canGrab,
        samples: [{ x: e.global.x, y: e.global.y, t: performance.now() }],
      };
      this.wake();
      return;
    }
    if (this.press) return;
    this.press = { id: e.pointerId, startX: e.global.x, startY: e.global.y, x: e.global.x, y: e.global.y };
    if (this.deckHit) this.deckHit.cursor = "grabbing";
  }

  private onPointerMove(e: FederatedPointerEvent): void {
    if (this.cardDrag && e.pointerId === this.cardDrag.id) {
      this.cardDrag.x = e.global.x;
      this.cardDrag.y = e.global.y;
      this.cardDrag.insertAt = this.insertIndexAt(e.global.x);
      this.hoverZone = pickDropZone(e.global.x, e.global.y, this.layout);
      this.applyCardDragTargets();
      this.drawZones();
      this.wake();
      return;
    }
    if (this.cardPress && e.pointerId === this.cardPress.id) {
      const p = this.cardPress;
      p.samples.push({ x: e.global.x, y: e.global.y, t: performance.now() });
      if (p.samples.length > 12) p.samples.shift();
      p.x = e.global.x;
      p.y = e.global.y;
      // Резкий бросок ВВЕРХ по вееру — это «перемешать». Медленное ведение (скролл/
      // глиссандо) сюда не проходит: нужна и скорость по окну, и пройденный путь вверх.
      const v = swipeVelocity(p.samples, anim.swipe.windowMs);
      if (this.isSwipeUp(v.vx, v.vy, p.startY - p.y)) {
        this.startSwipeShuffle(v.vx, v.vy, p.index);
        this.cardPress = null;
        return;
      }
      const dx = this.cardPress.x - this.cardPress.startX;
      const dy = this.cardPress.y - this.cardPress.startY;
      if (dx * dx + dy * dy < DRAG_THRESHOLD * DRAG_THRESHOLD) return; // ещё тык, не жест
      // Захват МГНОВЕННЫЙ: ждём не время, а само движение. Если же в момент нажатия веер
      // был зажат — ведение пальцем раскрывает его под пальцем, как глиссандо по клавишам.
      if (this.cardPress.canGrab) this.beginCardDrag();
      else this.glissandoTo(e.global.x);
      return;
    }
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
    if (this.cardDrag && e.pointerId === this.cardDrag.id) {
      this.dropCard(e.global.x, e.global.y);
      return;
    }
    if (this.cardPress && e.pointerId === this.cardPress.id) {
      this.cardPress = null; // пальцем не двинули — это тап (poke/дабл-клик ловит pointertap)
      return;
    }
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

  // ——— драг одной карты из веера ———

  private fanOpen(): boolean {
    return this.deckZone === "safe" && this.deckFanned && this.cards.length > 0;
  }

  // Достаточно ли видна карта, чтобы её взять. Считаем по фактическим позициям спрайтов:
  // в зажатом веере полоска карты — пара пикселей, тащить нечего, сначала раздвинь тыком
  // или ховером (они и дают нужный зазор).
  private canGrabAt(index: number): boolean {
    const xs = this.cards.map((c) => c.sprite.x);
    return visibleSliver(xs, index) >= this.layout.cardW * anim.cardDrag.minGrabSliver;
  }

  // В какой слот веера встанет карта, если отпустить её на координате x.
  private insertIndexAt(x: number): number {
    return fanInsertIndex(
      x,
      this.layout.safeAnchor,
      this.layout.safeZone.w,
      Math.max(1, this.deckCount),
      anim.fan.maxAngleDeg,
      anim.fan.widthFactor,
    );
  }

  // Точка в области веера (полоса дуги ∪ прямоугольник сейф-зоны) — то же, что хит-зона:
  // отпустил здесь → карта переставляется в колоде, а не «уходит» в другую зону.
  private inFanArea(x: number, y: number): boolean {
    const z = this.layout.safeZone;
    if (Math.abs(x - z.cx) <= z.w / 2 && Math.abs(y - z.cy) <= z.h / 2) return true;
    const l = this.layout;
    return fanBandContains(x, y, l.safeAnchor, z.w, anim.fan.maxAngleDeg, anim.fan.widthFactor, l.cardW, l.cardH, l.cardH * 0.5);
  }

  // Удержание состоялось — карта под пальцем «прилипает» к нему и выходит из веера.
  private beginCardDrag(): void {
    const p = this.cardPress;
    if (!p || this.cards.length === 0) return;
    const v = this.cards[Math.max(0, Math.min(this.cards.length - 1, p.index))];
    this.cardPress = null;
    this.poke = null; // раскрытие/ховер веера на время драга не нужны
    this.hoverTarget = 0;
    this.cardDrag = { id: p.id, v, insertAt: this.insertIndexAt(p.x), x: p.x, y: p.y };
    v.sprite.zIndex = 100_000; // над всеми картами (но под хит-зоной колоды)
    if (this.deckHit) this.deckHit.cursor = "grabbing";
    this.hoverZone = pickDropZone(p.x, p.y, this.layout);
    this.applyCardDragTargets();
    this.drawZones();
    this.onDragChange?.(true); // React прячет кнопки действий на время драга
    this.wake();
  }

  // Карта едет за пальцем (приподнята, ровно, крупнее), остальные раздвигаются, оставляя
  // ДЫРКУ на том слоте, куда она встанет — видно, между какими картами она ляжет.
  private applyCardDragTargets(): void {
    const d = this.cardDrag;
    if (!d) return;
    d.v.body.setTarget({ x: d.x, y: d.y, rot: 0, scale: DRAG_SCALE });
    const sp = anim.cardDrag.spread;
    let k = 0;
    for (const c of this.cards) {
      if (c === d.v) continue;
      const slot = k < d.insertAt ? k : k + 1; // пропускаем слот под перетаскиваемую карту
      // Плюс раскрытие вокруг точки вставки: соседи разъезжаются, и видно, между какими
      // именно картами ляжет перетаскиваемая (одной «дырки» в тесном веере не видно).
      const t = this.fanTarget(slot + fanSpreadShift(slot, d.insertAt, sp.cards, sp.amp, 1));
      c.body.setTarget({ x: t.x, y: t.y, rot: t.rot, scale: 1 });
      k++;
    }
  }

  private dropCard(x: number, y: number): void {
    const d = this.cardDrag;
    if (!d) return;
    this.cardDrag = null;
    this.skipNextTap = true;
    this.hoverZone = null;
    if (this.deckHit) this.deckHit.cursor = this.deckDraggable ? "grab" : "pointer";

    if (this.inFanArea(x, y)) {
      // Отпустили над веером — карта меняет место в колоде, порядок уходит на сервер.
      this.reorderLocally(d.v.card, this.insertIndexAt(x));
      this.onCardReorder?.(d.v.card, this.insertIndexAt(x));
      this.onDragChange?.(false);
    } else if (this.cardDropZonesAllowed) {
      // Зоны для отдельной карты откроются вместе с правилами игры (пока сюда не попадаем).
      this.returnCardHome(d.v);
      this.onDragChange?.(false);
    } else {
      // Во время раздачи карту нельзя положить ни на стол, ни в руку — «ударный» отскок.
      this.startCardReject(d.v, x, y);
    }
    this.drawZones();
    this.positionDeckHit();
    this.wake();
  }

  // Локальный (оптимистичный) реордер: сервер подтвердит эхом, и тот же порядок уже не
  // вызовет анимацию растасовки (setDeck увидит совпадение).
  private reorderLocally(card: string, to: number): void {
    const next = moveCard(this.deckCards, card, to);
    const byCard = new Map(this.cards.map((c) => [c.card, c]));
    const reordered = next.map((c) => byCard.get(c)).filter((c): c is CardVisual => !!c);
    if (reordered.length !== this.cards.length) return; // рассинхрон — не трогаем
    this.deckCards = next;
    this.cards = reordered;
    this.cards.forEach((c, i) => {
      c.sprite.zIndex = i;
      c.body.setTarget(this.restTarget(i));
    });
  }

  private returnCardHome(v: CardVisual): void {
    const i = Math.max(0, this.cards.indexOf(v));
    v.sprite.zIndex = i;
    this.cards.forEach((c, j) => c.body.setTarget(this.restTarget(j)));
  }

  // Отбой одной карты: та же «ударная» механика, что и у колоды, но трясётся только она.
  private startCardReject(v: CardVisual, px: number, py: number): void {
    const home = this.fanTarget(Math.max(0, this.cards.indexOf(v)));
    let dx = home.x! - px;
    let dy = home.y! - py;
    const len = Math.hypot(dx, dy) || 1;
    this.reject = { t: 0, dur: 0.5, dirX: dx / len, dirY: dy / len };
    this.rejectCard = v;
    v.body.setTarget({ x: px, y: py, scale: DRAG_SCALE, rot: 0 });
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
    const zs = deckZoneScale(this.deckZone);
    // Держим колоду у точки удара на время отскока (не улетает домой сразу).
    for (let i = 0; i < this.cards.length; i++) {
      const so = stackOffset(i, this.cards.length);
      this.cards[i].body.setTarget({ x: px + so.dx * zs, y: py + so.dy * zs, scale: DRAG_SCALE * zs, rot: this.restJitter[i] ?? 0 });
    }
  }

  private applyDragTargets(): void {
    if (!this.press) return;
    const { x, y } = this.press;
    const zs = deckZoneScale(this.deckZone);
    for (let i = 0; i < this.cards.length; i++) {
      const so = stackOffset(i, this.cards.length);
      this.cards[i].body.setTarget({
        x: x + so.dx * zs,
        y: y + so.dy * zs,
        scale: DRAG_SCALE * zs,
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
      // Зоны и подписи видны только пока тащим колоду или карту из веера.
      if ((!this.dragging && !this.cardDrag) || rect.w <= 0 || rect.h <= 0) {
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
    if (this.skipNextTap) {
      this.skipNextTap = false; // отпускание после драга карты — не тык и не дабл-клик
      return;
    }
    if (!this.deckDraggable) return; // двигать/раскрывать колоду может только дилер (в лобби)
    const now = performance.now();
    const isDouble = now - this.lastDeckTapMs < 350;
    this.lastDeckTapMs = isDouble ? 0 : now;

    if (this.deckZone === "safe" && this.deckFanned) {
      // Одиночный тык = «поковырять» (только тач; на десктопе раскрытие делает ховер).
      if (e.pointerType !== "mouse") this.pokeFan(e.global.x);
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
    // Раскрытый веер — хит-зона это прямоугольник сейф-зоны (дабл-клик по пустому месту
    // собирает веер / хватает колоду) ОБЪЕДИНЁННЫЙ с полосой самой дуги: веер проседает
    // ниже зоны (на широком экране — сильно), и без полосы тык/ховер по крайним картам
    // не срабатывал вовсе. См. fanBandContains.
    if (this.deckZone === "safe" && this.deckFanned) {
      const z = this.layout.safeZone;
      const l = this.layout;
      const pad = l.cardW * 0.25; // запас под палец
      this.deckHit.hitArea = {
        contains: (x: number, y: number) =>
          (Math.abs(x - z.cx) <= z.w / 2 && Math.abs(y - z.cy) <= z.h / 2) ||
          fanBandContains(x, y, l.safeAnchor, z.w, anim.fan.maxAngleDeg, anim.fan.widthFactor, l.cardW, l.cardH, pad),
      };
      return;
    }
    // Стопка: хит-зона накрывает весь блок — колода толщиной в 52 карты заметно шире
    // одной карты, и её край тоже должен ловиться.
    const a = this.activeAnchor();
    const zs = deckZoneScale(this.deckZone);
    const ext = stackExtent(this.cards.length);
    const w = (this.layout.cardW * 1.3 + ext.w) * zs;
    const h = (this.layout.cardH * 1.3 + ext.h) * zs;
    this.deckHit.hitArea = new Rectangle(a.x - w / 2, a.y - h / 2, w, h);
  }

  // Собрать анимацию настоящей растасовки, ПО ДЕЛЬТЕ каждой карты (|new-old|): дальние
  // едут дольше и выше, ближние — с бо́льшим боковым выносом (иначе их перелёт не читается
  // и выглядит как подмена карты на месте). Числа — в shuffleFlight.ts (чистая математика).
  // this.cards уже в новом порядке; oldOrder — прежний (для дельты).
  private startShuffleAnim(oldOrder: string[]): void {
    const n = this.cards.length;
    if (n === 0) return;
    const oldIndex = new Map<string, number>();
    oldOrder.forEach((c, i) => oldIndex.set(c, i));
    const speed = Math.max(1, this.profile.speed);
    const flying = new Set(this.splashAnim?.entries.map((e) => e.v) ?? []);
    const entries = this.cards.map((v, j) => {
      const oi = oldIndex.get(v.card) ?? j;
      const nd = n > 1 ? Math.abs(j - oi) / (n - 1) : 0; // 0..1 нормированная дельта
      const to = this.restTarget(j);
      const toPose: ShufflePose = { x: to.x ?? 0, y: to.y ?? 0, rot: to.rot ?? 0 };
      const from: ShufflePose = { x: v.body.px, y: v.body.py, rot: v.body.rotation };
      // Каскад идёт по СТАРОМУ месту карты — волна проходит по колоде, а не вразнобой.
      const fl = shuffleFlight(nd, oi, n, this.layout.cardH, this.layout.cardW);
      const dir = bulgeDir(toPose.x - from.x, this.layout.cardW, j);
      return {
        v,
        from,
        to: toPose,
        delay: fl.delay / speed,
        dur: fl.dur / speed,
        lift: fl.lift,
        bulge: fl.bulge * dir,
        lean: fl.lean * dir,
        newZ: j,
        zSwapped: false,
      };
    });
    // Карту, которая сейчас в выплеске, растасовка не трогает: она вернётся сама и уже
    // в новый слот (stepSplash каждый кадр берёт актуальный restTarget).
    const kept = entries.filter((e) => !flying.has(e.v));
    const totalDur = kept.reduce((m, e) => Math.max(m, e.delay + e.dur), 0);
    this.shuffleAnim = { t: 0, totalDur, entries: kept };
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
  // Нужны ли ОТДЕЛЬНЫЕ карты. В покое колода — это «кирпич» (одна Graphics с торцами) плюс
  // ОДНА настоящая верхняя карта: рисовать 52 спрайта, из которых видны полоски в полпикселя,
  // незачем. Отдельные карты включаются там, где они реально двигаются по одной: веер,
  // растасовка/сумбур, драг карты. Верхняя карта настоящая всегда — из неё потом вырастет
  // «снять карту с колоды» (её можно будет тащить отдельно от блока).
  private detailedCards(): boolean {
    return this.deckFanned || !!this.shuffleAnim || !!this.scrambleAnim || !!this.cardDrag || !!this.splashAnim;
  }

  private updateVisibility(): void {
    const away = this.deckZone === "away";
    const detailed = this.detailedCards();
    const top = this.cards.length - 1;
    for (let i = 0; i < this.cards.length; i++) {
      this.cards[i].sprite.visible = !away && (detailed || i === top);
    }
    if (this.deckBody) this.deckBody.visible = !away && !detailed && this.cards.length > 1;
    if (this.deckShadow) {
      this.deckShadow.visible = !away && this.profile.shadows && this.cards.length > 0;
    }
  }

  // Геометрия «кирпича»: торцы карт, лежащих ПОД верхней. Перерисовывается только когда
  // меняется число карт или раскладка — каждый кадр блок просто едет за верхней картой.
  private drawDeckBody(): void {
    const g = this.deckBody;
    if (!g) return;
    g.clear();
    const n = this.cards.length;
    if (n < 2) return;
    const w = this.layout.cardW;
    const h = this.layout.cardH;
    const r = Math.max(3, w * 0.1);
    const top = stackOffset(n - 1, n); // блок ставим в систему координат верхней карты
    const bg = cardBackSkin(this.cardBack).bg;
    // Сплошное «тело» блока — от самой задней карты, чтобы между полосками не просвечивал стол.
    const back = stackOffset(0, n);
    g.roundRect(back.dx - top.dx - w / 2, back.dy - top.dy - h / 2, w, h, r)
      .fill({ color: bg })
      .stroke({ width: 1.5, color: CARD_EDGE.side });

    // Полоски торцов: не все 52 карты (их шаг — доли пикселя и они слились бы в пятно),
    // а через равные промежутки. Видны с тех сторон, куда уходит задняя карта — слева и
    // снизу, — поэтому у каждой полоски рисуем только левый и нижний срезы.
    for (const i of stackStripeIndices(n, anim.deck.stripeSpacing)) {
      const so = stackOffset(i, n);
      const x = so.dx - top.dx - w / 2;
      const y = so.dy - top.dy - h / 2;
      g.roundRect(x, y, w, h, r).fill({ color: bg });
      g.moveTo(x + 0.75, y + r)
        .lineTo(x + 0.75, y + h - r)
        .stroke({ width: 1.5, color: CARD_EDGE.side }); // левый торец — темнее
      g.moveTo(x + r, y + h - 0.75)
        .lineTo(x + w - r, y + h - 0.75)
        .stroke({ width: 1.5, color: CARD_EDGE.bottom }); // нижний торец — светлее
    }
    this.deckBodyCount = n;
  }

  // Блок едет за верхней картой (позиция/угол/масштаб) — как будто это одна вещь.
  private syncDeckBody(): void {
    const g = this.deckBody;
    if (!g || !g.visible) return;
    const top = this.cards[this.cards.length - 1];
    if (!top) return;
    if (this.deckBodyCount !== this.cards.length) this.drawDeckBody();
    g.x = top.sprite.x;
    g.y = top.sprite.y;
    g.rotation = top.sprite.rotation;
    g.scale.set(top.body.scaleVal);
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
    this.drawDeckBody(); // размер карты изменился — блок перерисовываем целиком
    this.syncDeckBody();
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
    this.splashAnim = null;
    this.press = null;
    this.cardPress = null;
    this.cardDrag = null;
    this.rejectCard = null;
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
    this.cardShadow = null;
    this.deckBody = null;
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
      if (this.splashAnim) this.stepSplash(dt);

      if (this.shuffleAnim) {
        const sa = this.shuffleAnim;
        sa.t += dt;
        for (const e of sa.entries) {
          const local = sa.t - e.delay;
          if (local < 0) {
            e.v.body.setTarget(e.from); // ждёт своей очереди в каскаде — стоит на месте
            continue;
          }
          const p = Math.min(1, e.dur > 0 ? local / e.dur : 1);
          const u = easeOutQuad(p);
          const arc = Math.sin(Math.PI * p); // 0 → 1 (апекс) → 0
          e.v.body.setTarget({
            x: lerp(e.from.x, e.to.x, u) + e.bulge * arc,
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

    // Сглаживаем огибающую ховера всегда (чтобы плавно гасла после увода курсора).
    this.hoverEnv += (this.hoverTarget - this.hoverEnv) * Math.min(1, frameDt * 12);
    if (this.hoverTarget === 0 && this.hoverEnv < 0.002) this.hoverEnv = 0;

    // «Червячок» тесного веера + локальное раскрытие (тык/ховер).
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
        // Раскрытие переезжает к новой точке плавно (см. pokeFan) — без рывка карт.
        // Пока палец ведут по вееру, догоняем быстрее, чтобы зазор не отставал.
        const follow = this.cardPress ? w.poke.followDrag : w.poke.follow;
        this.poke.index += (this.poke.target - this.poke.index) * Math.min(1, frameDt * follow);
        if (pokeEnvelope(this.poke.t, w.poke.in, w.poke.hold, w.poke.out) <= 0 && this.poke.t > w.poke.in) {
          this.poke = null; // поке доиграл
        }
      }
      this.applyFanWave();
    } else if (this.fanWiggling) {
      // эффект закончился (собрали веер / стало просторно / всё доиграло) — ровный веер
      this.cards.forEach((c, i) => c.body.setTarget(this.restTarget(i)));
      this.fanCrowdNow = 0;
      this.poke = null;
      this.hoverTarget = 0;
      this.hoverEnv = 0;
    }
    this.fanWiggling = wiggle;

    if (this.cardDrag) this.applyCardDragTargets();

    if (this.reject) {
      this.reject.t += frameDt;
      if (this.reject.t >= this.reject.dur) {
        this.reject = null;
        // Отскок доигран — укладываем колоду у якоря и только ТЕПЕРЬ возвращаем кнопки.
        if (this.rejectCard) this.returnCardHome(this.rejectCard);
        this.rejectCard = null;
        this.cards.forEach((c, i) => c.body.setTarget(this.restTarget(i)));
        this.onDragChange?.(false);
      }
    }
    this.shake = this.rejectShake();
    this.updateVisibility(); // режим «кирпич/отдельные карты» может смениться прямо в тике
    for (const c of this.cards) if (c.sprite.visible) this.syncVisual(c);
    this.syncDeckBody();
    this.syncDeckShadow();
    this.syncCardShadow();
    this.syncRejectText();

    // Всё осело, нет растасовки/драга/отбоя И нет живой idle → усыпляем цикл. При
    // включённой idle-анимации цикл не спит (карты постоянно чуть «дышат»).
    if (
      !this.shuffleAnim &&
      !this.scrambleAnim &&
      !this.splashAnim &&
      !this.press &&
      !this.cardPress &&
      !this.cardDrag &&
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

    // Тряска отбоя: общая для колоды, но если отбивается ОДНА карта — трясётся только она.
    const sh = !this.rejectCard || this.rejectCard === c ? this.shake : ZERO_SHAKE;
    c.sprite.x = c.body.px + sh.dx;
    c.sprite.y = c.body.py + sh.dy;
    c.sprite.rotation = rot + sh.rot;
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
    // Приподнятость — ОТНОСИТЕЛЬНО масштаба зоны: в центре колода крупнее сама по себе,
    // и без деления её тень всегда выглядела бы как у поднятой колоды.
    const elev = Math.max(0, base.body.scaleVal / deckZoneScale(this.deckZone) - 1);
    const off = lightShadowOffset(this.layout.cardH, elev);
    s.x = base.body.px + this.shake.dx + off.dx;
    s.y = base.body.py + this.shake.dy + off.dy;
    s.rotation = base.body.rotation + this.shake.rot;
    s.scale.set(this.baseScale * base.body.scaleVal * 1.05);
    s.alpha = 0.5 + elev * 0.4;
  }

  // Тень под одиночной картой: живёт только пока карту тащат или пока она отбивается.
  private syncCardShadow(): void {
    const s = this.cardShadow;
    if (!s) return;
    const v = this.cardDrag?.v ?? this.rejectCard;
    if (!v || !this.profile.shadows || this.deckZone === "away") {
      s.visible = false;
      return;
    }
    s.visible = true;
    const elev = Math.max(0, v.body.scaleVal / deckZoneScale(this.deckZone) - 1);
    const off = lightShadowOffset(this.layout.cardH, elev);
    s.x = v.sprite.x + off.dx;
    s.y = v.sprite.y + off.dy;
    s.rotation = v.sprite.rotation;
    s.scale.set(this.baseScale * v.body.scaleVal * 1.05);
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

  // «Бумажная» кромка карты: низ — серый, бока — темнее серым. В стопке карты сдвинуты
  // вниз-влево, поэтому видно именно нижний и левый срезы соседней карты — они и создают
  // ощущение толщины бумаги при свете сверху справа.
  private drawCardEdges(g: Graphics): void {
    const e = CARD_EDGE;
    const r = 16;
    // бока (весь контур) — тёмно-серый
    g.roundRect(2, 2, TEX_W - 4, TEX_H - 4, r).stroke({ width: e.width, color: e.side });
    // низ — светлее: прямая по нижнему срезу, между скруглениями углов
    g.moveTo(2 + r, TEX_H - 2 - e.width / 2)
      .lineTo(TEX_W - 2 - r, TEX_H - 2 - e.width / 2)
      .stroke({ width: e.width, color: e.bottom });
  }

  // Лицевая текстура: кремовый фон, ранг+масть по углам и крупный символ по центру
  // (для J/Q/K — буква-заглушка, картинки добавим позже), цвет по масти (четырёхцв./классика).
  private makeCardFaceTexture(card: string): Texture {
    if (!this.app) return this.backTex!;
    const { rank, suit } = parseCard(card);
    const color = suitColor(suit, this.fourColor);
    const root = new Container();

    const bg = new Graphics();
    bg.roundRect(2, 2, TEX_W - 4, TEX_H - 4, 16).fill({ color: 0xf4ecd8 });
    this.drawCardEdges(bg);
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
    const zs = deckZoneScale(this.deckZone);
    const so = stackOffset(i, this.cards.length);
    return { x: a.x + so.dx * zs, y: a.y + so.dy * zs, rot: this.restJitter[i] ?? 0, scale: zs };
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
      !this.splashAnim && // карты в выплеске летают сами
      !this.press &&
      !this.cardDrag && // карту тащат — веер стоит ровно с «дыркой» под неё
      (this.fanCrowd() > 0 || this.poke !== null || this.hoverTarget === 1 || this.hoverEnv > 0.001)
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
    const p = anim.fan.wiggle.poke;
    const pi = this.nearestFanIndex(x);
    // Повторный тык РЯДОМ с уже открытым местом не перезапускает раскрытие: оно просто
    // переезжает к новой точке и снова держится. Иначе карты рывком возвращались в
    // исходное положение и вся анимация играла заново — при том что тыкнули в двух
    // сантиметрах. Тык далеко — это новое место, там перезапуск уместен.
    if (this.poke && Math.abs(pi - this.poke.target) <= p.cards) {
      this.poke.target = pi;
      this.poke.t = Math.min(this.poke.t, p.in); // держим открытым, отсчёт hold — заново
      this.wake();
      return;
    }
    this.poke = { index: pi, target: pi, t: 0 };
    this.reKickWaveAt(pi);
  }

  // Свайп вверх: быстрое движение, у которого вертикальная составляющая направлена вверх
  // и весома. Наклон вбок допускаем (он потом задаёт сторону разлёта) — не пускаем только
  // движения вниз и «горизонтальные протяжки», которые на деле глиссандо.
  private isSwipeUp(vx: number, vy: number, travelUp: number): boolean {
    if (!this.fanOpen() || this.deckCount < 2) return false;
    if (vy >= 0) return false; // вниз — не тот жест
    if (-vy < Math.abs(vx) * anim.swipe.upBias) return false; // почти горизонтально — не свайп
    // Путь вверх обязателен: он отсекает медленное ведение и мелкое дрожание пальца,
    // на которых одна только скорость иногда даёт ложный свайп.
    if (travelUp < this.layout.cardH * anim.swipe.minTravel) return false;
    return swipeStrength(vx, vy) > 0;
  }

  // Выплеск: несколько карт вылетают из веера в стороны и возвращаются. Сам порядок тасует
  // сервер (onSwipeShuffle шлёт shuffle_deck) — анимация не ждёт ответа и не зависит от него.
  private startSwipeShuffle(vx: number, vy: number, startIndex: number): void {
    const strength = swipeStrength(vx, vy);
    const n = this.cards.length;
    const count = Math.min(n, swipeCardCount(strength));
    if (count <= 0) return;
    const dirs = swipeDirections(count, vx, vy);
    const s = anim.swipe;
    const dist = this.layout.cardH * (s.dist.base + s.dist.perStrength * strength);
    // Берём НЕПРЕРЫВНУЮ пачку карт вокруг той, с которой начался свайп: выплеск идёт
    // из-под пальца, а не выдёргивает карты по всему вееру.
    const picked = swipeCardIndices(startIndex, count, n);
    const entries = picked.map((idx, k) => ({
      v: this.cards[idx],
      dir: dirs[k] ?? dirs[dirs.length - 1],
      dist,
      spin: ((dirs[k] ?? dirs[0]).dx >= 0 ? 1 : -1) * s.spin,
      z: 50_000 + k,
    }));
    for (const e of entries) e.v.sprite.zIndex = e.z; // летят поверх веера
    this.splashAnim = { t: 0, dur: s.dur, entries };
    this.poke = null;
    this.hoverTarget = 0;
    // Наверх уходят ИМЕННО выброшенные карты: сервер врежет обратно только их, а порядок
    // остальных не тронет (полная перетасовка — это отдельная кнопка «Растасовать»).
    this.onSwipeShuffle?.(entries.map((e) => e.v.card));
    this.wake();
  }

  // Шаг выплеска: карта уходит по своему направлению и возвращается (синус — туда-обратно).
  // База — ТЕКУЩИЙ слот карты, поэтому пришедший в полёте новый порядок она отработает сама.
  private stepSplash(dt: number): void {
    const sa = this.splashAnim;
    if (!sa) return;
    sa.t += dt;
    const p = Math.min(1, sa.t / sa.dur);
    const arc = Math.sin(Math.PI * p);
    for (const e of sa.entries) {
      const i = this.cards.indexOf(e.v);
      if (i < 0) continue;
      const home = this.restTarget(i);
      e.v.body.setTarget({
        x: (home.x ?? 0) + e.dir.dx * e.dist * arc,
        y: (home.y ?? 0) + e.dir.dy * e.dist * arc,
        rot: (home.rot ?? 0) + e.spin * arc,
        scale: (home.scale ?? 1) * (1 + 0.12 * arc),
      });
    }
    if (p >= 1) {
      for (const e of sa.entries) {
        const i = this.cards.indexOf(e.v);
        e.v.sprite.zIndex = i < 0 ? 0 : i; // вернулись в общий порядок
        if (i >= 0) e.v.body.setTarget(this.restTarget(i));
      }
      this.splashAnim = null;
    }
  }

  // «Глиссандо»: палец ведут по зажатому вееру — раскрытие едет за ним и НЕ перезапускается
  // (в отличие от тыка), сколько бы карт палец ни прошёл. Тачевый аналог ховера мышью.
  private glissandoTo(x: number): void {
    if (this.deckZone !== "safe" || !this.deckFanned || this.deckCount < 2) return;
    const p = anim.fan.wiggle.poke;
    const pi = this.nearestFanIndex(x);
    if (!this.poke) {
      this.poke = { index: pi, target: pi, t: p.in };
      this.reKickWaveAt(pi);
    } else {
      this.poke.target = pi;
      this.poke.t = Math.min(this.poke.t, p.in); // держим открытым, пока ведут
    }
    this.wake();
  }

  // Ховер мышью (десктоп): раскрытие следует за курсором, пока он над веером.
  private onDeckHover(e: FederatedPointerEvent): void {
    if (e.pointerType !== "mouse" || this.press) return; // тач — не ховер; во время драга — нет
    if (this.deckZone !== "safe" || !this.deckFanned || this.deckCount < 2) {
      this.hoverTarget = 0;
      return;
    }
    if (this.hoverTarget === 0) this.reKickWaveAt(this.nearestFanIndex(e.global.x)); // заход — толчок
    this.hoverIndex = this.nearestFanIndex(e.global.x);
    this.hoverTarget = 1;
    this.wake();
  }

  private onDeckHoverOut(e: FederatedPointerEvent): void {
    if (e.pointerType && e.pointerType !== "mouse") return;
    this.hoverTarget = 0;
    this.wake();
  }

  // Ре-энергия + гребень волны у индекса (общее для тыка и захода ховера).
  private reKickWaveAt(index: number): void {
    const n = Math.max(2, this.deckCount);
    this.fanKickT = 0;
    this.fanWavePhase = anim.fan.wiggle.cycles * Math.PI * 2 * (index / (n - 1)) - Math.PI / 2;
    this.wake();
  }

  // Локальный сдвиг карты i из-за «раскрытия»: карты слева от точки едут влево, справа —
  // вправо, раздвигая ~cards карт (в окне линейно, дальше — постоянный сдвиг). Источник —
  // ховер мышью (десктоп, приоритет) либо тык (тач).
  private pokeShiftAt(i: number): number {
    const p = anim.fan.wiggle.poke;
    let env = 0;
    let index = 0;
    if (this.hoverEnv > 0.001) {
      env = this.hoverEnv;
      index = this.hoverIndex;
    } else if (this.poke) {
      env = pokeEnvelope(this.poke.t, p.in, p.hold, p.out);
      index = this.poke.index;
    }
    return fanSpreadShift(i, index, p.cards, p.amp, env);
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

  // Рубашка по выбранному скину (см. cardBack.ts — там палитра и геометрия узора).
  private makeCardBackTexture(app: Application): Texture {
    const skin = cardBackSkin(this.cardBack);
    const g = new Graphics();
    g.roundRect(2, 2, TEX_W - 4, TEX_H - 4, 16)
      .fill({ color: skin.bg })
      .stroke({ width: 5, color: skin.border });

    if (skin.pattern === "lattice") {
      // «Квадраторомб»: шахматка из ромбов и квадратов, как на классической рубашке.
      const r = 13;
      for (const p of latticeCenters(TEX_W, TEX_H, 4, 6, 22)) {
        const color = skin.ink[p.odd ? 1 : 0];
        if (p.odd) {
          g.rect(p.x - r * 0.72, p.y - r * 0.72, r * 1.44, r * 1.44).fill({ color });
        } else {
          g.poly([p.x, p.y - r, p.x + r, p.y, p.x, p.y + r, p.x - r, p.y]).fill({ color });
        }
      }
    } else {
      // Мозаика: плитки встык, три оттенка синего по детерминированному узору.
      for (const t of mosaicTiles(TEX_W, TEX_H, 5, 7, 20)) {
        g.rect(t.x + 1, t.y + 1, t.w - 2, t.h - 2).fill({ color: skin.ink[t.shade] });
      }
    }

    g.roundRect(16, 16, TEX_W - 32, TEX_H - 32, 10).stroke({ width: 3, color: skin.inner });
    this.drawCardEdges(g);
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
