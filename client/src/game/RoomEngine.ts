import {
  Application,
  Container,
  Graphics,
  Matrix,
  Rectangle,
  Sprite,
  Text,
  Texture,
  type FederatedPointerEvent,
  type Ticker,
} from "pixi.js";
import { CardBody, type CardTargets } from "./CardBody";
import { computeLayout, type RoomLayout, type LayoutInsets } from "./layout";
import type { DeckZone } from "./deckZone";
import { dropZoneRegions, pickDropTarget, pickSeat, type DropZone, type DropTarget } from "./dropZones";
import { layoutSeats, type SeatBox } from "./seatLayout";
import type { SeatView } from "./seats";
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
import { moveCard, scatterCards, shuffleOrder } from "./deckOrder";
import {
  spinAngle,
  spinScale,
  spinShowsOther,
  flipTilt,
  flipTransform,
  stretchOffset,
} from "./flip";
import { cardsUnderTouch } from "./touch";
import type { DeckFxMessage } from "./deckFxClient";
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

const REJECT_TEXT = "низяяя"; // надпись «сюда нельзя» при запрещённом дропе колоды

// Кромка карты (толщина бумаги): низ светло-серый, бока темнее — свет сверху справа.
const CARD_EDGE = { bottom: 0xa8a8a8, side: 0x6e6e6e, width: 4 };

const DRAG_SCALE = 1.18; // карты «приподнимаются» при захвате (визуальный акцент)
const DRAG_THRESHOLD = 6; // px: меньше — это тап (дабл-клик), больше — реальный драг

