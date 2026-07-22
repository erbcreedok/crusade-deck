import {
  Application,
  Circle,
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
import { dropZoneRegions, pickDropTarget, pickDealTarget, pickSeat, type DropZone, type DropTarget } from "./dropZones";
import { layoutSeats, type SeatBox } from "./seatLayout";
import { dragModeFor, type DragMode } from "./dragMode";
import { dealSourceIndex } from "./topCard";
import type { SeatView } from "./seats";
import { layoutSeatHand, seatCardFaceUp, type SeatHandLayout } from "./seatHand";
import { layoutDeckFan } from "./deckFan";
import { forbidDeckOpenTap } from "./forbidDeckOpen";
import {
  dealHandAccent,
  dealSeatHoverLabel,
  isDealReady,
  DEAL_DROP_REJECT_TEXT,
} from "./dealReadyTint";
import { cardFlightPose, type CardMove, type FlightPoint } from "./cardFlight";
import {
  fanCard,
  fanCrowd,
  fanStep,
  fanRevealScale,
  fanDragSpreadAmp,
  clampFanWidth,
  fanMaxAngleDeg,
  energyEnvelope,
  pokeEnvelope,
  fanBandContains,
  fanInsertIndex,
  visibleSliver,
  fanSpreadShift,
  fanSpreadPinned,
} from "./fan";
import { shuffleFlight, bulgeDir } from "./shuffleFlight";
import { moveCard, scatterCards, shuffleOrder } from "./deckOrder";
import { dedupeDeckOrder } from "./dedupeDeckOrder";
import {
  spinAngle,
  spinScale,
  spinShowsOther,
  flipTilt,
  flipTransform,
  stretchOffset,
} from "./flip";
import { cardsUnderTouch } from "./touch";
import { rowOffsets, rowWidth } from "./handRow";
import { collapseAnchorBottom, fitCollapseButton } from "./collapseButton";
import { collapseRevealPose } from "./collapseReveal";
import { zoneTitle, zoneAction, type DraggedKind } from "./zoneLabels";
import type { DeckFxMessage } from "./deckFxClient";
import {
  swipeStrength,
  swipeCardCount,
  swipeDirections,
  swipeVelocity,
  isSwipeDown,
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

// Пока колода на столе одна, но выделение устроено по id — когда колод станет
// несколько, поменяется только источник этого значения.
export const DECK_ID = "deck";
// Отдельная стопка: МОЯ рука (Player.hand). Не путать с DropZone "hand" (куда раньше
// тащили всю колоду).
export const HAND_ID = "hand";

const DRAG_SCALE = 1.18; // карты «приподнимаются» при захвате (визуальный акцент)
const DRAG_THRESHOLD = 6; // px: меньше — это тап (дабл-клик), больше — реальный драг

// Подписи зон — водяным текстом по центру каждой зоны, видны при отображении дроп-зон.
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
  private seatHandNodes: Container[] = []; // стопка/веер чужой руки (режим раздачи)
  private hoverSeat: string | null = null; // место под курсором во время драга колоды
  private deckHolder: string | null = null; // чьё место держит колоду (deckZone === "seat")
  private onDeckDropToSeat: ((playerId: string) => void) | null = null;
  // Выделение: тап по элементу сообщает наверх, кто это был; тап по пустому месту —
  // что выделение пора снять. Что с этим делать, решает React (см. selection.ts).
  private onDeckTap: ((deckId: string) => void) | null = null;
  private onEmptyTap: (() => void) | null = null;
  private selectedDecks: readonly string[] = [];
  // Рука в фокусе (её колода выделена): веер разъезжается на всю полосу и живёт;
  // без фокуса — узкий спокойный веер на 80% ширины.
  private handFocused = false;
  private focusG: Graphics | null = null; // рамка фокуса вокруг выделенного

  private cards: CardVisual[] = []; // колода на столе
  private hand: CardVisual[] = []; // моя рука (Player.hand)
  private layout: RoomLayout = computeLayout(1, 1);
  private w = 1;
  private h = 1;
  private baseScale = 1;

  private deckCards: string[] = []; // порядок колоды (из состояния сервера)
  private handCards: string[] = []; // порядок моей руки
  private fourColor = false; // четырёхцветная колода (♦ оранж, ♣ голубой) для слабовидящих
  private cardBack: CardBackId = DEFAULT_CARD_BACK; // скин рубашки (меню → Графика)
  private deckCount = 0;
  private handCount = 0;
  private deckZone: DeckZone = "center";
  private dealMode = false; // режим раздачи: колода в центре, рука снизу, DnD верхней карты
  private deckFanned = false; // веер колоды на столе (серверное состояние; видно всем)
  private canDeal = false; // дилер может раздавать верхнюю карту
  private deckPointer = false; // мышь/палец над веером колоды (для liveFan при двух веерах)
  private selfId: string | null = null; // sessionId владельца клиента — дроп в руку = себе
  // Своё место НЕ в this.seats (RoomScreen вычитает self) — готовность/дилерство кэшируем отдельно.
  private selfReady = false;
  private selfIsDealer = false;
  private onDealCard: ((card: string, to: string) => void) | null = null;
  private onDeckFanChange: ((open: boolean) => void) | null = null; // тап открывает / стрелка сворачивает
  private handHit: Container | null = null; // хит-зона полосы руки
  private dealDrag = false; // тащим верхнюю карту на раздачу (не reorder веера)
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
  private onFanCollapse: (() => void) | null = null; // «сложить руку»: стрелка или свайп вниз
  private collapseBtn: Container | null = null; // стрелка под веером руки
  private deckCollapseBtn: Container | null = null; // стрелка под веером колоды (только дилер)
  private collapseWantShow = false;
  private deckCollapseWantShow = false;
  private collapseReveal = 0; // 0..1 появление: slide-up + fade
  private deckCollapseReveal = 0;
  private collapseLayout: { x: number; y: number; r: number } | null = null;
  private deckCollapseLayout: { x: number; y: number; r: number } | null = null;
  private handCounter: Text | null = null; // счётчик карт под сложенной рукой
  private deckCounter: Text | null = null; // счётчик карт под колодой в центре (стопка и веер)
  private deckHit: Container | null = null;

  // Драг колоды дилером: press — палец/мышь прижаты у колоды (ещё не факт что драг),
  // dragging — порог смещения пройден, колода реально едет за курсором.
  private deckDraggable = false;
  private press: { id: number; startX: number; startY: number; x: number; y: number; samples: SwipeSample[] } | null = null;
  private dragging = false;
  private hoverZone: DropTarget | null = null;
  private onDeckDrop: ((zone: DropZone) => void) | null = null;
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
    fromHand: boolean; // жест по руке (иначе — по колоде на столе)
    samples: SwipeSample[]; // короткая история движения — по ней считается скорость свайпа
  } | null = null;
  private cardDrag: {
    id: number;
    v: CardVisual;
    insertAt: number;
    x: number;
    y: number;
    fromHand: boolean; // dealMode: драг из Player.hand, не из колоды
    samples: SwipeSample[]; // история движения — по ней ловим бросок вниз
  } | null = null;
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
  // Перенос карт по столу (раздача/сбор/сброс): призраки летят дугой, схема уже обновилась.
  private cardFlights: {
    sprite: Sprite;
    card: string;
    from: FlightPoint;
    to: FlightPoint;
    t: number;
    delay: number;
    dur: number;
    lift: number;
    toSelf: boolean;
    /** Чужое место: +1 «ещё на месте» (сбор), −1 «ещё не прилетела» (раздача). */
    seatBiasId: string | null;
    seatBias: number;
  }[] = [];
  private flightCards = new Set<string>(); // в полёте — в руке прячем до приземления
  // Смещение счётчика/стопки чужой руки на время полёта (схема уже новая).
  private seatFlightBias = new Map<string, number>();
  // Любая тасовка (кнопка, свайп, будущие жесты) сообщает наверх НОВЫЙ порядок — сеть
  // разбирается сама (открыть сессию, редкий прогресс, финал). Движок о сети не знает.
  private onShuffleChange: ((order: string[]) => void) | null = null;
  // Отложенное применение порядка: «сумбур» как лид-ин, затем настоящая раскладка.
  private pendingShuffle: { order: string[]; t: number; delay: number } | null = null;

  // «Кирпич» колоды: торцы карт под верхней, одной Graphics вместо полусотни спрайтов.
  private deckBody: Graphics | null = null;
  private deckBodyCount = -1; // на сколько карт нарисован блок (перерисовываем при смене)
  private tapStartedOnDeck = false; // нажатие началось на колоде — тап мимо не снимает выделение
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
    this.rebuildLayout();

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
    // Рамка фокуса рисуется НАД картами: она подсказывает, к чему сейчас относятся
    // кнопки панели, и не должна прятаться под стопкой.
    this.focusG = new Graphics();
    this.focusG.zIndex = 9000;
    this.zoneLayer = new Graphics();
    this.zoneLayer.zIndex = 1;
    this.shadowLayer = new Container();
    this.shadowLayer.zIndex = 2;
    this.cardLayer = new Container();
    this.cardLayer.zIndex = 3;
    this.cardLayer.sortableChildren = true; // чересполосица половин в риффле
    this.world.addChild(this.tableG, this.seatLayer, this.zoneLayer, this.shadowLayer, this.cardLayer, this.focusG);

    // Подписи зон живут в zoneLayer (под тенями/картами) — «водяной» текст на фоне.
    (Object.keys(dropZoneRegions(this.layout)) as DropZone[]).forEach((z) => {
      const t = new Text({
        text: zoneTitle(z),
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
    // Тап по колоде (нажали и отпустили, не двигая) — выделение. Драг сюда не попадает.
    hit.on("pointertap", (e: FederatedPointerEvent) => {
      // Гасим всплытие: иначе тот же тап дойдёт до сцены и «тап мимо» снимет
      // выделение, которое мы только что поставили.
      e.stopPropagation();
      this.handleDeckTap(e);
    });
    hit.on("pointermove", (e: FederatedPointerEvent) => this.onDeckHover(e)); // ховер мышью (десктоп)
    hit.on("pointerout", (e: FederatedPointerEvent) => this.onDeckHoverOut(e));
    this.world.addChild(hit);
    this.deckHit = hit;
    this.positionDeckHit();

    // Стрелки «сложить»: рука — любому; колода на столе — только дилеру (см. syncCollapseButton).
    const collapse = new Container();
    collapse.eventMode = "static";
    collapse.cursor = "pointer";
    collapse.zIndex = 10_500; // ВЫШЕ хит-зоны колоды (10 000): иначе её съедала полоса веера
    collapse.visible = false;
    collapse.alpha = 0;
    collapse.addChild(new Graphics());
    collapse.on("pointerdown", (e: FederatedPointerEvent) => e.stopPropagation());
    collapse.on("pointertap", (e: FederatedPointerEvent) => {
      e.stopPropagation();
      this.onFanCollapse?.();
    });
    this.world.addChild(collapse);
    this.collapseBtn = collapse;

    const deckCollapse = new Container();
    deckCollapse.eventMode = "static";
    deckCollapse.cursor = "pointer";
    deckCollapse.zIndex = 10_500;
    deckCollapse.visible = false;
    deckCollapse.alpha = 0;
    deckCollapse.addChild(new Graphics());
    deckCollapse.on("pointerdown", (e: FederatedPointerEvent) => e.stopPropagation());
    deckCollapse.on("pointertap", (e: FederatedPointerEvent) => {
      e.stopPropagation();
      this.onDeckFanChange?.(false);
    });
    this.world.addChild(deckCollapse);
    this.deckCollapseBtn = deckCollapse;

    const counter = new Text({
      text: "",
      style: { fontFamily: "VT323, monospace", fontSize: 20, fill: 0xd9b154, letterSpacing: 2 },
    });
    counter.anchor.set(0.5);
    counter.visible = false;
    counter.zIndex = 9200;
    counter.eventMode = "none";
    this.world.addChild(counter);
    this.handCounter = counter;

    const deckCounter = new Text({
      text: "",
      style: { fontFamily: "VT323, monospace", fontSize: 20, fill: 0xd9b154, letterSpacing: 2 },
    });
    deckCounter.anchor.set(0.5);
    deckCounter.visible = false;
    deckCounter.zIndex = 9200;
    deckCounter.eventMode = "none";
    this.world.addChild(deckCounter);
    this.deckCounter = deckCounter;

    this.syncCollapseButton();
    this.syncDeckCounter();

    // Move/up ловим на всей сцене — палец может уйти далеко за пределы колоды.
    app.stage.eventMode = "static";
    app.stage.hitArea = new Rectangle(0, 0, this.w, this.h);
    app.stage.on("pointermove", (e: FederatedPointerEvent) => this.onPointerMove(e));
    app.stage.on("pointerup", (e: FederatedPointerEvent) => {
      const wasDrag = this.dragging || !!this.cardDrag;
      this.onPointerUp(e);
      // После настоящего драга тапа не будет — снимаем метку сами, иначе она проглотит
      // следующий честный тап по пустому месту.
      if (wasDrag) this.tapStartedOnDeck = false;
    });
    // Тап мимо всего — снять выделение. Тап по колоде сюда не доходит: он погашен
    // на её хит-зоне (stopPropagation выше).
    app.stage.on("pointertap", () => {
      // Жест начался на колоде, а палец отпустили мимо зоны — это НЕ «тап по пустому
      // месту»: рука не должна складываться от касания собственных карт.
      if (this.tapStartedOnDeck) {
        this.tapStartedOnDeck = false;
        return;
      }
      this.onEmptyTap?.();
    });
    app.stage.on("pointerupoutside", (e: FederatedPointerEvent) => this.onPointerUp(e));

    if (this.seats.length > 0) this.applySeats(); // места могли приехать до монтирования

    // Состояние комнаты могло приехать РАНЬШЕ, чем поднялся Pixi (вход в живую комнату,
    // перезагрузка страницы): setDeck тогда только запомнил порядок и вышел на «ещё не
    // смонтированы», а повторно его никто не звал — deckKey в RoomCanvas не менялся.
    // Итог: карт не видно, пока не нажмёшь «Растасовать». Доигрываем отложенный порядок.
    if (this.deckCards.length > 0) this.setDeck(this.deckCards);
    if (this.handCards.length > 0) this.setHand(this.handCards);

    // Хит-зона руки — отдельный невидимый слой над полосой handZone.
    const handHit = new Container();
    handHit.eventMode = "static";
    handHit.cursor = "pointer";
    handHit.zIndex = 10_100;
    handHit.on("pointerdown", (e: FederatedPointerEvent) => this.onHandDown(e));
    handHit.on("pointertap", (e: FederatedPointerEvent) => {
      e.stopPropagation();
      this.handleHandTap(e);
    });
    handHit.on("pointermove", (e: FederatedPointerEvent) => this.onHandHover(e));
    handHit.on("pointerout", (e: FederatedPointerEvent) => this.onHandHoverOut(e));
    this.world.addChild(handHit);
    this.handHit = handHit;
    this.positionHandHit();

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
    // Защита от раздутой колоды (баг ArraySchema setAt / дубликаты при реордере).
    const unique = dedupeDeckOrder(cards);
    if (unique.length !== cards.length || cards.length > 52) {
      console.warn("[setDeck] suspicious deck", { rawLen: cards.length, uniqueLen: unique.length, sample: cards.slice(0, 8) });
    }
    const newOrder = unique.slice(0, 52);
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
    this.syncDeckCounter();
    this.warmFaceTextures(); // чтобы первый переворот не генерил все лица разом
    this.wake();
  }

  // Моя рука (Player.hand). Отдельная стопка в полосе handZone — не колода, перетащенная вниз.
  setHand(cards: string[]): void {
    const newOrder = cards.slice(0, 60);
    this.handCards = newOrder;
    this.handCount = newOrder.length;
    if (!this.cardLayer || !this.backTex) return;

    this.reconcileHandByIdentity(newOrder);
    this.hand.forEach((c, i) => {
      c.body.snapTo(this.handRestTarget(i));
      c.sprite.zIndex = 2000 + (this.handRowMode() ? this.hand.length - i : i);
      c.sprite.texture = this.faceTexture(c.card); // свою руку владелец видит всегда
      c.sprite.visible = true;
    });
    this.syncHandCounter();
    this.syncCollapseButton();
    this.positionHandHit();
    this.warmFaceTextures();
    this.wake();
  }

  setDealMode(v: boolean): void {
    if (v === this.dealMode) return;
    this.dealMode = v;
    this.cards.forEach((c, i) => c.body.setTarget(this.restTarget(i)));
    this.hand.forEach((c, i) => c.body.setTarget(this.handRestTarget(i)));
    this.positionDeckHit();
    this.positionHandHit();
    this.updateVisibility();
    this.syncCollapseButton();
    this.syncHandCounter();
    this.drawSeats(); // стопка/веер на местах — только в раздаче
    this.wake();
  }

  setDeckFanned(open: boolean): void {
    // Веер колоды независим от веера руки: серверное состояние принимаем всегда.
    if (open === this.deckFanned) return;
    this.deckFanned = open;
    this.cards.forEach((c, i) => c.body.setTarget(this.restTarget(i)));
    this.positionDeckHit();
    this.updateVisibility();
    this.syncCollapseButton();
    this.syncDeckCounter();
    this.wake();
  }

  setCanDeal(v: boolean): void {
    this.canDeal = v;
    if (this.deckHit) this.deckHit.cursor = this.dealMode ? (v ? "grab" : "pointer") : this.deckDraggable ? "grab" : "pointer";
    this.syncCollapseButton();
  }

  setSelfId(id: string | null): void {
    this.selfId = id;
  }

  setSelfDealState(ready: boolean, isDealer: boolean): void {
    if (ready === this.selfReady && isDealer === this.selfIsDealer) return;
    this.selfReady = ready;
    this.selfIsDealer = isDealer;
    this.drawZones();
    this.wake();
  }

  setOnDealCard(fn: ((card: string, to: string) => void) | null): void {
    this.onDealCard = fn;
  }

  setOnDeckFanChange(fn: ((open: boolean) => void) | null): void {
    this.onDeckFanChange = fn;
  }

  // Чужие игроки за столом. Их посадка («П», см. seatLayout) отжимает центр стола, поэтому
  // раскладка пересчитывается целиком, а колода переезжает к новому якорю.
  setSeats(seats: SeatView[]): void {
    this.seats = seats;
    this.applySeats();
    this.warmFaceTextures(); // открытые чужие руки — лица заранее
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

  setOnDeckTap(fn: ((deckId: string) => void) | null): void {
    this.onDeckTap = fn;
  }

  setOnEmptyTap(fn: (() => void) | null): void {
    this.onEmptyTap = fn;
  }

  // Какие колоды сейчас выделены (id колод). Пока колода одна — см. DECK_ID.
  setSelectedDecks(ids: readonly string[]): void {
    const same = ids.length === this.selectedDecks.length && ids.every((id, i) => id === this.selectedDecks[i]);
    if (same) return;
    this.selectedDecks = [...ids];
    this.applyHandFocus();
    this.drawFocus();
    this.wake();
  }

  // Фокус на руке = выделена стопка руки (HAND_ID). В legacy (не dealMode) — ещё и
  // колода, лежащая в hand-зоне. Полоса разъезжается веером, карты едут пружиной.
  private applyHandFocus(): void {
    const next = this.dealMode
      ? this.selectedDecks.includes(HAND_ID)
      : this.deckZone === "hand" && this.selectedDecks.includes(DECK_ID);
    if (next === this.handFocused) return;
    this.handFocused = next;
    this.rebuildLayout();
    if (this.dealMode) {
      // Веер колоды на столе не трогаем — он общий и живёт отдельно от руки.
      this.hand.forEach((c, i) => c.body.setTarget(this.handRestTarget(i)));
      this.hoverTarget = 0;
      this.hoverEnv = 0;
      this.poke = null;
    } else {
      this.cards.forEach((c, i) => c.body.setTarget(this.restTarget(i)));
    }
    this.positionDeckHit();
    this.positionHandHit();
    this.drawZones();
    this.syncCollapseButton();
    this.syncHandCounter();
    this.updateVisibility();
    this.onFanChange?.(next);
  }

  private rebuildLayout(): void {
    this.layout = computeLayout(this.w, this.h, { ...this.seatInsets, bottom: this.bottomInset });
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
    this.rebuildLayout();
    if (!this.app) return; // ещё не смонтированы — нарисуем на mount
    this.drawSeats();
    // Центр уехал/сузился: колода переезжает к новому якорю, за ней — её хит-зона.
    this.cards.forEach((c, i) => c.body.setTarget(this.restTarget(i)));
    this.hand.forEach((c, i) => c.body.setTarget(this.handRestTarget(i)));
    this.positionHandHit();
    this.positionDeckHit();
    this.drawZones();
    this.syncHandCounter();
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
  // Рамка фокуса вокруг выделенной колоды: небольшая подсветка, чтобы было видно,
  // к чему относятся кнопки панели.
  private drawFocus(): void {
    const g = this.focusG;
    if (!g) return;
    g.clear();
    // Рука в фокусе: рамки нет — видно по вееру. Колода в hand-зоне — тоже.
    if (this.selectedDecks.includes(HAND_ID)) return;
    if (!this.selectedDecks.includes(DECK_ID) || this.cards.length === 0) return;
    if (this.deckZone === "away" || this.deckZone === "hand") return;
    const a = this.activeAnchor();
    const scale = deckZoneScale(this.deckZone);
    const w = this.layout.cardW * scale;
    const h = this.layout.cardH * scale;
    const pad = Math.max(6, this.layout.cardH * 0.12);
    const x = a.x - w / 2 - pad;
    const y = a.y - h / 2 - pad;
    g.roundRect(x, y, w + pad * 2, h + pad * 2, 14).stroke({ width: 3, color: 0xffe9a8, alpha: 0.95 });
    g.roundRect(x, y, w + pad * 2, h + pad * 2, 14).fill({ color: 0xffe08a, alpha: 0.08 });
  }


  private drawSeats(): void {
    const g = this.seatG;
    const layer = this.seatLayer;
    if (!g || !layer) return;
    g.clear();
    this.seatTexts.forEach((t) => t.destroy());
    this.seatTexts = [];
    this.clearSeatHands();

    const dragging = this.dragging || !!this.cardDrag;
    const fontSize = Math.min(20, Math.max(11, this.layout.cardH * 0.22));

    for (const box of this.seatBoxes) {
      const seat = this.seats.find((s) => s.id === box.id);
      if (!seat) continue;
      const { cx, cy, w, h, r } = box.rect;
      const x = cx - w / 2;
      const y = cy - h / 2;
      const hot = dragging && this.dealDrag && this.hoverSeat === seat.id;
      // Раздача: готов → жёлтый, не готов → серый. Дилер всегда готов.
      const seatOpen = isDealReady(seat.isReady, seat.isDealer);
      const seatReadyTint = this.dealMode ? dealHandAccent(seatOpen) : null;
      // Отключённый игрок («на паузе») — приглушён; дилер — золотая рамка вне раздачи.
      const border =
        seatReadyTint != null
          ? seatReadyTint
          : seat.isDealer
            ? 0xf2c14e
            : seat.connected
              ? 0x8fa39a
              : 0x5d6b64;
      const alpha = seat.connected ? 1 : 0.45;

      // Idle: только тонкая рамка-стиль (жёлтый/серый), без заливки и эффектов.
      // Контент внутри не красим — цвет только у обводки зоны.
      if (seatReadyTint == null) {
        g.roundRect(x, y, w, h, r).fill({ color: 0x000000, alpha: 0.18 });
      }
      g.roundRect(x, y, w, h, r).stroke({
        width: this.dealMode ? 2 : 2,
        color: border,
        alpha: seatReadyTint != null ? 0.22 * alpha : 0.55 * alpha,
      });

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
      // Имя — к верхнему краю; середину в раздаче занимает стопка/веер руки.
      label.anchor.set(0.5, 0);
      label.x = cx;
      label.y = y + 4;
      layer.addChild(label);
      this.seatTexts.push(label);

      const visualCount = this.seatVisualCount(seat);
      const handLayout = layoutSeatHand({
        rect: box.rect,
        count: visualCount,
        handFanned: seat.handFanned,
        dealMode: this.dealMode,
        tableCardW: this.layout.cardW,
        tableCardH: this.layout.cardH,
      });
      if (handLayout.kind !== "empty") {
        this.paintSeatHand(seat, handLayout, visualCount);
      } else {
        // Вне раздачи (или пустая рука) — текстовый счётчик, как раньше.
        const count = new Text({
          text: visualCount > 0 ? `🂠 ${visualCount}` : "—",
          style: { fontFamily: "VT323, monospace", fontSize, fill: 0xcdb98f, letterSpacing: 1 },
        });
        count.anchor.set(0.5, 1);
        count.x = cx;
        count.y = y + h - 4;
        layer.addChild(count);
        this.seatTexts.push(count);
      }

      // Ховер раздачи: плотный оверлей поверх контента бокса + действие.
      if (hot && seatReadyTint != null) {
        const overlay = new Graphics();
        overlay.roundRect(x, y, w, h, r).fill({ color: seatReadyTint, alpha: 0.82 });
        overlay.roundRect(x, y, w, h, r).stroke({ width: 4, color: 0xffe9a8, alpha: 0.95 });
        overlay.eventMode = "none";
        layer.addChild(overlay);
        this.seatHandNodes.push(overlay);

        const action = new Text({
          text: dealSeatHoverLabel(seatOpen),
          style: {
            fontFamily: "VT323, monospace",
            fontSize: Math.min(36, Math.max(18, h * 0.28)),
            fill: 0x1a1f1c,
            letterSpacing: 2,
            align: "center",
          },
        });
        action.anchor.set(0.5);
        action.x = cx;
        action.y = cy;
        action.eventMode = "none";
        layer.addChild(action);
        this.seatTexts.push(action);
      }
    }
  }

  private clearSeatHands(): void {
    for (const n of this.seatHandNodes) n.destroy({ children: true });
    this.seatHandNodes = [];
  }

  // Стопка (закрытая) или веер (открытая) + цифровой счётчик под ними.
  private paintSeatHand(seat: SeatView, L: SeatHandLayout, visualCount = seat.handCount): void {
    const layer = this.seatLayer;
    if (!layer || !this.backTex || L.cards.length === 0) return;
    const root = new Container();
    root.eventMode = "none";
    root.alpha = seat.connected ? 1 : 0.45;

    if (L.kind === "stack") this.paintSeatStack(root, seat, L);
    else this.paintSeatFan(root, seat, L);

    if (L.counter) {
      const count = new Text({
        text: String(visualCount),
        style: {
          fontFamily: "VT323, monospace",
          fontSize: Math.max(11, Math.min(22, L.cardH * 0.38)),
          fill: 0xd9b154,
          letterSpacing: 1,
        },
      });
      count.anchor.set(0.5);
      count.x = L.counter.x;
      count.y = L.counter.y;
      root.addChild(count);
    }

    layer.addChild(root);
    this.seatHandNodes.push(root);
  }

  // Стопка на месте: кирпич + верх. При handOpen верх — лицо (остальное рубашки).
  private paintSeatStack(root: Container, seat: SeatView, L: SeatHandLayout): void {
    const n = L.cards.length;
    const w = L.cardW;
    const h = L.cardH;
    const r = Math.max(2, w * 0.1);
    const bg = cardBackSkin(this.cardBack).bg;
    const top = L.cards[n - 1]!;
    const showFaces = seatCardFaceUp(seat.handOpen);

    if (n >= 3) {
      const g = new Graphics();
      const back = L.cards[0]!;
      g.roundRect(back.x - w / 2, back.y - h / 2, w, h, r)
        .fill({ color: bg })
        .stroke({ width: 1.2, color: CARD_EDGE.side });
      for (const i of stackStripeIndices(n, anim.deck.stripeSpacing).filter((i) => i > 0)) {
        const c = L.cards[i]!;
        g.roundRect(c.x - w / 2, c.y - h / 2, w, h, r).fill({ color: bg });
        g.moveTo(c.x - w / 2 + 0.6, c.y - h / 2 + r)
          .lineTo(c.x - w / 2 + 0.6, c.y + h / 2 - r)
          .stroke({ width: 1.2, color: CARD_EDGE.side });
        g.moveTo(c.x - w / 2 + r, c.y + h / 2 - 0.6)
          .lineTo(c.x + w / 2 - r, c.y + h / 2 - 0.6)
          .stroke({ width: 1.2, color: CARD_EDGE.bottom });
      }
      root.addChild(g);
    } else {
      for (let i = 0; i < n - 1; i++) {
        const c = L.cards[i]!;
        const spr = new Sprite(this.backTex!);
        spr.anchor.set(0.5);
        spr.position.set(c.x, c.y);
        spr.scale.set(L.cardH / TEX_H);
        root.addChild(spr);
      }
    }

    const topId = seat.hand[n - 1] ?? "";
    const topTex = showFaces && topId ? this.faceTexFor(topId) : this.backTex!;
    const topSpr = new Sprite(topTex);
    topSpr.anchor.set(0.5);
    topSpr.position.set(top.x, top.y);
    topSpr.scale.set(L.cardH / TEX_H);
    root.addChild(topSpr);
  }

  // Веер на месте. Лица — только если handOpen; иначе рубашки (закрытый веер).
  private paintSeatFan(root: Container, seat: SeatView, L: SeatHandLayout): void {
    const ids = seat.hand;
    const showFaces = seatCardFaceUp(seat.handOpen);
    for (let i = 0; i < L.cards.length; i++) {
      const c = L.cards[i]!;
      const id = ids[i] ?? "";
      const tex = showFaces && id ? this.faceTexFor(id) : this.backTex!;
      const spr = new Sprite(tex);
      spr.anchor.set(0.5);
      spr.position.set(c.x, c.y);
      spr.rotation = c.rot;
      spr.scale.set(L.cardH / TEX_H);
      root.addChild(spr);
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
    this.drawSeats(); // чужие стопки/вееры на местах
    old?.destroy(true);
    this.wake();
  }

  // Четырёхцветная колода (для слабовидящих) — переключение перекрашивает лица.
  setFourColor(v: boolean): void {
    if (v === this.fourColor) return;
    this.fourColor = v;
    this.applyCardTextures(); // фейсы возьмут новый цвет (кэш по fourColor)
    this.drawSeats();
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

  // Зона колоды с точки зрения локального игрока (см. deckZone.ts): рисуем у
  // соответствующего якоря; "away" (держателя за столом нет) — колода прячется.
  setDeckZone(zone: DeckZone): void {
    if (zone === this.deckZone) return;
    this.deckZone = zone;
    const away = zone === "away";
    this.updateVisibility();
    if (this.deckHit) this.deckHit.eventMode = away ? "none" : "static";
    // Не «away» — карты плавно летят к новому якорю (setTarget, а не snap).
    if (!away) this.cards.forEach((c, i) => c.body.setTarget(this.restTarget(i)));
    this.positionDeckHit();
    this.applyCardTextures();
    this.applyHandFocus();
    this.drawFocus();
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

  // Свернуть руку (выйти из фокуса): стрелка под веером или свайп вниз по нему.
  setOnFanCollapse(fn: (() => void) | null): void {
    this.onFanCollapse = fn;
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
  setOnDeckDrop(fn: ((zone: DropZone) => void) | null): void {
    this.onDeckDrop = fn;
  }

  // Колбэк на старт/конец драга колоды (React прячет кнопки действий на время драга).
  setOnDragChange(fn: ((active: boolean) => void) | null): void {
    this.onDragChange = fn;
  }

  // Якорь, у которого сейчас покоится колода: центр, моя рука или чужое место.
  private activeAnchor(): { x: number; y: number } {
    if (this.deckZone === "hand") return this.layout.handAnchor;
    // Колода лежит на месте другого игрока — её якорь и есть центр его прямоугольника.
    if (this.deckZone === "seat") {
      const box = this.seatBox(this.deckHolder);
      if (box) return { x: box.rect.cx, y: box.rect.cy };
    }
    return this.layout.deckAnchor;
  }

  // ——— драг колоды ———

  private onDeckDown(e: FederatedPointerEvent): void {
    this.tapStartedOnDeck = true;
    this.skipNextTap = false; // новый жест — прошлое подавление тапа больше не актуально
    const mode = this.dragMode();
    if (mode === "none") return;
    // Раздача: стопка → верхняя карта; открытый веер → карта под пальцем/пивотом.
    if (mode === "topCard") {
      if (this.cardPress || this.cardDrag || this.cards.length === 0) return;
      this.dealDrag = true;
      this.deckPointer = true;
      this.cardPress = {
        id: e.pointerId,
        startX: e.global.x,
        startY: e.global.y,
        x: e.global.x,
        y: e.global.y,
        index: dealSourceIndex(this.cards.length, this.deckFanned, this.nearestFanIndex(e.global.x)),
        canGrab: true,
        fromHand: false,
        samples: [{ x: e.global.x, y: e.global.y, t: performance.now() }],
      };
      this.wake();
      return;
    }
    // Не-дилер на открытом веере: только глиссандо/тык, без драга и тасовки.
    if (mode === "peek") {
      if (this.cardPress || this.cardDrag || this.cards.length === 0) return;
      this.dealDrag = false;
      this.deckPointer = true;
      this.cardPress = {
        id: e.pointerId,
        startX: e.global.x,
        startY: e.global.y,
        x: e.global.x,
        y: e.global.y,
        index: this.nearestFanIndex(e.global.x),
        canGrab: false,
        fromHand: false,
        samples: [{ x: e.global.x, y: e.global.y, t: performance.now() }],
      };
      this.wake();
      return;
    }
    // Рука в фокусе — жест относится к КАРТЕ; сложенная рука и любая другая зона —
    // к колоде целиком. Правило целиком лежит в dragMode.ts.
    if (mode === "card") {
      if (this.cardPress || this.cardDrag) return;
      const index = this.nearestFanIndex(e.global.x);
      // Зажатый веер не таскаем: пока карта не показала достаточную полоску, её не за что
      // взять. Но палец не игнорируем — ведение по вееру раскрывает его под пальцем
      // («глиссандо», см. onPointerMove), и уже в открытый зазор карту можно брать.
      const canGrab = this.canGrabAt(index);
      this.dealDrag = false;
      this.cardPress = {
        id: e.pointerId,
        startX: e.global.x,
        startY: e.global.y,
        x: e.global.x,
        y: e.global.y,
        index,
        canGrab,
        fromHand: false,
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
      this.cardDrag.samples.push({ x: e.global.x, y: e.global.y, t: performance.now() });
      if (this.cardDrag.samples.length > 12) this.cardDrag.samples.shift();
      // Резкий бросок ВНИЗ прерывает драг: карта возвращается на место, рука складывается.
      // При раздаче верхней карты свайп вниз просто отменяет жест (без сворачивания руки).
      const v = swipeVelocity(this.cardDrag.samples, anim.swipe.windowMs);
      if (!this.dealDrag && isSwipeDown(v.vx, v.vy)) {
        const dragged = this.cardDrag.v;
        this.cardDrag = null;
        this.skipNextTap = true;
        this.hoverZone = null;
        this.returnCardHome(dragged);
        this.drawZones();
        this.onDragChange?.(false);
        this.onFanCollapse?.();
        this.wake();
        return;
      }
      this.cardDrag.x = e.global.x;
      this.cardDrag.y = e.global.y;
      if (this.dealDrag) {
        // Ховер и по неготовым — чтобы показать «Неа»; accept/reject решает дроп.
        const seatHit = pickSeat(e.global.x, e.global.y, this.seatBoxes);
        this.setHoverSeat(seatHit && seatHit !== this.selfId ? seatHit : null);
        const to = pickDealTarget(
          e.global.x,
          e.global.y,
          this.seatBoxes,
          this.layout,
          this.selfId,
          this.dealReadyIds(),
        );
        // Своя рука подсвечивается как дроп-зона hand.
        this.hoverZone = to === this.selfId ? { zone: "hand" } : null;
        if (this.deckFanned) {
          // Веер колоды раступается перед картой (дырка по x), как рука при реордере.
          if (this.inDeckFanArea(e.global.x, e.global.y)) {
            this.cardDrag.insertAt = this.insertDeckIndexAt(e.global.x);
          }
          this.applyCardDragTargets();
        } else {
          this.cardDrag.v.body.setTarget({ x: e.global.x, y: e.global.y, rot: 0, scale: DRAG_SCALE });
        }
        this.drawSeats();
        this.drawZones();
      } else {
        this.cardDrag.insertAt = this.cardDrag.fromHand
          ? this.insertHandIndexAt(e.global.x)
          : this.insertIndexAt(e.global.x);
        this.hoverZone = pickDropTarget(e.global.x, e.global.y, this.layout);
        this.applyCardDragTargets();
        this.drawZones();
      }
      this.wake();
      return;
    }
    if (this.cardPress && e.pointerId === this.cardPress.id) {
      const p = this.cardPress;
      p.samples.push({ x: e.global.x, y: e.global.y, t: performance.now() });
      if (p.samples.length > 12) p.samples.shift();
      p.x = e.global.x;
      p.y = e.global.y;
      const dx = p.x - p.startX;
      const dy = p.y - p.startY;
      if (dx * dx + dy * dy < DRAG_THRESHOLD * DRAG_THRESHOLD) return; // ещё тык, не жест

      // Раздача верхней карты — сразу в драг; тап после этого не откроет веер.
      if (this.dealDrag) {
        this.skipNextTap = true;
        this.beginCardDrag();
        return;
      }

      // Резкий бросок ВВЕРХ по вееру — это «перемешать». Медленное ведение (скролл/
      // глиссандо) сюда не проходит: нужна и скорость по окну, и пройденный путь вверх.
      const v = swipeVelocity(p.samples, anim.swipe.windowMs);
      // Свайп ВНИЗ по вееру РУКИ складывает руку. По колоде — нет (сворачивает стрелка дилера).
      if (
        p.fromHand &&
        isSwipeDown(v.vx, v.vy) &&
        p.y - p.startY >= this.layout.cardH * anim.swipe.minTravel
      ) {
        this.cardPress = null;
        this.dealDrag = false;
        this.onFanCollapse?.();
        return;
      }
      // Тасовка колоды — только дилер; не-дилер на peek продолжает глиссандо.
      if (this.isSwipeUp(v.vx, v.vy, p.startY - p.y)) {
        if (!p.fromHand && (this.canDeal || !this.dealMode)) {
          this.startSwipeShuffle(v.vx, v.vy, p.index);
          this.cardPress = null;
          this.dealDrag = false;
          this.deckPointer = false;
          return;
        }
        if (!p.fromHand && !this.canDeal) {
          this.glissandoTo(e.global.x);
          return;
        }
      }
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
      const fromDeck = !this.cardPress.fromHand;
      this.cardPress = null; // пальцем не двинули — это тап, его ловит pointertap
      // Тап по колоде (открыть веер) не должен оставлять dealDrag=true — иначе liveFan
      // веера колоды молчит до следующего реального дропа карты.
      this.dealDrag = false;
      if (fromDeck) this.deckPointer = false;
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

    // Не было смещения — это тап (его обработает pointertap: выделение). Ничего не двигаем.
    if (!wasDragging) {
      this.wake();
      return;
    }

    // Место игрока — тоже дроп-зона, и оно вне центра и руки, поэтому проверяется первым:
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
      if (drop && drop.zone !== this.deckZone) {
        this.deckZone = drop.zone; // оптимистично двигаем локально, сервер подтвердит эхом
        this.onFanChange?.(this.fanned()); // веер есть только в руке — кнопки об этом знают
        this.onDeckDrop?.(drop.zone);
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

  // Сбор / сброс колоды: с мест (и своей руки) карты летят в колоду.
  playCollectAnim(seatOrder: readonly string[], counts?: Record<string, number>): void {
    const dest = this.cardMoveAnchor("deck");
    let delay = 0;
    const stagger = anim.cardMove.stagger;
    for (const id of seatOrder) {
      const n = Math.max(0, counts?.[id] ?? 1);
      if (n === 0) continue;
      const from = this.cardMoveAnchor(id);
      // Схема уже обнулила руки — покажем стопку до приземления призраков.
      const seatBiasId = id === this.selfId || id === "deck" ? null : id;
      for (let k = 0; k < n; k++) {
        this.enqueueCardFlight({
          card: `collect:${id}:${k}`,
          from: { ...from, rot: (k - (n - 1) / 2) * 0.04 },
          to: dest,
          faceUp: false,
          delay,
          toSelf: false,
          seatBiasId,
          seatBias: seatBiasId ? 1 : 0,
        });
        delay += stagger * 0.35;
      }
      delay += stagger;
    }
  }

  // Серверное card_moved (раздача / будущие hand→hand). Дилерский дроп уже в полёте — skip.
  playCardMoved(moves: readonly CardMove[]): void {
    let delay = 0;
    for (const m of moves) {
      if (this.flightCards.has(m.card)) continue;
      const from = this.cardMoveAnchor(m.from);
      const to = this.cardMoveAnchor(m.to);
      const toSelf = m.to === this.selfId;
      const faceUp = toSelf || this.seatShowsFaces(m.to);
      // Схема уже увеличила handCount — не рисуем карту на месте, пока летит призрак.
      const seatBiasId = !toSelf && m.to !== "deck" ? m.to : null;
      this.enqueueCardFlight({
        card: m.card,
        from,
        to,
        faceUp,
        delay,
        toSelf,
        seatBiasId,
        seatBias: seatBiasId ? -1 : 0,
      });
      delay += anim.cardMove.stagger * 0.5;
    }
  }

  /** Старт полёта с текущей позы (дроп раздачи с пальца). */
  playDealFlight(card: string, from: FlightPoint, toId: string): void {
    const to = this.cardMoveAnchor(toId);
    const toSelf = toId === this.selfId;
    const faceUp = toSelf || this.seatShowsFaces(toId);
    // Схема вот-вот +1; держим стопку на месте, пока летит призрак (эхо card_moved скипнет).
    const seatBiasId = !toSelf && toId !== "deck" ? toId : null;
    this.enqueueCardFlight({
      card,
      from,
      to,
      faceUp,
      delay: 0,
      toSelf,
      seatBiasId,
      seatBias: seatBiasId ? -1 : 0,
    });
  }

  private seatShowsFaces(playerId: string): boolean {
    if (playerId === "deck") return false;
    return !!this.seats.find((s) => s.id === playerId)?.handOpen;
  }

  /** Кто принимает карты: «Готов» или дилер (всегда). Боты тоже isReady. */
  private dealReadyIds(): Set<string> {
    const ids = new Set<string>();
    for (const s of this.seats) if (isDealReady(s.isReady, s.isDealer)) ids.add(s.id);
    return ids;
  }

  private selfDealReady(): boolean {
    return isDealReady(this.selfReady, this.selfIsDealer);
  }

  private cardMoveAnchor(pile: string): FlightPoint {
    if (pile === "deck") {
      const a = this.layout.deckAnchor;
      return { x: a.x, y: a.y, rot: 0 };
    }
    if (pile === this.selfId) {
      const a = this.layout.handAnchor;
      return { x: a.x, y: a.y, rot: 0 };
    }
    const box = this.seatBoxes.find((b) => b.id === pile);
    if (box) return { x: box.rect.cx, y: box.rect.cy, rot: 0 };
    const a = this.layout.deckAnchor;
    return { x: a.x, y: a.y, rot: 0 };
  }

  private enqueueCardFlight(opts: {
    card: string;
    from: FlightPoint;
    to: FlightPoint;
    faceUp: boolean;
    delay: number;
    toSelf: boolean;
    seatBiasId: string | null;
    seatBias: number;
  }): void {
    if (!this.cardLayer || !this.backTex) return;
    if (this.flightCards.has(opts.card)) return;
    this.flightCards.add(opts.card);
    const tex = opts.faceUp && opts.card && !opts.card.startsWith("collect:")
      ? this.faceTexFor(opts.card)
      : this.backTex;
    const sprite = new Sprite(tex);
    sprite.anchor.set(0.5);
    sprite.scale.set(this.baseScale);
    sprite.zIndex = 80_000 + this.cardFlights.length;
    sprite.x = opts.from.x;
    sprite.y = opts.from.y;
    sprite.rotation = opts.from.rot ?? 0;
    this.cardLayer.addChild(sprite);
    // Карта уже могла появиться в руке схемой — прячем до приземления.
    if (opts.toSelf) {
      const hv = this.hand.find((c) => c.card === opts.card);
      if (hv) {
        hv.sprite.visible = false;
        hv.sprite.alpha = 0;
      }
    }
    if (opts.seatBiasId && opts.seatBias !== 0) {
      this.addSeatFlightBias(opts.seatBiasId, opts.seatBias);
    }
    this.cardFlights.push({
      sprite,
      card: opts.card,
      from: opts.from,
      to: opts.to,
      t: 0,
      delay: opts.delay,
      dur: anim.cardMove.dur / Math.max(0.5, this.profile.speed),
      lift: this.layout.cardH * anim.cardMove.lift,
      toSelf: opts.toSelf,
      seatBiasId: opts.seatBiasId,
      seatBias: opts.seatBias,
    });
    this.wake();
  }

  private addSeatFlightBias(seatId: string, delta: number): void {
    const next = (this.seatFlightBias.get(seatId) ?? 0) + delta;
    if (next === 0) this.seatFlightBias.delete(seatId);
    else this.seatFlightBias.set(seatId, next);
    this.drawSeats();
  }

  private seatVisualCount(seat: SeatView): number {
    return Math.max(0, seat.handCount + (this.seatFlightBias.get(seat.id) ?? 0));
  }

  private stepCardFlights(dt: number): void {
    if (this.cardFlights.length === 0) return;
    const live: typeof this.cardFlights = [];
    let landedSeat = false;
    for (const f of this.cardFlights) {
      f.t += dt;
      const p = (f.t - f.delay) / f.dur;
      if (p < 0) {
        live.push(f);
        continue;
      }
      if (p >= 1) {
        f.sprite.destroy();
        this.flightCards.delete(f.card);
        if (f.toSelf) {
          const hv = this.hand.find((c) => c.card === f.card);
          if (hv) {
            hv.sprite.visible = true;
            hv.sprite.alpha = 1;
          }
        }
        if (f.seatBiasId && f.seatBias !== 0) {
          this.addSeatFlightBias(f.seatBiasId, -f.seatBias);
          landedSeat = true;
        }
        continue;
      }
      const pose = cardFlightPose(p, f.from, f.to, f.lift);
      f.sprite.x = pose.x;
      f.sprite.y = pose.y;
      f.sprite.rotation = pose.rot;
      f.sprite.alpha = pose.alpha;
      live.push(f);
    }
    this.cardFlights = live;
    if (landedSeat) this.drawSeats();
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

  // Веер колоды: в dealMode — серверный deckFanned на столе; иначе — колода в hand-зоне.
  private fanned(): boolean {
    if (this.dealMode) return this.deckFanned && this.deckZone === "center";
    return this.deckZone === "hand";
  }

  // Веер руки «живой»: в dealMode — стопка Player.hand в фокусе; иначе — колода в руке.
  private fanOpen(): boolean {
    if (this.dealMode) return this.handFocused && this.hand.length > 0;
    return this.fanned() && this.handFocused && this.cards.length > 0;
  }

  private handRowMode(): boolean {
    return this.dealMode && this.handCount > 0 && !this.handFocused;
  }

  private dragMode(): DragMode {
    return dragModeFor({
      zone: this.deckZone,
      handFocused: this.handFocused,
      draggable: this.deckDraggable,
      dealMode: this.dealMode,
      canDeal: this.canDeal,
      deckFanned: this.deckFanned,
    });
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
      g.angleDeg,
      anim.fan.widthFactor,
    );
  }

  private insertHandIndexAt(x: number): number {
    const g = this.handFanGeom();
    return fanInsertIndex(
      x,
      g.anchor,
      g.width,
      Math.max(1, this.hand.length),
      g.angleDeg,
      anim.fan.widthFactor,
    );
  }

  private insertDeckIndexAt(x: number): number {
    const g = this.deckFanGeom();
    return fanInsertIndex(
      x,
      g.anchor,
      g.width,
      Math.max(1, this.deckCount),
      g.angleDeg,
      anim.fan.widthFactor,
    );
  }

  private inDeckFanArea(x: number, y: number): boolean {
    const z = this.layout.centerZone;
    if (Math.abs(x - z.cx) <= z.w / 2 && Math.abs(y - z.cy) <= z.h / 2) return true;
    const l = this.layout;
    const g = this.deckFanGeom();
    return fanBandContains(x, y, g.anchor, g.width, g.angleDeg, anim.fan.widthFactor, l.cardW, l.cardH, l.cardH * 0.5);
  }

  // Точка в области веера (полоса дуги ∪ прямоугольник зоны руки) — то же, что хит-зона:
  // отпустил здесь → карта переставляется в колоде, а не «уходит» в другую зону.
  private inFanArea(x: number, y: number): boolean {
    const z = this.layout.handZone;
    if (Math.abs(x - z.cx) <= z.w / 2 && Math.abs(y - z.cy) <= z.h / 2) return true;
    const l = this.layout;
    const g = this.dealMode ? this.handFanGeom() : this.fanGeom();
    return fanBandContains(x, y, g.anchor, g.width, g.angleDeg, anim.fan.widthFactor, l.cardW, l.cardH, l.cardH * 0.5);
  }

  // Удержание состоялось — карта под пальцем «прилипает» к нему и выходит из веера.
  private beginCardDrag(): void {
    const p = this.cardPress;
    if (!p) return;
    const fromHand = this.dealMode && this.handFocused && !this.dealDrag;
    const stack = fromHand ? this.hand : this.cards;
    if (stack.length === 0) return;
    const v = stack[Math.max(0, Math.min(stack.length - 1, p.index))]!;
    this.cardPress = null;
    this.poke = null;
    this.hoverTarget = 0;
    this.cardDrag = {
      id: p.id,
      v,
      insertAt: fromHand ? p.index : this.dealDrag ? p.index : this.insertIndexAt(p.x),
      x: p.x,
      y: p.y,
      fromHand,
      samples: [{ x: p.x, y: p.y, t: performance.now() }],
    };
    v.sprite.zIndex = 100_000;
    if (this.deckHit) this.deckHit.cursor = "grabbing";
    if (this.dealDrag) {
      // Стопка: остальные как n-1 на якоре. Веер: раступаются, оставляя дырку под картой.
      if (!this.deckFanned) {
        const left = this.cards.length - 1;
        this.cards.forEach((c, i) => {
          if (c === v) return;
          c.body.snapTo(this.stackRestTarget(i, left));
        });
        this.deckBodyCount = -1;
        this.drawDeckBody();
        v.body.setTarget({ x: p.x, y: p.y, rot: 0, scale: DRAG_SCALE });
      } else {
        this.applyCardDragTargets();
      }
      const seatHit = pickSeat(p.x, p.y, this.seatBoxes);
      this.setHoverSeat(seatHit && seatHit !== this.selfId ? seatHit : null);
      const to = pickDealTarget(p.x, p.y, this.seatBoxes, this.layout, this.selfId, this.dealReadyIds());
      this.hoverZone = to === this.selfId ? { zone: "hand" } : null;
      this.updateVisibility();
      this.drawSeats();
      this.drawZones();
    } else {
      this.hoverZone = pickDropTarget(p.x, p.y, this.layout);
      this.applyCardDragTargets();
      this.drawZones();
    }
    this.onDragChange?.(true);
    this.wake();
  }

  // Карта едет за пальцем (приподнята, ровно, крупнее), остальные раздвигаются, оставляя
  // ДЫРКУ на том слоте, куда она встанет — видно, между какими картами она ляжет.
  private applyCardDragTargets(): void {
    const d = this.cardDrag;
    if (!d) return;
    d.v.body.setTarget({ x: d.x, y: d.y, rot: 0, scale: DRAG_SCALE });
    const sp = anim.cardDrag.spread;
    // Драг руки трогает только this.hand — иначе колода в центре уезжает в нижний веер.
    const stack = d.fromHand ? this.hand : this.cards;
    const n = stack.length;
    // На просторном веере (мало карт) amp=0: только дырка слота. Иначе сосед улетает
    // за следующую карту (визуально 2_31 вместо превью 213).
    const amp = fanDragSpreadAmp(sp.amp, this.fanRevealScaleNow());
    const deckFan = this.dealDrag && this.deckFanned;
    let k = 0;
    for (const c of stack) {
      if (c === d.v) continue;
      const slot = k < d.insertAt ? k : k + 1; // пропускаем слот под перетаскиваемую карту
      // Плюс раскрытие вокруг точки вставки: соседи разъезжаются, и видно, между какими
      // именно картами ляжет перетаскиваемая (одной «дырки» в тесном веере не видно).
      // Раздвиг с прибитыми краями: у пивота шире, дальше плотнее, общая ширина та же.
      const spread = amp > 0 ? fanSpreadPinned(slot, n, d.insertAt, sp.cards, amp) : 0;
      const vi = Math.max(0, Math.min(n - 1, slot + spread));
      const t = d.fromHand
        ? this.handFanTarget(vi)
        : deckFan
          ? this.deckFanTarget(vi)
          : this.fanTarget(vi);
      c.body.setTarget({ x: t.x, y: t.y, rot: t.rot, scale: 1 });
      k++;
    }
  }

  private dropCard(x: number, y: number): void {
    const d = this.cardDrag;
    if (!d) return;
    const dealing = this.dealDrag;
    const fromHand = d.fromHand;
    this.cardDrag = null;
    this.dealDrag = false;
    this.skipNextTap = true;
    this.hoverZone = null;
    this.setHoverSeat(null);
    if (this.deckHit) this.deckHit.cursor = this.dealMode ? (this.canDeal ? "grab" : "pointer") : this.deckDraggable ? "grab" : "pointer";

    if (dealing) {
      const seatHit = pickSeat(x, y, this.seatBoxes);
      const readyIds = this.dealReadyIds();
      // Не готов — отбой «нииизя», карта не уходит.
      if (seatHit && seatHit !== this.selfId && !readyIds.has(seatHit)) {
        this.startCardReject(d.v, x, y, DEAL_DROP_REJECT_TEXT);
        this.onDragChange?.(false);
        this.drawSeats();
        this.drawZones();
        this.positionDeckHit();
        this.wake();
        return;
      }
      const seat = pickDealTarget(x, y, this.seatBoxes, this.layout, this.selfId, readyIds);
      if (seat) {
        const card = d.v.card;
        // Плавный полёт с пальца к месту; эхо card_moved этот же card пропустит.
        this.playDealFlight(
          card,
          { x: d.v.sprite.x, y: d.v.sprite.y, rot: d.v.sprite.rotation },
          seat,
        );
        this.onDealCard?.(card, seat);
        d.v.sprite.visible = false;
      } else if (this.deckFanned && this.inDeckFanArea(x, y)) {
        // Дроп обратно в веер колоды — перестановка, не возврат на родной слот.
        const to = this.insertDeckIndexAt(x);
        this.reorderLocally(d.v.card, to);
        this.alignUnderTouch(x, y);
        this.onCardReorder?.(d.v.card, to);
      } else {
        this.returnCardHome(d.v);
      }
      this.onDragChange?.(false);
      this.drawSeats();
      this.drawZones();
      this.positionDeckHit();
      this.wake();
      return;
    }

    if (this.inFanArea(x, y)) {
      // Отпустили над веером — карта меняет место; порядок уходит на сервер.
      const to = fromHand ? this.insertHandIndexAt(x) : this.insertIndexAt(x);
      if (fromHand) this.reorderHandLocally(d.v.card, to);
      else this.reorderLocally(d.v.card, to);
      this.alignUnderTouch(x, y); // положил карту — она и соседи легли ровно
      this.onCardReorder?.(d.v.card, to);
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

  private reorderHandLocally(card: string, to: number): void {
    const ids = this.hand.map((c) => c.card);
    const next = moveCard(ids, card, to);
    const byCard = new Map(this.hand.map((c) => [c.card, c]));
    const reordered = next.map((c) => byCard.get(c)).filter((c): c is CardVisual => !!c);
    if (reordered.length !== this.hand.length) return;
    this.handCards = next;
    this.hand = reordered;
    this.hand.forEach((c, i) => {
      c.sprite.zIndex = 2000 + i;
      c.body.setTarget(this.handRestTarget(i));
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
    const hi = this.hand.indexOf(v);
    if (hi >= 0) {
      v.sprite.zIndex = 2000 + hi;
      this.hand.forEach((c, j) => c.body.setTarget(this.handRestTarget(j)));
      this.updateVisibility();
      return;
    }
    const i = Math.max(0, this.cards.indexOf(v));
    v.sprite.zIndex = i;
    // После промаха раздачи — вся стопка снова как n карт на якоре.
    this.cards.forEach((c, j) => c.body.setTarget(this.restTarget(j)));
    this.deckBodyCount = -1;
    this.updateVisibility();
  }

  // Отбой одной карты: та же «ударная» механика, что и у колоды, но трясётся только она.
  private startCardReject(v: CardVisual, px: number, py: number, text: string = REJECT_TEXT): void {
    const hi = this.hand.indexOf(v);
    const home =
      hi >= 0
        ? this.handFanTarget(hi)
        : this.fanTarget(Math.max(0, this.cards.indexOf(v)));
    let dx = home.x! - px;
    let dy = home.y! - py;
    const len = Math.hypot(dx, dy) || 1;
    this.reject = { t: 0, dur: 0.5, dirX: dx / len, dirY: dy / len };
    this.rejectCard = v;
    if (this.rejectText) this.rejectText.text = text;
    v.body.setTarget({ x: px, y: py, scale: DRAG_SCALE, rot: 0 });
    this.wake();
  }

  // «Ударный» отскок: колода держится у точки удара и делает затухающие колебания
  // В СТОРОНУ ДОМА, затем возвращается. Надпись — REJECT_TEXT («низяяя»).
  private startReject(px: number, py: number): void {
    const a = this.activeAnchor();
    let dx = a.x - px;
    let dy = a.y - py;
    const len = Math.hypot(dx, dy);
    // Тап по самой колоде: направления к дому нет — трясём вверх.
    if (len < 1e-3) {
      dx = 0;
      dy = -1;
    } else {
      dx /= len;
      dy /= len;
    }
    this.reject = { t: 0, dur: 0.5, dirX: dx, dirY: dy };
    if (this.rejectText) this.rejectText.text = REJECT_TEXT;
    const zs = deckZoneScale(this.deckZone);
    for (let i = 0; i < this.cards.length; i++) {
      const so = stackOffset(i, this.cards.length, this.deckIsFaceUp());
      this.cards[i]!.body.setTarget({
        x: px + so.dx * zs,
        y: py + so.dy * zs,
        scale: DRAG_SCALE * zs,
        rot: this.restJitter[i] ?? 0,
      });
    }
    this.wake();
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

  // Зоны видны ВСЕГДА, но по-разному. В покое — еле заметные очертания и подпись, что это
  // за зона: игрок понимает разметку стола, не отвлекаясь на неё. Во время драга зоны
  // заливаются оверлеем, а подпись меняется на ДЕЙСТВИЕ — что будет, если бросить сюда.
  private drawZones(): void {
    const g = this.zoneLayer;
    if (!g) return;
    g.clear();
    const dragging = this.dragging || !!this.cardDrag;
    const dragged: DraggedKind = this.cardDrag ? "card" : "deck";
    const regions = dropZoneRegions(this.layout);
    const myReady = this.selfDealReady();
    (Object.keys(regions) as DropZone[]).forEach((z) => {
      const { rect } = regions[z];
      const label = this.zoneLabels[z];
      if (rect.w <= 0 || rect.h <= 0) {
        if (label) label.visible = false;
        return;
      }
      const active = dragging && this.hoverZone?.zone === z;
      // В раздаче полоса руки: готов → жёлтая, не готов → серая (дилер всегда жёлтый).
      const base = this.dealMode && z === "hand" ? dealHandAccent(myReady) : 0xd9b154;
      const hot = 0xffe9a8;
      const x = rect.cx - rect.w / 2;
      const y = rect.cy - rect.h / 2;
      const dealHand = this.dealMode && z === "hand";

      if (active && dealHand) {
        // Ховер раздачи: плотный оверлей. Idle — без заливки, только тихая рамка.
        g.roundRect(x, y, rect.w, rect.h, rect.r).fill({ color: base, alpha: 0.82 });
      } else if (active) g.roundRect(x, y, rect.w, rect.h, rect.r).fill({ color: 0xffe08a, alpha: 0.16 });
      else if (dragging) g.roundRect(x, y, rect.w, rect.h, rect.r).fill({ color: base, alpha: 0.06 });

      g.roundRect(x, y, rect.w, rect.h, rect.r).stroke({
        width: active ? 5 : dragging ? 2.5 : 1.5,
        color: active ? hot : base,
        alpha: active ? 0.95 : dragging ? 0.4 : dealHand ? 0.18 : 0.16,
      });

      if (label) {
        if (active && dealHand) label.text = dealSeatHoverLabel(true); // себе всегда можно
        else if (dragging) label.text = zoneAction(z, dragged);
        else label.text = zoneTitle(z);
        label.x = rect.cx;
        label.y = rect.cy;
        label.visible = true;
        label.tint = active && dealHand ? 0x1a1f1c : active ? hot : base;
        label.alpha = active ? (dealHand ? 0.95 : 0.75) : dragging ? 0.35 : dealHand ? 0.12 : 0.14;
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
      // Подпись не должна вылезать за свою зону — ужимаем по её ширине.
      const rect = regions[z].rect;
      // Считаем по САМОЙ ДЛИННОЙ подписи зоны: во время драга текст меняется на действие,
      // и размер шрифта не должен из-за этого прыгать.
      const longest = Math.max(zoneTitle(z).length, zoneAction(z, "deck").length, zoneAction(z, "card").length);
      const fit = (rect.w * 0.9) / Math.max(1, longest * 0.62);
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
    this.tapStartedOnDeck = false; // тап дошёл до колоды — метка отработала
    if (this.skipNextTap) {
      this.skipNextTap = false; // после драга верхней карты тап не открывает веер
      return;
    }
    // Одинарный тап по колоде в центре — раскрыть веер. Сворачивает стрелка.
    // Selection нет; старт драга выставляет skipNextTap и отменяет открытие.
    if (this.dealMode && this.deckZone === "center") {
      this.dealDrag = false; // тап открытия — не раздача
      if (forbidDeckOpenTap(this.dealMode, this.canDeal, this.deckFanned)) {
        // Не-дилер тыкает закрытую колоду «открыть» — удар + «низяяя».
        const a = this.layout.deckAnchor;
        this.startReject(a.x, a.y);
        return;
      }
      if (this.canDeal && !this.deckFanned) {
        this.onDeckFanChange?.(true); // рука при этом остаётся как была
      } else if (this.deckFanned && e.pointerType !== "mouse") {
        this.pokeDeckFan(e.global.x); // тач: тык раздвигает веер колоды (и для не-дилера)
      }
      return;
    }
    this.onDeckTap?.(DECK_ID);
    if (!this.deckDraggable) return;
    this.alignUnderTouch(e.global.x, e.global.y);
    if (this.fanOpen() && e.pointerType !== "mouse") {
      this.pokeDeckFan(e.global.x);
    }
  }

  private onHandDown(e: FederatedPointerEvent): void {
    if (!this.dealMode || this.hand.length === 0) return;
    this.tapStartedOnDeck = true;
    this.skipNextTap = false;
    if (!this.handFocused) return; // сложенная рука — только тап (выделение), без драга карт
    if (this.cardPress || this.cardDrag) return;
    const index = this.nearestHandFanIndex(e.global.x);
    this.dealDrag = false;
    this.cardPress = {
      id: e.pointerId,
      startX: e.global.x,
      startY: e.global.y,
      x: e.global.x,
      y: e.global.y,
      index,
      canGrab: true,
      fromHand: true,
      samples: [{ x: e.global.x, y: e.global.y, t: performance.now() }],
    };
    this.wake();
  }

  private handleHandTap(e: FederatedPointerEvent): void {
    this.tapStartedOnDeck = false;
    if (this.skipNextTap) {
      this.skipNextTap = false;
      return;
    }
    // Тап по руке выделяет HAND_ID (фокус → веер). Колоду на столе не трогаем.
    this.onDeckTap?.(HAND_ID);
  }

  private nearestHandFanIndex(x: number): number {
    if (this.hand.length === 0) return 0;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < this.hand.length; i++) {
      const d = Math.abs(this.hand[i]!.sprite.x - x);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  private positionHandHit(): void {
    if (!this.handHit) return;
    if (!this.dealMode || this.handCount === 0) {
      this.handHit.hitArea = new Rectangle(0, 0, 0, 0);
      this.handHit.eventMode = "none";
      return;
    }
    this.handHit.eventMode = "static";
    const z = this.layout.handZone;
    if (this.handFocused) {
      const l = this.layout;
      const pad = l.cardW * 0.25;
      const g = this.handFanGeom();
      this.handHit.hitArea = {
        contains: (x: number, y: number) =>
          (Math.abs(x - z.cx) <= z.w / 2 && Math.abs(y - z.cy) <= z.h / 2) ||
          fanBandContains(x, y, g.anchor, g.width, g.angleDeg, anim.fan.widthFactor, l.cardW, l.cardH, pad),
      };
    } else {
      this.handHit.hitArea = new Rectangle(z.cx - z.w / 2, z.cy - z.h / 2, z.w, z.h);
    }
  }

  private positionDeckHit(): void {
    if (!this.deckHit) return;
    // Веер колоды на столе (dealMode) или веер колоды-в-руке (legacy).
    if (this.dealMode && this.deckFanned) {
      const z = this.layout.centerZone;
      const l = this.layout;
      const pad = l.cardW * 0.25;
      const g = this.deckFanGeom();
      this.deckHit.hitArea = {
        contains: (x: number, y: number) =>
          (Math.abs(x - z.cx) <= z.w / 2 && Math.abs(y - z.cy) <= z.h / 2) ||
          fanBandContains(x, y, g.anchor, g.width, g.angleDeg, anim.fan.widthFactor, l.cardW, l.cardH, pad),
      };
      return;
    }
    if (this.fanned() && !this.dealMode) {
      const z = this.layout.handZone;
      const l = this.layout;
      const pad = l.cardW * 0.25;
      this.deckHit.hitArea = {
        contains: (x: number, y: number) =>
          (Math.abs(x - z.cx) <= z.w / 2 && Math.abs(y - z.cy) <= z.h / 2) ||
          fanBandContains(x, y, this.fanGeom().anchor, this.fanGeom().width, this.fanGeom().angleDeg, anim.fan.widthFactor, l.cardW, l.cardH, pad),
      };
      return;
    }
    const a = this.dealMode ? this.layout.deckAnchor : this.activeAnchor();
    const zs = deckZoneScale(this.dealMode ? "center" : this.deckZone);
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
    // Раздача со стопки: кирпич остаётся; с открытого веера — карты веера остаются на местах.
    if (this.dealDrag && this.cardDrag && !this.deckFanned) return false;
    return (
      this.fanned() ||
      this.deckFanned ||
      !!this.shuffleAnim ||
      !!this.scrambleAnim ||
      !!this.cardDrag ||
      !!this.splashAnim
    );
  }

  private updateVisibility(): void {
    const away = this.deckZone === "away";
    const detailed = this.detailedCards();
    if (this.rowMode()) {
      const n = this.cards.length;
      for (let i = 0; i < n; i++) this.cards[i]!.sprite.zIndex = n - i;
    }
    const n = this.cards.length;
    const dealing = this.dealDrag && !!this.cardDrag;
    if (dealing && n >= 1 && !this.deckFanned) {
      const dragged = n - 1;
      const stackTop = n >= 2 ? n - 2 : -1;
      for (let i = 0; i < n; i++) {
        this.cards[i]!.sprite.visible = !away && (i === dragged || i === stackTop || i === 0);
      }
      if (this.deckBody) this.deckBody.visible = !away && n > 3;
      if (this.deckShadow) {
        this.deckShadow.visible = !away && this.profile.shadows && n > 1;
      }
      return;
    }
    const top = n - 1;
    for (let i = 0; i < n; i++) {
      this.cards[i]!.sprite.visible = !away && (detailed || i === top || i === 0);
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
    // Во время раздачи кирпич рисуем по оставшейся стопке (без тащимой верхней).
    const dealing = this.dealDrag && !!this.cardDrag;
    const n = dealing ? Math.max(0, this.cards.length - 1) : this.cards.length;
    if (n < 3) return;
    const w = this.layout.cardW;
    const h = this.layout.cardH;
    const r = Math.max(3, w * 0.1);
    const mirrored = this.deckIsFaceUp();
    const top = stackOffset(n - 1, n, mirrored);
    const bg = cardBackSkin(this.cardBack).bg;
    const back = stackOffset(0, n, mirrored);
    g.roundRect(back.dx - top.dx - w / 2, back.dy - top.dy - h / 2, w, h, r)
      .fill({ color: bg })
      .stroke({ width: 1.5, color: CARD_EDGE.side });

    for (const i of stackStripeIndices(n, anim.deck.stripeSpacing).filter((i) => i > 0)) {
      const so = stackOffset(i, n, mirrored);
      const x = so.dx - top.dx - w / 2;
      const y = so.dy - top.dy - h / 2;
      g.roundRect(x, y, w, h, r).fill({ color: bg });
      g.moveTo(x + 0.75, y + r)
        .lineTo(x + 0.75, y + h - r)
        .stroke({ width: 1.5, color: CARD_EDGE.side });
      g.moveTo(x + r, y + h - 0.75)
        .lineTo(x + w - r, y + h - 0.75)
        .stroke({ width: 1.5, color: CARD_EDGE.bottom });
    }
    this.deckBodyCount = n;
  }

  // Блок едет за верхней картой стопки. Во время раздачи — за НОВЫМ верхом (без тащимой).
  private syncDeckBody(): void {
    const g = this.deckBody;
    if (!g || !g.visible) return;
    const dealing = this.dealDrag && !!this.cardDrag;
    const top = dealing && this.cards.length >= 2
      ? this.cards[this.cards.length - 2]!
      : this.cards[this.cards.length - 1];
    if (!top) return;
    const visualCount = dealing ? this.cards.length - 1 : this.cards.length;
    if (this.deckBodyCount !== visualCount) this.drawDeckBody();
    if (this.flipAnim && this.flipMap.has(top)) {
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
    this.rebuildLayout();
    this.baseScale = this.layout.cardH / TEX_H;
    if (this.destroyed || !this.app) return;
    this.app.renderer.resize(this.w, this.h);
    this.app.stage.hitArea = new Rectangle(0, 0, this.w, this.h);
    this.buildTable();
    // при ресайзе не анимируем — телепортируем стопку к новому якорю
    this.cards.forEach((c, i) => c.body.snapTo(this.restTarget(i)));
    this.cards.forEach((c) => this.syncVisual(c));
    this.hand.forEach((c, i) => c.body.snapTo(this.handRestTarget(i)));
    this.hand.forEach((c) => this.syncVisual(c));
    this.drawDeckBody(); // размер карты изменился — блок перерисовываем целиком
    this.syncDeckBody();
    this.syncDeckShadow();
    this.positionDeckHit();
    this.positionHandHit();
    this.syncCollapseButton();
    this.syncHandCounter();
    this.syncDeckCounter();
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
    for (const f of this.cardFlights) f.sprite.destroy();
    this.cardFlights = [];
    this.flightCards.clear();
    this.seatFlightBias.clear();
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
    this.seatHandNodes = [];
    this.seatLayer = null;
    this.seatG = null;
    this.focusG = null;
    this.collapseBtn = null;
    this.deckCollapseBtn = null;
    this.handCounter = null;
    this.deckCounter = null;
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
    this.handHit = null;
    this.onDeckDrop = null;
    this.onDealCard = null;
    this.onDeckFanChange = null;
    this.onDragChange = null;
    this.reject = null;
    this.cards = [];
    this.hand = [];
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
      this.stepCardFlights(dt);

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
      for (const c of this.hand) c.body.step(dt);
    } while (remaining > 0);

    const frameDt = Math.min(ticker.deltaMS / 1000, 0.05);
    if (this.idleRunning()) this.idleT += frameDt;

    // Сглаживаем огибающую ховера всегда (чтобы плавно гасла после увода курсора).
    this.hoverEnv += (this.hoverTarget - this.hoverEnv) * Math.min(1, frameDt * 12);
    if (this.hoverTarget === 0 && this.hoverEnv < 0.002) this.hoverEnv = 0;

    // «Червячок» тесного веера + локальное раскрытие (тык/ховер).
    // На просторном веере ховер/тык не включаем — иначе при 2–3 картах средняя колбасится.
    const live = this.liveFan();
    const wantsReveal = this.poke !== null || this.hoverTarget === 1 || this.hoverEnv > 0.001;
    const wiggle =
      live !== null &&
      (this.fanCrowd() > 0 || (wantsReveal && this.fanRevealScaleNow() > 0.001));
    if (wiggle && live) {
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
        const follow = this.cardPress ? w.poke.followDrag : w.poke.follow;
        this.poke.index += (this.poke.target - this.poke.index) * Math.min(1, frameDt * follow);
        if (pokeEnvelope(this.poke.t, w.poke.in, w.poke.hold, w.poke.out) <= 0 && this.poke.t > w.poke.in) {
          this.poke = null;
        }
      }
      this.applyFanWave(live);
    } else if (this.fanWiggling) {
      // эффект закончился — ровные веера (оба могут быть открыты)
      this.cards.forEach((c, i) => c.body.setTarget(this.restTarget(i)));
      if (this.dealMode) this.hand.forEach((c, i) => c.body.setTarget(this.handRestTarget(i)));
      this.fanCrowdNow = 0;
      this.poke = null;
      this.hoverTarget = 0;
      this.hoverEnv = 0;
    }
    this.fanWiggling = wiggle;

    if (this.cardDrag && (!this.dealDrag || this.deckFanned)) this.applyCardDragTargets();
    if (this.cardDrag && this.dealDrag && !this.deckFanned) {
      // Стопка: только верхняя карта за пальцем; кирпич не трогаем.
      this.cardDrag.v.body.setTarget({
        x: this.cardDrag.x,
        y: this.cardDrag.y,
        rot: 0,
        scale: DRAG_SCALE,
      });
    }

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
    this.syncCollapseButton();
    this.stepCollapseReveal(frameDt);
    this.syncHandCounter();
    this.syncDeckCounter();
    for (const c of this.cards) if (c.sprite.visible) this.syncVisual(c);
    for (const c of this.hand) if (c.sprite.visible) this.syncVisual(c);
    this.syncDeckBody();
    this.syncDeckShadow();
    this.syncCardShadow();
    this.syncRejectText();

    // Всё осело, нет растасовки/драга/отбоя И нет живой idle → усыпляем цикл. При
    // включённой idle-анимации цикл не спит (карты постоянно чуть «дышат»).
    const collapseBusy = this.collapseReveal !== (this.collapseWantShow ? 1 : 0);
    if (
      !this.shuffleAnim &&
      !this.scrambleAnim &&
      !this.splashAnim &&
      this.cardFlights.length === 0 &&
      !this.pendingShuffle &&
      !this.flipAnim &&
      !this.stretchAnim &&
      !this.notice &&
      !this.press &&
      !this.cardPress &&
      !this.cardDrag &&
      !this.reject &&
      !collapseBusy &&
      !this.idleRunning() &&
      !this.fanWiggling &&

      this.cards.every((c) => c.body.isResting()) &&
      this.hand.every((c) => c.body.isResting())
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
      if (this.handFocused) {
        rot += this.fanCrowdNow * this.fanEnergy * w.jitterRotAmp * Math.sin(this.fanJitterPhase + c.phase);
      }
    }

    // Тряска отбоя: общая для колоды, но если отбивается ОДНА карта — трясётся только она.
    const sh = !this.rejectCard || this.rejectCard === c ? this.shake : ZERO_SHAKE;
    const x = c.body.px + sh.dx + this.stretch.dx;
    const y = c.body.py + sh.dy + this.stretch.dy;

    c.sprite.tint = 0xffffff;

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
    // Пул по id: при дубликатах в старом this.cards Map оставлял бы лишние спрайты.
    const pool = new Map<string, CardVisual[]>();
    for (const c of this.cards) {
      const key = c.card || "";
      const bucket = pool.get(key);
      if (bucket) bucket.push(c);
      else pool.set(key, [c]);
    }

    const next: CardVisual[] = [];
    for (let j = 0; j < newOrder.length; j++) {
      const card = newOrder[j]!;
      const bucket = pool.get(card);
      let v = bucket?.pop();
      if (v) {
        // переиспользуем — СТАРЫЙ zIndex сохраняем (растасовка сменит в апексе)
      } else {
        v = this.createCardVisual(card);
        v.body.snapTo(this.restTarget(j)); // новая карта появляется сразу на месте
        v.sprite.zIndex = j;
      }
      v.card = card;
      v.phase = j * anim.idle.phaseStep;
      next.push(v);
    }
    for (const bucket of pool.values()) {
      for (const leftover of bucket) leftover.sprite.destroy(); // раздали/убрали/дубликаты
    }
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
    const openHands = this.seats.filter((s) => s.handOpen || s.handFanned).flatMap((s) => s.hand);
    const queue = [...this.deckCards, ...this.handCards, ...openHands].filter(
      (c) => !this.faceCache.has(`${c}|${this.fourColor ? 1 : 0}`),
    );
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

  // Стрелки «сложить»: рука — всем; колода — только дилеру. Могут быть обе сразу.
  private syncCollapseButton(): void {
    const cardH = this.layout.cardH;
    const handFan = this.dealMode
      ? this.handFocused && this.hand.length > 0
      : this.fanned() && this.handFocused && this.cards.length > 0;
    // Стрелка колоды: только дилер, независимо от фокуса руки.
    const deckFanBtn = this.dealMode && this.canDeal && this.deckFanned && this.cards.length > 0;
    this.collapseWantShow = handFan;
    this.deckCollapseWantShow = deckFanBtn;

    if (handFan && this.collapseBtn) {
      const z = this.layout.handZone;
      const fan = this.dealMode ? this.handFanGeom() : this.fanGeom();
      const fit = fitCollapseButton({
        cx: z.cx,
        cardBottomY: collapseAnchorBottom(fan.anchor.y - cardH / 2, cardH),
        minR: Math.max(14, cardH * 0.24),
        maxR: cardH * anim.fan.collapse.hitRatio,
        obstacles: [],
      });
      this.collapseLayout = { x: fit.x, y: fit.y, r: fit.r };
      this.paintCollapseArrow(this.collapseBtn, fit.r);
    }

    if (deckFanBtn && this.deckCollapseBtn) {
      const z = this.layout.centerZone;
      const fan = this.deckFanGeom();
      const fit = fitCollapseButton({
        cx: z.cx,
        cardBottomY: collapseAnchorBottom(fan.anchor.y - cardH / 2, cardH),
        minR: Math.max(14, cardH * 0.24),
        maxR: cardH * anim.fan.collapse.hitRatio,
        obstacles: [],
      });
      this.deckCollapseLayout = { x: fit.x, y: fit.y, r: fit.r };
      this.paintCollapseArrow(this.deckCollapseBtn, fit.r);
    }

    this.applyCollapseReveal();
  }

  private paintCollapseArrow(btn: Container, hitR: number): void {
    const visR = hitR * anim.fan.collapse.visualRatio;
    const g = btn.children[0] as Graphics;
    g.clear();
    g.circle(0, 0, visR).fill({ color: 0x14281c, alpha: 0.72 }).stroke({ width: 3, color: 0xd9b154, alpha: 0.65 });
    g.poly([-visR * 0.44, -visR * 0.16, visR * 0.44, -visR * 0.16, 0, visR * 0.42]).fill({
      color: 0xd9b154,
      alpha: 0.95,
    });
    btn.hitArea = new Circle(0, 0, hitR);
  }

  private stepCollapseReveal(dt: number): void {
    const dur = Math.max(0.05, anim.fan.collapse.reveal.dur / Math.max(1, this.profile.speed));
    const step = dt / dur;
    const handT = this.collapseWantShow ? 1 : 0;
    const deckT = this.deckCollapseWantShow ? 1 : 0;
    let changed = false;
    if (this.collapseReveal !== handT) {
      this.collapseReveal = handT > this.collapseReveal
        ? Math.min(1, this.collapseReveal + step)
        : Math.max(0, this.collapseReveal - step);
      changed = true;
    }
    if (this.deckCollapseReveal !== deckT) {
      this.deckCollapseReveal = deckT > this.deckCollapseReveal
        ? Math.min(1, this.deckCollapseReveal + step)
        : Math.max(0, this.deckCollapseReveal - step);
      changed = true;
    }
    if (changed) this.applyCollapseReveal();
  }

  private applyCollapseReveal(): void {
    this.applyOneCollapseReveal(this.collapseBtn, this.collapseLayout, this.collapseReveal, this.collapseWantShow);
    this.applyOneCollapseReveal(
      this.deckCollapseBtn,
      this.deckCollapseLayout,
      this.deckCollapseReveal,
      this.deckCollapseWantShow,
    );
  }

  private applyOneCollapseReveal(
    btn: Container | null,
    layout: { x: number; y: number; r: number } | null,
    reveal: number,
    wantShow: boolean,
  ): void {
    if (!btn) return;
    if (!layout || (reveal <= 0 && !wantShow)) {
      btn.visible = false;
      btn.alpha = 0;
      btn.eventMode = "none";
      return;
    }
    const slide = this.layout.cardH * anim.fan.collapse.reveal.slide;
    const pose = collapseRevealPose(reveal, layout.y, slide);
    btn.visible = true;
    btn.x = layout.x;
    btn.y = pose.y;
    btn.alpha = pose.alpha;
    btn.eventMode = reveal > 0.85 ? "static" : "none";
  }

  private rowMode(): boolean {
    // Именно !handFocused, а НЕ !detailedCards(): «детальный» режим включён всегда, пока
    // колода в руке (карты рисуются поштучно), и через него проверка обратного порядка
    // не срабатывала ни разу. Порядок наложения переворачиваем только в покое —
    // во время растасовки, выплеска и драга карты порядок должен быть обычным.
    return (
      this.fanned() &&
      !this.handFocused &&
      !this.shuffleAnim &&
      !this.scrambleAnim &&
      !this.splashAnim &&
      !this.cardDrag
    );
  }

  private restTarget(i: number): CardTargets {
    // dealMode: колода только в центре (стопка или веер на столе). Рука — отдельно.
    if (this.dealMode) {
      if (this.deckFanned) return this.deckFanTarget(i);
      return this.stackRestTarget(i, this.cards.length);
    }
    // Legacy: колода в hand-зоне → шеренга/веер.
    if (this.fanned()) return this.handFocused ? this.fanTarget(i) : this.rowTarget(i, this.deckCount);
    const a = this.activeAnchor();
    const zs = deckZoneScale(this.deckZone);
    const so = stackOffset(i, this.cards.length, this.deckIsFaceUp());
    return { x: a.x + so.dx * zs, y: a.y + so.dy * zs, rot: this.restJitter[i] ?? 0, scale: zs };
  }

  // Стопка в центре: count — сколько карт сейчас «лежат» в кирпиче (при драге верхней — n-1).
  private stackRestTarget(i: number, count: number): CardTargets {
    const a = this.layout.deckAnchor;
    const zs = deckZoneScale("center");
    const n = Math.max(1, count);
    const so = stackOffset(i, n, this.deckIsFaceUp());
    return { x: a.x + so.dx * zs, y: a.y + so.dy * zs, rot: this.restJitter[i] ?? 0, scale: zs };
  }

  private handRestTarget(i: number): CardTargets {
    if (this.handFocused) return this.handFanTarget(i);
    return this.rowTarget(i, this.handCount);
  }

  // Шеренга сложенной руки: первая карта стоит открыто, остальные — плотной пачкой.
  private rowTarget(i: number, count = this.deckCount): CardTargets {
    const z = this.layout.handZone;
    const cardW = this.layout.cardW;
    const maxW = Math.max(cardW, z.w * anim.fan.idle.widthScale);
    const n = Math.max(1, count);
    const offsets = rowOffsets(n, cardW, maxW);
    const width = rowWidth(n, cardW, maxW);
    const left = z.cx - width / 2;
    const x = left + (offsets[Math.max(0, Math.min(offsets.length - 1, i))] ?? 0) + cardW / 2;
    return { x, y: this.rowCardsY(), rot: 0, scale: 1 };
  }

  private rowCardsY(): number {
    const z = this.layout.handZone;
    return z.cy + z.h / 2 - this.rowCounterSpace() - this.layout.cardH / 2;
  }

  private rowCounterSpace(): number {
    return Math.max(14, this.layout.cardH * 0.32);
  }

  private syncHandCounter(): void {
    const t = this.handCounter;
    if (!t) return;
    const show = this.dealMode
      ? this.handRowMode()
      : this.rowMode() && this.deckZone !== "away" && this.deckCount > 0;
    t.visible = show;
    if (!show) return;
    const z = this.layout.handZone;
    t.text = String(this.dealMode ? this.handCount : this.deckCount);
    t.style.fontSize = Math.max(11, Math.min(28, this.rowCounterSpace() * 0.85));
    t.style.fill = 0xd9b154;
    t.x = z.cx;
    t.y = this.rowCardsY() + this.layout.cardH / 2 + this.rowCounterSpace() * 0.5;
  }

  // Счётчик под колодой. Не зависит от стрелки (она то есть, то нет — из‑за неё и прыгал).
  // Одна формула от якоря стопки — и в веере, и в кирпиче.
  private syncDeckCounter(): void {
    const t = this.deckCounter;
    if (!t) return;
    const show = this.deckZone === "center" && this.deckCount > 0;
    t.visible = show;
    if (!show) return;
    t.text = String(this.deckCount);
    t.style.fontSize = Math.max(11, Math.min(28, this.rowCounterSpace() * 0.85));
    const a = this.layout.deckAnchor;
    const zs = deckZoneScale("center");
    const ext = stackExtent(this.deckCount);
    t.x = a.x;
    t.y = a.y + (this.layout.cardH / 2) * zs + ext.h * zs + this.rowCounterSpace() * 0.45;
  }

  // Только для веера РУКИ (полоса снизу): якорь у верха зоны, провис и кнопка — вниз.
  // Колода в центре — layoutDeckFan / deckFanGeom, якорь = deckAnchor.
  private fanGeomFor(
    zone: { cx: number; cy: number; w: number; h: number },
    focused: boolean,
  ): { anchor: { x: number; y: number }; width: number; angleDeg: number } {
    const cardH = this.layout.cardH;
    const anchor = { x: zone.cx, y: zone.cy - zone.h / 2 + cardH * 0.55 };
    const angleDeg = focused ? anim.fan.maxAngleDeg : anim.fan.maxAngleDeg * anim.fan.idle.angleScale;
    const maxA = (angleDeg * Math.PI) / 180;
    const reserved = cardH * 2 * anim.fan.collapse.hitRatio;
    const sagMax = Math.max(1, zone.h - cardH * 1.15 - reserved);
    const byHeight = maxA > 0 ? (2 * sagMax * Math.sin(maxA)) / (1 - Math.cos(maxA)) : Infinity;
    const fit = Math.min(zone.w, byHeight / anim.fan.widthFactor);
    const width = focused ? fit : fit * anim.fan.idle.widthScale;
    return { anchor, width, angleDeg };
  }

  // Геометрия веера в руке (legacy колода-в-руке или Player.hand).
  private fanGeom(): { anchor: { x: number; y: number }; width: number; angleDeg: number } {
    const g = this.fanGeomFor(this.layout.handZone, this.handFocused);
    const count = this.dealMode ? this.handCount : this.deckCount;
    return this.clampHandFanGeom(g, count);
  }

  private handFanGeom(): { anchor: { x: number; y: number }; width: number; angleDeg: number } {
    return this.clampHandFanGeom(this.fanGeomFor(this.layout.handZone, true), this.handCount);
  }

  // Нижний веер: при малом числе карт не растягивать шаг на всю полосу и не гнуть
  // крайние на полный maxAngleDeg (две карты — почти плоско).
  private clampHandFanGeom(
    g: { anchor: { x: number; y: number }; width: number; angleDeg: number },
    count: number,
  ): { anchor: { x: number; y: number }; width: number; angleDeg: number } {
    const draggingHand = !!this.cardDrag && (this.cardDrag.fromHand || (!this.dealMode && !this.dealDrag));
    const maxStep = draggingHand ? anim.fan.maxStepDrag : anim.fan.maxStepIdle;
    return {
      ...g,
      width: clampFanWidth(g.width, count, this.layout.cardW, anim.fan.widthFactor, maxStep),
      angleDeg: fanMaxAngleDeg(count, g.angleDeg, anim.fan.maxStepAngleDeg),
    };
  }

  // Веер колоды в центре: якорь = якорь стопки (рядом со счётчиком).
  // НЕ fanGeomFor(centerZone) — та формула для руки (якорь у верха полосы), от неё веер
  // улетал на «вышку» при открытии.
  private deckFanGeom(): { anchor: { x: number; y: number }; width: number; angleDeg: number } {
    return layoutDeckFan({
      stackAnchor: this.layout.deckAnchor,
      zone: this.layout.centerZone,
      count: this.deckCount,
      cardW: this.layout.cardW,
      cardH: this.layout.cardH,
      reservedBelow: this.rowCounterSpace() + this.layout.cardH * 2 * anim.fan.collapse.hitRatio,
    });
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
      g.angleDeg,
      anim.fan.widthFactor,
    );
    return { x: c.x, y: c.y, rot: c.rot, scale: 1 };
  }

  private handFanTarget(i: number): CardTargets {
    const g = this.handFanGeom();
    const c = fanCard(i, Math.max(1, this.handCount), g.anchor, g.width, g.angleDeg, anim.fan.widthFactor);
    return { x: c.x, y: c.y, rot: c.rot, scale: 1 };
  }

  private deckFanTarget(i: number): CardTargets {
    const g = this.deckFanGeom();
    const c = fanCard(i, Math.max(1, this.deckCount), g.anchor, g.width, g.angleDeg, anim.fan.widthFactor);
    return { x: c.x, y: c.y, rot: c.rot, scale: 1 };
  }

  private reconcileHandByIdentity(newOrder: string[]): void {
    const byCard = new Map<string, CardVisual>();
    for (const c of this.hand) if (c.card) byCard.set(c.card, c);
    const next: CardVisual[] = [];
    for (let j = 0; j < newOrder.length; j++) {
      const card = newOrder[j]!;
      let v = byCard.get(card);
      if (v) byCard.delete(card);
      else {
        v = this.createCardVisual(card);
        v.body.snapTo(this.handRestTarget(j));
        // Ещё летит в руку — не вспыхивать на месте до приземления призрака.
        if (this.flightCards.has(card)) {
          v.sprite.visible = false;
          v.sprite.alpha = 0;
        }
      }
      v.card = card;
      v.phase = j * anim.idle.phaseStep;
      next.push(v);
    }
    for (const leftover of byCard.values()) leftover.sprite.destroy();
    this.hand = next;
  }

  private faceTexture(card: string): Texture {
    return this.faceTexFor(card);
  }

  // Какой веер сейчас «живой» для ховера/волны. Колода и рука могут быть открыты вместе:
  // приоритет у того, над которым палец/мышь (deckPointer / press по колоде).
  private liveFan(): "deck" | "hand" | "legacy" | null {
    if (this.shuffleAnim || this.scrambleAnim || this.splashAnim || this.press || this.cardDrag) {
      return null;
    }
    if (this.dealMode) {
      const handLive = this.handFocused && this.hand.length > 1;
      // dealDrag без cardDrag — ещё не драг; ховер/peek веера колоды не глушим.
      const deckLive = this.deckFanned && this.deckCount > 1 && !(this.dealDrag && this.cardDrag);
      const onDeck = this.deckPointer || (!!this.cardPress && !this.cardPress.fromHand);
      if (deckLive && onDeck) return "deck";
      if (handLive) return "hand";
      if (deckLive) return "deck";
      return null;
    }
    if (this.fanned() && this.handFocused && this.deckCount > 1) return "legacy";
    return null;
  }

  // Теснота текущего живого веера (0..1).
  private fanCrowd(): number {
    const w = anim.fan.wiggle;
    const live = this.liveFan();
    if (live === "hand") {
      return fanCrowd(this.handCount, this.handFanGeom().width, this.layout.cardW, anim.fan.widthFactor, w.gap, w.ramp);
    }
    if (live === "deck") {
      return fanCrowd(this.deckCount, this.deckFanGeom().width, this.layout.cardW, anim.fan.widthFactor, w.gap, w.ramp);
    }
    return fanCrowd(this.deckCount, this.fanGeom().width, this.layout.cardW, anim.fan.widthFactor, w.gap, w.ramp);
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

  // Тык по вееру колоды: даже если рука тоже открыта — волна идёт по колоде.
  private pokeDeckFan(x: number): void {
    if (!this.deckFanned || this.deckCount < 2) return;
    this.deckPointer = true;
    const p = anim.fan.wiggle.poke;
    const pi = this.nearestFanIndex(x);
    if (this.poke && Math.abs(pi - this.poke.target) <= p.cards) {
      this.poke.target = pi;
      this.poke.t = Math.min(this.poke.t, p.in);
      this.wake();
      return;
    }
    this.poke = { index: pi, target: pi, t: 0 };
    this.reKickWaveAt(pi, this.cards.length);
    this.wake();
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
    this.deckPointer = true; // при двух веерах волна остаётся на колоде
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

  // Ховер мышью над веером колоды в центре (или legacy-веер колоды в руке).
  private onDeckHover(e: FederatedPointerEvent): void {
    if (e.pointerType !== "mouse" || this.press) return;
    if (!(this.dealMode ? this.deckFanned : this.fanned()) || this.deckCount < 2) {
      this.deckPointer = false;
      return;
    }
    this.deckPointer = true;
    const idx = this.nearestFanIndex(e.global.x);
    if (this.hoverTarget === 0 || this.liveFan() !== "deck") this.reKickWaveAt(idx, this.cards.length);
    this.hoverIndex = idx;
    this.hoverTarget = 1;
    this.wake();
  }

  private onDeckHoverOut(e: FederatedPointerEvent): void {
    if (e.pointerType && e.pointerType !== "mouse") return;
    this.deckPointer = false;
    if (this.liveFan() === "hand") return; // ховер руки гасит свой out
    this.hoverTarget = 0;
    this.wake();
  }

  private onHandHover(e: FederatedPointerEvent): void {
    if (e.pointerType !== "mouse" || this.press) return;
    if (this.liveFan() !== "hand") {
      this.hoverTarget = 0;
      return;
    }
    const idx = this.nearestHandFanIndex(e.global.x);
    if (this.hoverTarget === 0) this.reKickWaveAt(idx, this.hand.length);
    this.hoverIndex = idx;
    this.hoverTarget = 1;
    this.wake();
  }

  private onHandHoverOut(e: FederatedPointerEvent): void {
    if (e.pointerType && e.pointerType !== "mouse") return;
    this.hoverTarget = 0;
    this.wake();
  }

  // Ре-энергия + гребень волны у индекса (общее для тыка и захода ховера).
  private reKickWaveAt(index: number, count = this.deckCount): void {
    const n = Math.max(2, count);
    this.fanKickT = 0;
    this.fanWavePhase = anim.fan.wiggle.cycles * Math.PI * 2 * (index / (n - 1)) - Math.PI / 2;
    this.wake();
  }

  // Локальный сдвиг карты i из-за «раскрытия»: карты слева от точки едут влево, справа —
  // вправо, раздвигая ~cards карт (в окне линейно, дальше — постоянный сдвиг). Источник —
  // ховер мышью (десктоп, приоритет) либо тык (тач).
  // На просторном веере (мало карт) сила → 0: иначе средняя карта «колбасится» от края к краю.
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
    if (env <= 0) return 0;
    const scale = this.fanRevealScaleNow();
    if (scale <= 0) return 0;
    return fanSpreadShift(i, index, p.cards, p.amp, env) * scale;
  }

  private fanRevealScaleNow(): number {
    // Во время deal-драга liveFan() глушит "deck" — считаем тесноту веера колоды напрямую.
    if (this.dealDrag && this.deckFanned) {
      const step = fanStep(this.cards.length, this.deckFanGeom().width, anim.fan.widthFactor);
      return fanRevealScale(step, this.layout.cardW, anim.fan.wiggle.gap, anim.fan.maxStepIdle);
    }
    const live = this.liveFan();
    if (!live) return 0;
    const count = live === "hand" ? this.hand.length : this.cards.length;
    const width =
      live === "hand" ? this.handFanGeom().width : live === "deck" ? this.deckFanGeom().width : this.fanGeom().width;
    const step = fanStep(count, width, anim.fan.widthFactor);
    return fanRevealScale(step, this.layout.cardW, anim.fan.wiggle.gap, anim.fan.maxStepIdle);
  }

  // Бегущая волна + локальный поке: двигает только карты ЖИВОГО веера (колода или рука).
  private applyFanWave(live: "deck" | "hand" | "legacy"): void {
    const stack = live === "hand" ? this.hand : this.cards;
    const n = Math.max(2, stack.length);
    const w = anim.fan.wiggle;
    const waveScale = this.fanCrowdNow * w.amp * this.fanEnergy;
    for (let i = 0; i < stack.length; i++) {
      const wave = waveScale * Math.sin(w.cycles * Math.PI * 2 * (i / (n - 1)) - this.fanWavePhase);
      const vi = Math.max(0, Math.min(n - 1, i + wave + this.pokeShiftAt(i)));
      const t =
        live === "hand" ? this.handFanTarget(vi) : live === "deck" ? this.deckFanTarget(vi) : this.fanTarget(vi);
      stack[i]!.body.setTarget({ x: t.x, y: t.y, rot: t.rot });
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