// Подписи зон — водяным текстом по центру каждой зоны, видны при отображении дроп-зон.
const ZONE_LABELS: Record<DropZone, string> = {
  center: "ЦЕНТР",
  hand: "РУКА",
  safe: "СЕЙФ",
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
  private warmTimer: ReturnType<typeof setTimeout> | null = null; // фоновой прогрев текстур

  // Чужие игроки за столом: данные (кто) + геометрия мест (где), см. seatLayout.ts.
  // Место игрока — прямоугольник и он же его дроп-зона.
  private seats: SeatView[] = [];
  private seatBoxes: SeatBox[] = [];
  private seatInsets: LayoutInsets = { top: 0, left: 0, right: 0 };
  private topInset = 0; // высота HTML-топбара над канвасом — места начинаются под ним
  private bottomInset = 0; // высота панели действий — зоны заканчиваются над ней
  private seatLayer: Container | null = null;
  private seatG: Graphics | null = null; // рамки/заливки мест
  private seatTexts: Text[] = []; // имя + счётчик карт на каждое место
  private hoverSeat: string | null = null; // место под курсором во время драга колоды
  private deckHolder: string | null = null; // чьё место держит колоду (deckZone === "seat")
  private onDeckDropToSeat: ((playerId: string) => void) | null = null;

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
  private deckSlot = 0; // слот сейфа, если колода лежит в сейфе (0..2)
  // Сторона КАЖДОЙ карты (карта → лицом ли вверх) — приходит из состояния сервера.
  // Единого «колода лицом вверх» больше нет: карты переворачиваются по одной.
  private facing: Record<string, boolean> = {};
  private authoritative = false; // этот клиент сам решает, как лежит колода (дилер в лобби)
  // Какие карты в этот момент показывают ОБРАТНУЮ сторону, потому что переворот уже
  // перевалил через ребро, а состояние ещё не пришло/анимация ещё идёт.

  // Переворот: карты + задержка старта (стопка переворачивается волной).
  private flipAnim: {
    t: number;
    dur: number;
    angle: number;
    entries: { v: CardVisual; delay: number; swapped: boolean; from: boolean }[];
    halfTurns: number; // 3 для колоды (540°), 1 для карты (180°)
    reverseAtEdge: boolean; // на последнем «ребре» применить реверс порядка локально
    reversed: boolean;
  } | null = null;
  // Текст-объяснение поверх стола (отказ сервера). Живёт отдельно от «ударного» отскока.
  private notice: { t: number; dur: number } | null = null;
  // Резиновая тянучка запрещённого жеста (свайп вверх по стопке).
  private stretchAnim: { t: number; dur: number; angle: number } | null = null;
  // Карты в текущем перевороте: по объекту (для рендера) и по идентификатору (для текстур).
  private flipMap = new Map<CardVisual, { delay: number }>();
  private flipByCard = new Map<string, { swapped: boolean; from: boolean }>();
  private stretch = { dx: 0, dy: 0 }; // текущее смещение резиновой тянучки
  private onFlipDeck: (() => void) | null = null;
  private onFlipCards: ((cards: string[]) => void) | null = null;
  private onDeckFx: ((fx: DeckFxMessage) => void) | null = null;
  private onFanChange: ((fanned: boolean) => void) | null = null;
  private deckHit: Container | null = null;

  // Драг колоды дилером: press — палец/мышь прижаты у колоды (ещё не факт что драг),
  // dragging — порог смещения пройден, колода реально едет за курсором.
  private deckDraggable = false;
  private press: { id: number; startX: number; startY: number; x: number; y: number; samples: SwipeSample[] } | null = null;
  private dragging = false;
  private hoverZone: DropTarget | null = null;
  private onDeckDrop: ((zone: DropZone, slot: number) => void) | null = null;
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
  private splashAnim: {
    t: number;
    dur: number;
    entries: { v: CardVisual; from: ShufflePose; dir: Dir; dist: number; spin: number }[];
    flipMid?: CardVisual[]; // карты, которые в середине полёта показывают другую сторону
    flipped?: boolean;
  } | null = null;
  // Любая тасовка (кнопка, свайп, будущие жесты) сообщает наверх НОВЫЙ порядок — сеть
  // разбирается сама (открыть сессию, редкий прогресс, финал). Движок о сети не знает.
  private onShuffleChange: ((order: string[]) => void) | null = null;
  // Отложенное применение порядка: «сумбур» как лид-ин, затем настоящая раскладка.
  private pendingShuffle: { order: string[]; t: number; delay: number } | null = null;

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
    // Отступы (посадка сверху, панель действий снизу) приезжают сразу после mount —
    // см. заливку пропсов в RoomCanvas; здесь берём то, что уже известно.
    this.layout = computeLayout(this.w, this.h, { ...this.seatInsets, bottom: this.bottomInset });

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

    // Слои по zIndex: стол → места игроков → подсветка зон → тени → карты → хит колоды.
    this.tableG = new Graphics();
    this.tableG.zIndex = 0;
    this.seatLayer = new Container();
    this.seatLayer.zIndex = 0.5; // под зонами и картами: места — часть «стола»
    this.seatG = new Graphics();
    this.seatLayer.addChild(this.seatG);
    this.zoneLayer = new Graphics();
    this.zoneLayer.zIndex = 1;
    this.shadowLayer = new Container();
    this.shadowLayer.zIndex = 2;
    this.cardLayer = new Container();
    this.cardLayer.zIndex = 3;
    this.cardLayer.sortableChildren = true; // чересполосица половин в риффле
    this.world.addChild(this.tableG, this.seatLayer, this.zoneLayer, this.shadowLayer, this.cardLayer);

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
      text: REJECT_TEXT,
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
    body.zIndex = 0.5; // над нижней картой (zIndex 0), под всеми остальными
    this.cardLayer.addChild(body);
    this.deckBody = body;

    // Карты приедут через setDeck() (порядок из состояния сервера) — на mount их нет.

    // Невидимая интерактивная зона поверх колоды — старт драга + дабл-тап.
    const hit = new Container();
    hit.eventMode = "static";
    hit.cursor = "grab";
    hit.zIndex = 10_000; // всегда над картами
    hit.on("pointerdown", (e: FederatedPointerEvent) => this.onDeckDown(e));
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

    if (this.seats.length > 0) this.applySeats(); // места могли приехать до монтирования

    // Состояние комнаты могло приехать РАНЬШЕ, чем поднялся Pixi (вход в живую комнату,
    // перезагрузка страницы): setDeck тогда только запомнил порядок и вышел на «ещё не
    // смонтированы», а повторно его никто не звал — deckKey в RoomCanvas не менялся.
    // Итог: карт не видно, пока не нажмёшь «Растасовать». Доигрываем отложенный порядок.
    if (this.deckCards.length > 0) this.setDeck(this.deckCards);

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
    if (sameSet && changed && this.flipAnim) {
      // Идёт переворот колоды: сервер прислал реверснутый порядок. Это НЕ растасовка —
      // раскладываем карты по местам без полёта, весь показ делает сам переворот.
      // И помечаем реверс как уже применённый, иначе на «ребре» мы перевернём порядок
      // второй раз и получим исходную колоду.
      if (this.flipAnim.reverseAtEdge) this.flipAnim.reversed = true;
      this.cards.forEach((c, i) => {
        c.sprite.zIndex = i;
        c.body.setTarget(this.restTarget(i));
      });
    } else if (sameSet && changed && shouldPlay(anim.priority.shuffle, this.profile)) {
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
    this.warmFaceTextures(); // чтобы первый переворот не генерил все лица разом
    this.wake();
  }

  // Чужие игроки за столом. Их посадка («П», см. seatLayout) отжимает центр стола, поэтому
  // раскладка пересчитывается целиком, а колода переезжает к новому якорю.
  setSeats(seats: SeatView[]): void {
    this.seats = seats;
    this.applySeats();
  }

  // Чьё место держит колоду (deckZone === "seat"). null — колода не у чужого места.
  setDeckHolder(playerId: string | null): void {
    if (playerId === this.deckHolder) return;
    this.deckHolder = playerId;
    if (this.deckZone === "seat") {
      this.cards.forEach((c, i) => c.body.setTarget(this.restTarget(i)));
      this.positionDeckHit();
      this.wake();
    }
  }

  setOnDeckDropToSeat(fn: ((playerId: string) => void) | null): void {
    this.onDeckDropToSeat = fn;
  }

  // Высота топбара комнаты: он HTML и лежит поверх канваса, движок про него не знает.
  setTopInset(px: number): void {
    const next = Math.max(0, Math.round(px));
    if (next === this.topInset) return;
    this.topInset = next;
    this.applySeats();
  }

  // Высота панели действий внизу: канвас лежит во весь экран, панель рисуется поверх.
  setBottomInset(px: number): void {
    const next = Math.max(0, Math.round(px));
    if (next === this.bottomInset) return;
    this.bottomInset = next;
    this.applySeats(); // пересчитает раскладку и разложит карты по новым зонам
  }

  private applySeats(): void {
    const placed = layoutSeats(
      this.seats.map((s) => s.id),
      this.w,
      this.h,
      { topOffset: this.topInset },
    );
    this.seatBoxes = placed.seats;
    this.seatInsets = placed.insets;
    this.layout = computeLayout(this.w, this.h, { ...this.seatInsets, bottom: this.bottomInset });
    if (!this.app) return; // ещё не смонтированы — нарисуем на mount
    this.drawSeats();
    // Центр уехал/сузился: колода переезжает к новому якорю, за ней — её хит-зона.
    this.cards.forEach((c, i) => c.body.setTarget(this.restTarget(i)));
    this.positionDeckHit();
    this.drawZones();
    this.wake();
  }

  // Подсветка места под курсором. Перерисовываем, только когда оно реально сменилось —
  // drawSeats пересоздаёт тексты, дёргать его каждый кадр драга нельзя.
  private setHoverSeat(id: string | null): void {
    if (id === this.hoverSeat) return;
    this.hoverSeat = id;
    this.drawSeats();
  }

  private seatBox(id: string | null): SeatBox | null {
    if (!id) return null;
    return this.seatBoxes.find((b) => b.id === id) ?? null;
  }

  // Место игрока: прямоугольник с именем, числом карт и метками (дилер/готов/бот/пауза).
  // Во время драга колоды место подсвечивается как дроп-зона — бросок отдаёт колоду ему.
  private drawSeats(): void {
    const g = this.seatG;
    const layer = this.seatLayer;
    if (!g || !layer) return;
    g.clear();
    this.seatTexts.forEach((t) => t.destroy());
    this.seatTexts = [];

    const dragging = this.dragging || !!this.cardDrag;
    const fontSize = Math.min(20, Math.max(11, this.layout.cardH * 0.22));

    for (const box of this.seatBoxes) {
      const seat = this.seats.find((s) => s.id === box.id);
      if (!seat) continue;
      const { cx, cy, w, h, r } = box.rect;
      const x = cx - w / 2;
      const y = cy - h / 2;
      const hot = dragging && this.hoverSeat === seat.id;
      // Отключённый игрок («на паузе») — приглушён; дилер — золотая рамка.
      const border = hot ? 0xffe9a8 : seat.isDealer ? 0xf2c14e : seat.connected ? 0x8fa39a : 0x5d6b64;
      const alpha = seat.connected ? 1 : 0.45;

      g.roundRect(x, y, w, h, r).fill({ color: hot ? 0xffe08a : 0x000000, alpha: hot ? 0.14 : 0.18 });
      g.roundRect(x, y, w, h, r).stroke({ width: hot ? 4 : 2, color: border, alpha: hot ? 0.95 : 0.5 * alpha });

      // Режим руки соседа виден всем: 🔓 — его рука открыта, 🔒 — закрыта.
      const marks = [seat.isBot ? "🤖" : "", seat.isDealer ? "♦" : "", seat.isReady ? "✓" : "", seat.handOpen ? "🔓" : "🔒"]
        .filter(Boolean)
        .join(" ");
      const label = new Text({
        text: marks ? `${seat.name} ${marks}` : seat.name,
        style: {
          fontFamily: "VT323, monospace",
          fontSize,
          fill: seat.connected ? 0xf5ead0 : 0x9aa8a2,
          letterSpacing: 1,
          align: "center",
          wordWrap: true,
          wordWrapWidth: Math.max(20, w - 10),
        },
      });
      // Имя — к верхнему краю, счётчик — к нижнему: середину места занимает колода,
      // когда её отдали этому игроку, и она не должна закрывать подписи.
      label.anchor.set(0.5, 0);
      label.x = cx;
      label.y = y + 4;
      layer.addChild(label);
      this.seatTexts.push(label);

      const count = new Text({
        text: seat.handCount > 0 ? `🂠 ${seat.handCount}` : "—",
        style: { fontFamily: "VT323, monospace", fontSize, fill: 0xcdb98f, letterSpacing: 1 },
      });
      count.anchor.set(0.5, 1);
      count.x = cx;
      count.y = y + h - 4;
      layer.addChild(count);
      this.seatTexts.push(count);
    }
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

  // Стороны карт из состояния сервера — ЕДИНСТВЕННЫЙ источник правды. Анимации переворота
  // только показывают процесс; если данные разойдутся с анимацией, побеждают данные.
  // Стороны карт от сервера. Для ДИЛЕРА это эхо собственных действий — он источник
  // правды и уже всё показал, поэтому ничего не переигрывает. Для остальных это событие:
  // изменившиеся карты переворачиваются анимацией, а не подменяются рывком.
  setCardFacing(next: Record<string, boolean>): void {
    const changed = this.cards.filter((c) => !!this.facing[c.card] !== !!next[c.card]);
    this.facing = next;
    if (changed.length > 0 && !this.authoritative) {
      this.startFlip(changed, Math.PI / 2, anim.flip.cardDur, false, changed.length === this.cards.length);
    } else {
      this.applyCardTextures();
    }
    this.wake();
  }

  // Может ли этот клиент менять колоду сам (дилер в лобби). Он же — источник правды:
  // применяет изменения мгновенно, не дожидаясь сервера, и не переигрывает своё же эхо.
  setAuthoritative(v: boolean): void {
    this.authoritative = v;
  }

  // Зона колоды с точки зрения локального игрока (см. deckZone.ts). "center"/"safe"
  // — рисуем у соответствующего якоря; "away" (чужая сейф-зона) — колода прячется.
  setDeckZone(zone: DeckZone, slot = 0): void {
    if (zone === this.deckZone && slot === this.deckSlot) return;
    this.deckZone = zone;
    this.deckSlot = slot;
    const away = zone === "away";
    this.updateVisibility();
    if (this.deckHit) this.deckHit.eventMode = away ? "none" : "static";
    // Не «away» — карты плавно летят к новому якорю (setTarget, а не snap).
    if (!away) this.cards.forEach((c, i) => c.body.setTarget(this.restTarget(i)));
    this.positionDeckHit();
    this.applyCardTextures(); // в сейфе карты всегда рубашкой вверх — текстуры меняются
    this.onFanChange?.(this.fanned());
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

  setOnFlipDeck(fn: (() => void) | null): void {
    this.onFlipDeck = fn;
  }

  setOnFlipCards(fn: ((cards: string[]) => void) | null): void {
    this.onFlipCards = fn;
  }

  // Эффект для остальных игроков: сервер раздаст его как есть, вместе с длительностью,
  // чтобы у них анимация шла столько же, сколько шла здесь.
  setOnDeckFx(fn: ((fx: DeckFxMessage) => void) | null): void {
    this.onDeckFx = fn;
  }

  setOnFanChange(fn: ((fanned: boolean) => void) | null): void {
    this.onFanChange = fn;
    fn?.(this.fanned());
  }

  // Проиграть чужой эффект (пришёл с сервера). Состояние он не трогает — только показывает.
  playFx(fx: DeckFxMessage): void {
    if (this.destroyed) return;
    const dur = Math.max(0.05, fx.dur / 1000);
    if (fx.kind === "flip-deck") this.startFlip(this.cards, fx.angle, dur, false);
    else if (fx.kind === "flip-cards") {
      const vs = this.cards.filter((c) => fx.cards.includes(c.card));
      this.startFlip(vs, fx.angle, dur, false);
    } else if (fx.kind === "stretch") this.startStretch(fx.angle, dur);
    else if (fx.kind === "spill") this.startSpill(fx.count, dur, false);
  }

  // Колбэк на ЛЮБУЮ тасовку: наверх уходит готовый порядок колоды.
  setOnShuffleChange(fn: ((order: string[]) => void) | null): void {
    this.onShuffleChange = fn;
  }

  // Кнопка «Перевернуть колоду» (доступна, только пока веер собран). Переворот идёт
  // сверху вниз — как если бы стопку перевернули к себе.
  flipDeckByButton(): void {
    if (this.destroyed || this.cards.length === 0 || this.flipAnim) return;
    this.flipWholeDeck(Math.PI / 2);
  }

  // Кнопка «Растасовать». Порядок считаем здесь же (как и у свайпа): сначала короткий
  // «сумбур» как лид-ин, затем настоящая раскладка по посчитанному порядку. Сеть узнаёт
  // порядок сразу — анимация её не ждёт.
  shuffleAll(): void {
    if (this.cards.length < 2 || this.destroyed) return;
    const next = shuffleOrder(this.deckCards, Math.random);
    if (shouldPlay(anim.priority.shuffle, this.profile)) {
      this.startScramble();
      this.pendingShuffle = { order: next, t: 0, delay: anim.shuffle.leadIn };
    } else {
      this.applyOrderLocally(next);
    }
    this.onShuffleChange?.(next);
    this.wake();
  }

  // Можно ли уронить ОДНУ карту в зоны (центр/рука). Во время раздачи — нельзя (отскок).
  setCardDropZonesAllowed(v: boolean): void {
    this.cardDropZonesAllowed = v;
  }

  // Колбэк на дабл-клик по колоде (решение «куда двигать» принимает React-слой).


  // Колбэк на дроп колоды в разрешённую зону (React шлёт move_deck на сервер).
  setOnDeckDrop(fn: ((zone: DropZone, slot: number) => void) | null): void {
    this.onDeckDrop = fn;
  }

  // Колбэк на старт/конец драга колоды (React прячет кнопки действий на время драга).
  setOnDragChange(fn: ((active: boolean) => void) | null): void {
    this.onDragChange = fn;
  }

  // Якорь, у которого сейчас покоится колода: центр или своя сейф-зона.
  private activeAnchor(): { x: number; y: number } {
    if (this.deckZone === "hand") return this.layout.handAnchor;
    if (this.deckZone === "safe") {
      return this.layout.safeAnchors[this.deckSlot] ?? this.layout.safeAnchors[0];
    }
    // Колода лежит на месте другого игрока — её якорь и есть центр его прямоугольника.
    if (this.deckZone === "seat") {
      const box = this.seatBox(this.deckHolder);
      if (box) return { x: box.rect.cx, y: box.rect.cy };
    }
    return this.layout.deckAnchor;
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
    this.press = {
      id: e.pointerId,
      startX: e.global.x,
      startY: e.global.y,
      x: e.global.x,
      y: e.global.y,
      samples: [{ x: e.global.x, y: e.global.y, t: performance.now() }],
    };
    if (this.deckHit) this.deckHit.cursor = "grabbing";
  }

  private onPointerMove(e: FederatedPointerEvent): void {
    if (this.cardDrag && e.pointerId === this.cardDrag.id) {
      this.cardDrag.x = e.global.x;
      this.cardDrag.y = e.global.y;
      this.cardDrag.insertAt = this.insertIndexAt(e.global.x);
      this.hoverZone = pickDropTarget(e.global.x, e.global.y, this.layout);
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
    this.press.samples.push({ x: e.global.x, y: e.global.y, t: performance.now() });
    if (this.press.samples.length > 12) this.press.samples.shift();
    if (!this.dragging) {
      const dx = this.press.x - this.press.startX;
      const dy = this.press.y - this.press.startY;
      if (dx * dx + dy * dy < DRAG_THRESHOLD * DRAG_THRESHOLD) return; // ещё тап, не драг
      this.dragging = true;
      this.onDragChange?.(true); // React прячет кнопки действий на время драга
    }
    this.hoverZone = pickDropTarget(this.press.x, this.press.y, this.layout);
    // Место игрока под курсором подсвечивается так же, как обычная дроп-зона.
    this.setHoverSeat(pickSeat(this.press.x, this.press.y, this.seatBoxes));
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
    // Свайпов-переворотов по стопке больше нет: колода двигается только перетаскиванием.
    this.press = null;
    this.dragging = false;
    this.hoverZone = null;
    this.setHoverSeat(null);
    if (this.deckHit) this.deckHit.cursor = this.deckDraggable ? "grab" : "pointer";
    this.drawZones();

    // Не было смещения — это тап, дабл-клик обработает pointertap. Ничего не двигаем.
    if (!wasDragging) {
      this.wake();
      return;
    }

    // Место игрока — тоже дроп-зона, и оно вне центра/сейфа, поэтому проверяется первым:
    // бросок туда отдаёт колоду этому игроку (сервер подтвердит эхом deckLocation).
    const seatDrop = pickSeat(px, py, this.seatBoxes);
    if (seatDrop) {
      this.hoverSeat = null;
      this.deckZone = "seat";
      this.deckHolder = seatDrop; // оптимистично: колода уже на его месте
      this.onFanChange?.(false); // веер бывает только в моей руке
      this.onDeckDropToSeat?.(seatDrop);
      this.alignCards(this.cards.map((_, i) => i));
      this.cards.forEach((c, i) => c.body.setTarget(this.restTarget(i)));
      this.onDragChange?.(false);
      this.drawSeats();
      this.positionDeckHit();
      this.wake();
      return;
    }

    const drop = pickDropTarget(px, py, this.layout);
    {
      // Запретных зон больше нет: центр, рука и слоты сейфа — всё законные цели.
      if (drop && (drop.zone !== this.deckZone || (drop.zone === "safe" && drop.slot !== this.deckSlot))) {
        this.deckZone = drop.zone; // оптимистично двигаем локально, сервер подтвердит эхом
        this.deckSlot = drop.slot ?? 0;
        this.onFanChange?.(this.fanned()); // веер есть только в руке — кнопки об этом знают
        this.onDeckDrop?.(drop.zone, drop.slot ?? 0);
      }
      // Всегда укладываем колоду у якоря активной зоны (новой при переносе, текущей при
      // промахе/дропе в ту же зону). Иначе карты остались бы в точке отпускания — врозь
      // с хит-зоной колоды (она у якоря), и колоду нельзя было бы снова схватить.
      // Дроп ещё и выравнивает стопку: положил колоду — она легла ровно.
      this.alignCards(this.cards.map((_, i) => i));
      this.cards.forEach((c, i) => c.body.setTarget(this.restTarget(i)));
      this.onDragChange?.(false); // взаимодействие завершено — вернуть кнопки
    }
    this.positionDeckHit();
    this.wake();
  }

  // ——— перевороты, тянучка, рассыпание ———

  // Переворот набора карт вокруг оси, перпендикулярной жесту. Стопка переворачивается
  // волной (задержка на карту), отдельные карты — разом. emit=true → сообщить наверх
  // (состояние на сервер + эффект остальным); false → это уже чужой эффект, играем молча.
  private startFlip(cards: CardVisual[], angle: number, dur: number, emit: boolean, wholeDeck = false): void {
    if (cards.length === 0) return;
    // Волна по картам уместна только в РАСКРЫТОМ вее­ре, где карты видно поодиночке.
    // Стопка — одна вещь: она переворачивается целиком, иначе верхняя (единственная
    // видимая) карта начинала бы поворот последней, и жест выглядел бы «залипающим».
    const stagger = wholeDeck && this.fanned() ? anim.flip.stagger : 0;
    // from — сторона, которая видна СЕЙЧАС. До «ребра» карта показывает именно её, даже
    // если правда от сервера уже пришла: иначе результат сел бы на экран без анимации,
    // и игрок не понял бы, что произошло.
    const entries = cards.map((v, i) => ({
      v,
      delay: i * stagger,
      swapped: false,
      from: this.shownSide(v.card),
    }));
    // Колода делает полтора оборота — видно, что её именно РАЗВЕРНУЛИ, а не подменили
    // картинку; отдельная карта обходится половиной.
    const halfTurns = wholeDeck ? anim.flip.deckHalfTurns : anim.flip.cardHalfTurns;
    this.flipAnim = { t: 0, dur, angle, entries, halfTurns, reverseAtEdge: wholeDeck, reversed: false };
    this.flipMap = new Map(entries.map((e) => [e.v, { delay: e.delay }]));
    this.flipByCard = new Map(entries.map((e) => [e.v.card, e]));
    // Своё действие применяем В ТОТ ЖЕ МИГ: дилер — источник правды, ждать сервер незачем.
    // Сервер получит результат и разошлёт его остальным.
    if (emit) this.flipFacingNow(cards);
    if (emit) {
      const total = Math.round((dur + entries[entries.length - 1].delay) * 1000);
      if (wholeDeck) {
        this.onFlipDeck?.();
        this.onDeckFx?.({ kind: "flip-deck", angle, cards: [], count: 0, dur: total });
      } else {
        const ids = cards.map((c) => c.card);
        this.onFlipCards?.(ids);
        this.onDeckFx?.({ kind: "flip-cards", angle, cards: ids, count: 0, dur: total });
      }
    }
    this.wake();
  }

  // Переворот всей колоды: порядок реверсится на сервере, локально это волна переворотов.
  private flipWholeDeck(angle: number, emit = true): void {
    this.startFlip([...this.cards], angle, anim.flip.deckDur, emit, true);
  }

  private startStretch(angle: number, dur: number = anim.flip.stretchDur, emit = false): void {
    this.stretchAnim = { t: 0, dur, angle };
    if (emit) this.onDeckFx?.({ kind: "stretch", angle, cards: [], count: 0, dur: Math.round(dur * 1000) });
    this.wake();
  }

  // Рассыпание: несколько карт разлетаются и собираются обратно, каждая — случайной
  // стороной (50/50). Именно стороны и уходят на сервер: анимация тут ни при чём.
  private startSpill(count: number, dur: number, emit: boolean): void {
    const n = this.cards.length;
    if (n < 2) return;
    const sp = anim.flip.spill;
    const take = Math.max(1, Math.min(n, count));
    const step = Math.max(1, Math.floor(n / take));
    const picked: CardVisual[] = [];
    for (let i = 0; i < n && picked.length < take; i += step) picked.push(this.cards[i]);

    const dist = this.layout.cardH * sp.dist;
    const entries = picked.map((v, k) => {
      const a = -Math.PI / 2 + ((k + 0.5) / picked.length - 0.5) * Math.PI * 1.4;
      return {
        v,
        from: { x: v.body.px, y: v.body.py, rot: v.body.rotation },
        dir: { dx: Math.cos(a), dy: Math.sin(a) },
        dist,
        spin: (Math.cos(a) >= 0 ? 1 : -1) * anim.swipe.spin,
      };
    });
    this.splashAnim = { t: 0, dur, entries };

    if (emit) {
      // Сторона каждой рассыпанной карты решается монеткой — и это РЕЗУЛЬТАТ, он идёт
      // на сервер. Остальным уедет только сам эффект; стороны они получат состоянием.
      const flipped = picked.filter(() => Math.random() < 0.5);
      if (flipped.length > 0) {
        this.splashAnim.flipMid = flipped; // покажем другую сторону в середине полёта
        this.onFlipCards?.(flipped.map((c) => c.card));
      }
      this.onDeckFx?.({ kind: "spill", angle: 0, cards: [], count: take, dur: Math.round(dur * 1000) });
    }
    this.wake();
  }

  // Сервер не подтвердил переворот. Карты уже показаны другой стороной — возвращаем их
  // тем же движением (переворот в обратную сторону) и объясняем причину поверх стола.
  rejectFlip(cards: string[], text: string): void {
    if (this.destroyed) return;
    const affected = cards.length > 0 ? this.cards.filter((c) => cards.includes(c.card)) : [...this.cards];
    const wholeDeck = cards.length === 0;
    if (wholeDeck && this.flipAnim?.reversed) {
      // Переворот стопки мы применили локально (порядок реверснут) — раз сервер отказал,
      // возвращаем и порядок, иначе клиент остался бы с колодой, которой на сервере нет.
      this.applyOrderLocally([...this.deckCards].reverse());
    }
    this.flipAnim = null; // прерываем незавершённый переворот — он больше не про правду
    this.flipMap.clear();
    this.flipByCard.clear();
    if (affected.length > 0) {
      // Возвращаем тем же движением: модель переворачивается обратно, экран догоняет
      // её на «ребре» — правда не появляется рывком, игрок видит, что откатилось.
      this.startFlip(affected, -Math.PI / 2, anim.flip.cardDur, false, false);
      this.flipFacingNow(affected);
    }
    this.showNotice(text);
  }

  // Короткая надпись поверх стола (переиспользуем оверлей «низяяя»).
  private showNotice(text: string): void {
    if (this.rejectText) this.rejectText.text = text;
    this.notice = { t: 0, dur: anim.flip.noticeDur };
    this.wake();
  }

  // Выровнять карты: у стопки уходит случайный разброс углов, у любой карты — накопленная
  // кривизна. Это «приглаживание» рукой: тык и каждый дроп колоды кладут карты ровно.
  private alignCards(indices: number[]): void {
    if (indices.length === 0) return;
    for (const i of indices) this.restJitter[i] = 0;
    for (const i of indices) this.cards[i]?.body.setTarget(this.restTarget(i));
    this.wake();
  }

  // Карты под касанием: палец «толстый», поэтому берём всё в радиусе, а не одну карту.
  private alignUnderTouch(x: number, y: number): void {
    const positions = this.cards.map((c) => ({ x: c.sprite.x, y: c.sprite.y }));
    this.alignCards(cardsUnderTouch(positions, x, y, this.layout.cardW * anim.touch.fatRadius));
  }

  // ——— драг одной карты из веера ———

  // Веер — не режим, а следствие зоны: карты в руке ВСЕГДА разложены веером,
  // где угодно ещё — стопкой. Тумблера (дабл-клик) больше нет.
  private fanned(): boolean {
    return this.deckZone === "hand";
  }

  private fanOpen(): boolean {
    return this.fanned() && this.cards.length > 0;
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
    const g = this.fanGeom();
    return fanInsertIndex(
      x,
      g.anchor,
      g.width,
      Math.max(1, this.deckCount),
      anim.fan.maxAngleDeg,
      anim.fan.widthFactor,
    );
  }

  // Точка в области веера (полоса дуги ∪ прямоугольник сейф-зоны) — то же, что хит-зона:
  // отпустил здесь → карта переставляется в колоде, а не «уходит» в другую зону.
  private inFanArea(x: number, y: number): boolean {
    const z = this.layout.handZone;
    if (Math.abs(x - z.cx) <= z.w / 2 && Math.abs(y - z.cy) <= z.h / 2) return true;
    const l = this.layout;
    return fanBandContains(x, y, this.fanGeom().anchor, this.fanGeom().width, anim.fan.maxAngleDeg, anim.fan.widthFactor, l.cardW, l.cardH, l.cardH * 0.5);
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
    this.hoverZone = pickDropTarget(p.x, p.y, this.layout);
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
      this.alignUnderTouch(x, y); // положил карту — она и соседи легли ровно
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

  // Применить готовый порядок колоды локально (жест-выплеск считает его сам). Спрайты
  // переиспользуются по идентичности карты, поэтому каждая карта просто едет в свой слот;
  // эхо сервера с тем же порядком уже ничего не сдвинет (см. setDeck).
  private applyOrderLocally(order: string[]): void {
    const byCard = new Map(this.cards.map((c) => [c.card, c]));
    const next = order.map((c) => byCard.get(c)).filter((c): c is CardVisual => !!c);
    if (next.length !== this.cards.length) return; // рассинхрон — не трогаем
    this.deckCards = order;
    this.cards = next;
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
      const so = stackOffset(i, this.cards.length, this.deckIsFaceUp());
      this.cards[i].body.setTarget({ x: px + so.dx * zs, y: py + so.dy * zs, scale: DRAG_SCALE * zs, rot: this.restJitter[i] ?? 0 });
    }
  }

  private applyDragTargets(): void {
    if (!this.press) return;
    const { x, y } = this.press;
    const zs = deckZoneScale(this.deckZone);
    for (let i = 0; i < this.cards.length; i++) {
      const so = stackOffset(i, this.cards.length, this.deckIsFaceUp());
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
      const { rect } = regions[z];
      const label = this.zoneLabels[z];
      // Зоны и подписи видны только пока тащим колоду или карту из веера.
      if ((!this.dragging && !this.cardDrag) || rect.w <= 0 || rect.h <= 0) {
        if (label) label.visible = false;
        return;
      }
      const active = this.hoverZone?.zone === z;
      const base = 0xd9b154;
      const hot = 0xffe9a8;
      const x = rect.cx - rect.w / 2;
      const y = rect.cy - rect.h / 2;
      if (active) g.roundRect(x, y, rect.w, rect.h, rect.r).fill({ color: 0xffe08a, alpha: 0.12 });
      g.roundRect(x, y, rect.w, rect.h, rect.r).stroke({
        width: active ? 5 : 2.5,
        color: active ? hot : base,
        alpha: active ? 0.95 : 0.4,
      });
      // Сейф показывает свои полки: в него кладут ДО ТРЁХ отдельных колод, и целиться
      // надо в конкретную. Подсвечивается та, над которой сейчас палец.
      if (z === "safe") {
        this.layout.safeSlots.forEach((slot, i) => {
          const hotSlot = active && this.hoverZone?.slot === i;
          const sx = slot.cx - slot.w / 2;
          const sy = slot.cy - slot.h / 2;
          if (hotSlot) g.roundRect(sx, sy, slot.w, slot.h, slot.r).fill({ color: 0xffe08a, alpha: 0.16 });
          g.roundRect(sx, sy, slot.w, slot.h, slot.r).stroke({
            width: hotSlot ? 3 : 1.5,
            color: hotSlot ? hot : base,
            alpha: hotSlot ? 0.9 : 0.3,
          });
        });
      }
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
    const base = Math.min(44, Math.max(14, this.layout.cardH * 0.5));
    const regions = dropZoneRegions(this.layout);
    for (const z of Object.keys(this.zoneLabels) as DropZone[]) {
      const t = this.zoneLabels[z];
      if (!t) continue;
      // Подпись не должна вылезать за свою зону: сейф узкий, и «СЕЙФ» кеглем
      // центра расползался на весь стол. Ужимаем по ширине зоны.
      const rect = regions[z].rect;
      const fit = (rect.w * 0.9) / Math.max(1, ZONE_LABELS[z].length * 0.62);
      t.style.fontSize = Math.max(9, Math.min(base, fit));
    }
    if (this.rejectText) this.rejectText.style.fontSize = Math.min(110, Math.max(34, this.layout.cardH * 1.2));
  }


  // «низяяя» по центру экрана во время отскока: та же тряска, что и у колоды, плюс
  // пульс масштаба и затухание к концу анимации.
  private syncRejectText(): void {
    const t = this.rejectText;
    if (!t) return;
    if (!this.reject && !this.notice) {
      if (t.visible) t.visible = false;
      return;
    }
    const p = this.reject ? this.reject.t / this.reject.dur : this.notice!.t / this.notice!.dur;
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
    if (!this.deckDraggable) return; // двигать колоду может только дилер (в лобби)
    // Любой тык приглаживает карты под пальцем: стопка перестаёт быть растрёпанной,
    // отдельная карта в вее­ре ложится ровно. Дабл-клика больше нет: веер открывается
    // не тумблером, а тем, что карты лежат в руке — а туда их только перетаскивают.
    this.alignUnderTouch(e.global.x, e.global.y);
    if (this.fanned() && e.pointerType !== "mouse") {
      this.pokeFan(e.global.x); // тык «ковыряет» веер (на десктопе это делает ховер)
    }
  }

  private positionDeckHit(): void {
    if (!this.deckHit) return;
    // Раскрытый веер — хит-зона это прямоугольник сейф-зоны (дабл-клик по пустому месту
    // собирает веер / хватает колоду) ОБЪЕДИНЁННЫЙ с полосой самой дуги: веер проседает
    // ниже зоны (на широком экране — сильно), и без полосы тык/ховер по крайним картам
    // не срабатывал вовсе. См. fanBandContains.
    if (this.fanned()) {
      const z = this.layout.handZone;
      const l = this.layout;
      const pad = l.cardW * 0.25; // запас под палец
      this.deckHit.hitArea = {
        contains: (x: number, y: number) =>
          (Math.abs(x - z.cx) <= z.w / 2 && Math.abs(y - z.cy) <= z.h / 2) ||
          fanBandContains(x, y, this.fanGeom().anchor, this.fanGeom().width, anim.fan.maxAngleDeg, anim.fan.widthFactor, l.cardW, l.cardH, pad),
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
    return this.fanned() || !!this.shuffleAnim || !!this.scrambleAnim || !!this.cardDrag || !!this.splashAnim;
  }

  private updateVisibility(): void {
    const away = this.deckZone === "away";
    const detailed = this.detailedCards();
    const n = this.cards.length;
    const top = n - 1;
    // Стопка — это ДВЕ настоящие карты (верхняя и нижняя) и блок торцов между ними.
    // Нижняя нужна не для красоты: при развороте она оказывается наверху, и без неё
    // было видно чужую сторону не той карты. Колода из 1-2 карт рисуется как есть.
    for (let i = 0; i < n; i++) {
      this.cards[i].sprite.visible = !away && (detailed || i === top || i === 0);
    }
    if (this.deckBody) this.deckBody.visible = !away && !detailed && n > 2;
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
    if (n < 3) return; // две карты и меньше рисуются как есть, блок не нужен
    const w = this.layout.cardW;
    const h = this.layout.cardH;
    const r = Math.max(3, w * 0.1);
    const mirrored = this.deckIsFaceUp();
    const top = stackOffset(n - 1, n, mirrored); // блок ставим в систему координат верхней карты
    const bg = cardBackSkin(this.cardBack).bg;
    // Сплошное «тело» блока — от самой задней карты, чтобы между полосками не просвечивал стол.
    const back = stackOffset(0, n, mirrored);
    g.roundRect(back.dx - top.dx - w / 2, back.dy - top.dy - h / 2, w, h, r)
      .fill({ color: bg })
      .stroke({ width: 1.5, color: CARD_EDGE.side });

    // Полоски торцов: не все 52 карты (их шаг — доли пикселя и они слились бы в пятно),
    // а через равные промежутки. Видны с тех сторон, куда уходит задняя карта — слева и
    // снизу, — поэтому у каждой полоски рисуем только левый и нижний срезы.
    for (const i of stackStripeIndices(n, anim.deck.stripeSpacing).filter((i) => i > 0)) {
      const so = stackOffset(i, n, mirrored);
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
    if (this.flipAnim && this.flipMap.has(top)) {
      // «Кирпич» переворачивается вместе с верхней картой — как одна вещь.
      const p = Math.max(0, Math.min(1, (this.flipAnim.t - this.flipMap.get(top)!.delay) / this.flipAnim.dur));
      const m = flipTransform(
        top.body.px + this.stretch.dx,
        top.body.py + this.stretch.dy,
        top.body.rotation + flipTilt(p, this.flipAnim.angle, anim.flip.tiltAmp),
        top.body.scaleVal,
        this.flipAnim.angle,
        spinScale(spinAngle(p, this.flipAnim.halfTurns)),
      );
      g.setFromMatrix(new Matrix(m.a, m.b, m.c, m.d, m.tx, m.ty));
      return;
    }
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
    const placed = layoutSeats(this.seats.map((st) => st.id), this.w, this.h, { topOffset: this.topInset });
    this.seatBoxes = placed.seats;
    this.seatInsets = placed.insets;
    this.layout = computeLayout(this.w, this.h, { ...this.seatInsets, bottom: this.bottomInset });
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
    this.drawSeats();
    this.drawZones();
    this.wake();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.shuffleAnim = null;
    this.scrambleAnim = null;
    this.splashAnim = null;
    this.pendingShuffle = null;
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
    // Тексты мест уничтожил app.destroy({children:true}) — просто отпускаем ссылки.
    this.seatTexts = [];
    this.seatLayer = null;
    this.seatG = null;
    this.rejectText = null;
    this.shadowLayer = null;
    this.deckShadow = null;
    this.cardShadow = null;
    this.deckBody = null;
    this.cardLayer = null;
    this.backTex = null;
    this.shadowTex = null;
    if (this.warmTimer !== null) clearTimeout(this.warmTimer);
    this.warmTimer = null;
    this.faceCache.forEach((t) => t.destroy(true));
    this.faceCache.clear();
    this.deckHit = null;
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

      // Лид-ин кнопочной тасовки доиграл — раскладываем по настоящему порядку.
      if (this.pendingShuffle) {
        this.pendingShuffle.t += dt;
        if (this.pendingShuffle.t >= this.pendingShuffle.delay) {
          const order = this.pendingShuffle.order;
          this.pendingShuffle = null;
          const oldOrder = this.cards.map((c) => c.card);
          this.scrambleAnim = null;
          this.applyOrderLocally(order);
          this.startShuffleAnim(oldOrder);
        }
      }

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

    // Переворот: у каждой карты своя задержка (стопка идёт волной). Ровно на «ребре»
    // подменяем текстуру — момент, когда подмену не видно.
    if (this.flipAnim) {
      const fa = this.flipAnim;
      fa.t += frameDt;
      let done = true;
      // Порядок колоды реверсится на ПОСЛЕДНЕМ ребре: до этого стопка просто крутится,
      // и менять, кто наверху, рано.
      const lastEdge = (fa.halfTurns - 0.5) / fa.halfTurns;
      if (fa.reverseAtEdge && !fa.reversed && fa.t / fa.dur >= lastEdge) {
        fa.reversed = true;
        this.applyOrderLocally([...this.deckCards].reverse());
      }
      for (const e of fa.entries) {
        const p = (fa.t - e.delay) / fa.dur;
        if (p < 1) done = false;
        // Сторона переключается на каждом ребре вращения, а не один раз: полтора оборота
        // — это три ребра, и на каждом карта честно показывает следующую сторону.
        const other = spinShowsOther(spinAngle(Math.max(0, Math.min(1, p)), fa.halfTurns));
        if (e.swapped !== other) {
          e.swapped = other;
          e.v.sprite.texture = this.textureFor(e.v.card);
        }
      }
      if (done) {
        this.flipAnim = null;
        this.flipMap.clear();
        this.flipByCard.clear();
        this.applyCardTextures(); // теперь показываем ровно то, что говорит состояние
      }
    }

    if (this.notice) {
      this.notice.t += frameDt;
      if (this.notice.t >= this.notice.dur) {
        this.notice = null;
        if (this.rejectText) this.rejectText.text = REJECT_TEXT; // вернуть текст по умолчанию
      }
    }

    // Тянучка запрещённого жеста.
    if (this.stretchAnim) {
      const st = this.stretchAnim;
      st.t += frameDt;
      const p = st.t / st.dur;
      if (p >= 1) {
        this.stretchAnim = null;
        this.stretch = { dx: 0, dy: 0 };
      } else {
        this.stretch = stretchOffset(p, st.angle, this.layout.cardH * anim.flip.stretchAmp);
      }
    }


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
      !this.pendingShuffle &&
      !this.flipAnim &&
      !this.stretchAnim &&
      !this.notice &&
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
    const x = c.body.px + sh.dx + this.stretch.dx;
    const y = c.body.py + sh.dy + this.stretch.dy;

    // Карта в перевороте рисуется матрицей: вдоль оси жеста размер цел, поперёк —
    // схлопывается (см. flipTransform). Обычная карта — привычными x/y/rot/scale.
    const fm = this.flipMap.get(c);
    if (this.flipAnim && fm) {
      const p = Math.max(0, Math.min(1, (this.flipAnim.t - fm.delay) / this.flipAnim.dur));
      // Крен «живого» переворота накладывается поверх собственного угла карты и сам
      // сходит на нет к концу — карта возвращается ровно к своему положению.
      const tilt = flipTilt(p, this.flipAnim.angle, anim.flip.tiltAmp);
      const f = spinScale(spinAngle(p, this.flipAnim.halfTurns));
      const m = flipTransform(x, y, rot + sh.rot + tilt, scale, this.flipAnim.angle, f);
      c.sprite.setFromMatrix(new Matrix(m.a, m.b, m.c, m.d, m.tx, m.ty));
      return;
    }

    c.sprite.x = x;
    c.sprite.y = y;
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

  // Лицо или рубашка — у каждой карты своя сторона (см. facing). Во время переворота,
  // после прохождения ребра, карта временно показывает противоположную сторону: так
  // подмена текстуры не видна, а по приходу состояния всё сойдётся само.
  private applyCardTextures(): void {
    for (const c of this.cards) c.sprite.texture = this.textureFor(c.card);
  }

  private textureFor(card: string): Texture {
    // Карта в перевороте до «ребра» держит ту сторону, с которой начинала: правда может
    // прийти раньше анимации, но менять картинку без переворота нельзя.
    // Во время вращения сторона определяется фазой: from — та, с которой начали,
    // swapped — перевалили ли нечётное число рёбер.
    const inFlip = this.flipByCard.get(card);
    const up = inFlip ? (inFlip.swapped ? !inFlip.from : inFlip.from) : this.shownSide(card);
    return up && card ? this.faceTexFor(card) : this.backTex!;
  }

  private shownSide(card: string): boolean {
    // Сейф — это «сейф»: что бы ни говорило состояние, лежащие там карты закрыты.
    // Открывать их можно, только вынув колоду наружу.
    if (this.deckZone === "safe") return false;
    return !!this.facing[card];
  }

  // Показать карту другой стороной СРАЗУ, не дожидаясь сервера. Снимется, когда придут
  // данные (подтверждение) или отказ (откат). Таймер — только страховка на случай, когда
  // ответа не будет вовсе (обрыв связи), а не нормальный путь.
  // Перевернуть карты В МОДЕЛИ немедленно: у дилера это и есть правда, ждать нечего.
  // На экране смена стороны произойдёт на «ребре» анимации (см. flipByCard.from).
  private flipFacingNow(cards: CardVisual[]): void {
    for (const c of cards) this.facing[c.card] = !this.facing[c.card];
    this.applyCardTextures();
  }

  // Лицевые текстуры генерятся лениво, и первый же переворот требовал их все сразу —
  // 36-52 генерации в одном кадре давали заметный «тупняк» именно на ПЕРВОМ перевороте.
  // Поэтому греем их заранее, маленькими порциями между кадрами.
  private warmFaceTextures(): void {
    if (this.warmTimer !== null || this.destroyed || !this.app) return;
    const queue = this.deckCards.filter((c) => !this.faceCache.has(`${c}|${this.fourColor ? 1 : 0}`));
    if (queue.length === 0) return;
    let i = 0;
    const step = () => {
      this.warmTimer = null;
      if (this.destroyed || !this.app) return;
      for (let k = 0; k < 3 && i < queue.length; k++, i++) this.faceTexFor(queue[i]);
      if (i < queue.length) this.warmTimer = setTimeout(step, 16);
    };
    this.warmTimer = setTimeout(step, 0);
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

  // Колода лежит лицом вверх? Смотрим по верхней карте: от этого зависит, в какую
  // сторону «растёт» стопка (перевёрнутая пачка смещается зеркально).
  private deckIsFaceUp(): boolean {
    const top = this.cards[this.cards.length - 1];
    return !!top && !!this.facing[top.card];
  }

  private restTarget(i: number): CardTargets {
    if (this.fanned()) return this.fanTarget(i);
    const a = this.activeAnchor();
    const zs = deckZoneScale(this.deckZone);
    const so = stackOffset(i, this.cards.length, this.deckIsFaceUp());
    return { x: a.x + so.dx * zs, y: a.y + so.dy * zs, rot: this.restJitter[i] ?? 0, scale: zs };
  }

  // Геометрия веера в руке. Дуга fanCard провисает ВНИЗ от якоря, поэтому якорь стоит у
  // верхнего края зоны, а ширина ограничена так, чтобы провис влез в высоту зоны — иначе
  // крайние карты уезжают за нижний край экрана.
  private fanGeom(): { anchor: { x: number; y: number }; width: number } {
    const z = this.layout.handZone;
    const cardH = this.layout.cardH;
    const anchor = { x: z.cx, y: z.cy - z.h / 2 + cardH * 0.55 };
    const maxA = (anim.fan.maxAngleDeg * Math.PI) / 180;
    const sagMax = Math.max(1, z.h - cardH * 1.15);
    const byHeight = maxA > 0 ? (2 * sagMax * Math.sin(maxA)) / (1 - Math.cos(maxA)) : Infinity;
    const width = Math.min(z.w, byHeight / anim.fan.widthFactor);
    return { anchor, width };
  }

  // Веер-дуга в руке (чистая математика — см. fan.ts). i может быть дробным
  // (для волны «червячка», где карта плавно ездит между слотами).
  private fanTarget(i: number): CardTargets {
    const g = this.fanGeom();
    const c = fanCard(
      i,
      Math.max(1, this.deckCount),
      g.anchor,
      g.width,
      anim.fan.maxAngleDeg,
      anim.fan.widthFactor,
    );
    return { x: c.x, y: c.y, rot: c.rot, scale: 1 };
  }

  // Теснота текущего веера (0..1) — по ней включается/масштабируется «червячок».
  private fanCrowd(): number {
    const w = anim.fan.wiggle;
    return fanCrowd(this.deckCount, this.fanGeom().width, this.layout.cardW, anim.fan.widthFactor, w.gap, w.ramp);
  }

  // Активен ли «червячок»: веер в руке (тесно ИЛИ идёт локальный поке),
  // и не идёт другая анимация.
  private fanWiggleActive(): boolean {
    return (
      this.fanned() &&
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
    if (!this.fanned() || this.deckCount < 2) return;
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
    const thrown = picked.map((i) => this.cards[i]);
    const entries = thrown.map((v, k) => ({
      v,
      from: { x: v.body.px, y: v.body.py, rot: v.body.rotation },
      dir: dirs[k] ?? dirs[dirs.length - 1],
      dist,
      spin: ((dirs[k] ?? dirs[0]).dx >= 0 ? 1 : -1) * s.spin,
    }));

    // Порядок считаем ЗДЕСЬ, а не ждём сервер: анимация сразу знает, куда каждая карта
    // ляжет, и раскладка получается точной. Сервер потом просто примет готовый порядок.
    const nextOrder = scatterCards(this.deckCards, thrown.map((v) => v.card), Math.random);
    this.applyOrderLocally(nextOrder);
    for (let k = 0; k < entries.length; k++) entries[k].v.sprite.zIndex = 50_000 + k; // летят поверх веера

    this.splashAnim = { t: 0, dur: s.dur, entries };
    this.poke = null;
    this.hoverTarget = 0;
    this.onShuffleChange?.(nextOrder); // наверх уходит готовый порядок; сеть шлёт его сама

    // Самый сильный бросок иногда (33%) переворачивает одну из летящих карт — «неаккуратно
    // швырнул». Сторона решается ЗДЕСЬ и уходит на сервер как результат.
    if (strength >= anim.flip.strongSwipe && Math.random() < anim.flip.swipeShuffleFlipChance) {
      const victim = thrown[Math.floor(Math.random() * thrown.length)];
      this.startFlip([victim], -Math.PI / 2, anim.flip.cardDur, true);
    }
    this.wake();
  }

  // Шаг выплеска: карта уходит по своему направлению и возвращается (синус — туда-обратно).
  // База — ТЕКУЩИЙ слот карты, поэтому пришедший в полёте новый порядок она отработает сама.
  private stepSplash(dt: number): void {
    const sa = this.splashAnim;
    if (!sa) return;
    sa.t += dt;
    const p = Math.min(1, sa.t / sa.dur);
    // Рассыпанные карты меняют сторону в верхней точке полёта — как настоящие, в воздухе.
    if (sa.flipMid && !sa.flipped && p >= 0.5) {
      sa.flipped = true;
      this.flipFacingNow(sa.flipMid);
    }
    const u = easeOutQuad(p); // база едет из старого места в новый слот
    const arc = Math.sin(Math.PI * p); // вылет в сторону и обратно
    for (const e of sa.entries) {
      const i = this.cards.indexOf(e.v);
      if (i < 0) continue;
      const home = this.restTarget(i); // слот уже НОВЫЙ — порядок применён на старте жеста
      e.v.body.setTarget({
        x: lerp(e.from.x, home.x ?? 0, u) + e.dir.dx * e.dist * arc,
        y: lerp(e.from.y, home.y ?? 0, u) + e.dir.dy * e.dist * arc,
        rot: lerp(e.from.rot, home.rot ?? 0, u) + e.spin * arc,
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
    if (!this.fanned() || this.deckCount < 2) return;
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
    if (!this.fanned() || this.deckCount < 2) {
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
