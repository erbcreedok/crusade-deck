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
  FREE_DROP_REJECT_TEXT,
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
import { scatterCards, shuffleOrder, withoutCard } from "./deckOrder";
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
import { zoneTitle, type DraggedKind } from "./zoneLabels";
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
  deckScale,
} from "./deckStack";
import { cardBackSkin, DEFAULT_CARD_BACK, type CardBackId } from "./cardBack";
import { anim } from "./anim/config";
import {
  DEFAULT_ANIMATION_SETTINGS,
  resolveProfile,
  shouldPlay,
  type AnimationProfile,
} from "./anim/animationSettings";
import { easeOutQuad } from "./anim/easing";
import { clamp01, lerp, nearestIndexByX } from "./mathUtil";
import {
  CARD_EDGE,
  COLORS,
  DECK_ID,
  DRAG_SCALE,
  EMOJI_FONT,
  HAND_ID,
  PIXEL_FONT,
  REJECT_TEXT,
  SHOUT_COLORS,
  SHOUT_EMOJI,
  SHOUT_TEXT,
  TEX_H,
  Z,
  ZERO_SHAKE,
} from "./engine/constants";
import type { ButtonLayout, CardVisual, FanGeom, ShufflePose } from "./engine/types";
import { makeCardBackTexture, makeCardFaceTexture, makeShadowTexture } from "./engine/cardTextures";
import { FaceTextureCache } from "./engine/faceTextureCache";
import { handFanGeom } from "./engine/fanGeometry";
import { paintSeats } from "./engine/seatPaint";
import { applyNoticeStyle, paintZones, styleZoneLabels } from "./engine/zonePaint";
import type { TableSlot } from "./engine/zoneChrome";
import { applyCollapseReveal, layoutCollapseButton, paintCollapseArrow, stepReveal } from "./engine/collapseArrow";
import { randomPermutation, scrambleRot, SCRAMBLE_MAX_SEC, SCRAMBLE_RISE, SCRAMBLE_STEP_SEC } from "./engine/scramble";
import { canSleep } from "./engine/idleGate";
import { SHOUT_DUR, shoutEmojiOffset, shoutFontSize, shoutPose } from "./engine/shout";
import { CardPile } from "./engine/CardPile";
import { shufflePose, shuffleProgress, shouldSwapZ } from "./engine/shufflePose";
import { movedEnough, pressIntent, pushSample } from "./engine/gestureIntent";

export { DECK_ID, HAND_ID } from "./engine/constants";

// Императивный движок комнаты: владеет ОДНИМ Pixi Application, тикером и всеми объектами.
// Никакого React-реконсайлера и «дерева нод на карту» — карты это простые CardVisual,
// которые мы мутируем сами. Именно это отличает подход от прошлого (@pixi/react + краш).
export class RoomEngine {
  private app: Application | null = null;
  private world: Container | null = null;
  private tableG: Graphics | null = null;
  private zoneLayer: Graphics | null = null; // подсветка дроп-зон при драге
  private zoneLabels: Partial<Record<DropZone, Text>> = {}; // текстовые подписи зон
  private slotLabels: Partial<Record<TableSlot, Text>> = {}; // подписи слотов колоды/сброса
  private rejectText: Text | null = null; // «низяяя» по центру во время отскока
  // Клич «ГОУ!» — СВОЙ объект, а не переиспользованный rejectText: отказ и клич могут
  // прилететь одновременно (дилер жмёт «ГОУ!», у кого-то в этот момент отбивается карта),
  // и один общий текст показал бы что-то одно.
  private shoutBox: Container | null = null;
  private shoutWord: Text | null = null;
  private shoutFires: Text[] = []; // огоньки по бокам — системным шрифтом
  private shadowLayer: Container | null = null; // слой под картами
  // ОДНА тень на всю колоду (стопка движется как целое). Раньше была тень на карту —
  // на плотной стопке полупрозрачные тени накапливали альфу в тёмное пятно.
  private deckShadow: Sprite | null = null;
  private cardLayer: Container | null = null; // сами карты (сортируется для риффла)
  private backTex: Texture | null = null; // рубашка (общая; стиль сменяем)
  private shadowTex: Texture | null = null;
  // Лицевые текстуры: кэш + фоновой прогрев порциями (см. faceTextureCache.ts).
  private faces = new FaceTextureCache<Texture>({
    make: (card, fourColor) => makeCardFaceTexture(this.app!, card, fourColor),
    destroy: (tex) => tex.destroy(true),
  });

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
  // Выделение: тап по элементу сообщает наверх, кто это был; тап по пустому месту —
  // что выделение пора снять. Что с этим делать, решает React (см. selection.ts).
  private onDeckTap: ((deckId: string) => void) | null = null;
  private onEmptyTap: (() => void) | null = null;
  private selectedDecks: readonly string[] = [];
  // Рука в фокусе (её колода выделена): веер разъезжается на всю полосу и живёт;
  // без фокуса — узкий спокойный веер на 80% ширины.
  private handFocused = false;
  private focusG: Graphics | null = null; // рамка фокуса вокруг выделенного

  // Колода на столе и своя рука — одна и та же вещь с разной раскладкой (см. CardPile).
  private deckPile = new CardPile({
    create: (card) => this.createCardVisual(card),
    restTarget: (i) => this.restTarget(i),
    place: (v, i) => (v.sprite.zIndex = i),
  });
  private handPile = new CardPile({
    create: (card) => this.createCardVisual(card),
    restTarget: (i) => this.handRestTarget(i),
    // Карта ещё летит в руку — не вспыхивать на месте до приземления призрака.
    place: (v) => {
      if (!this.flightCards.has(v.card)) return;
      v.sprite.visible = false;
      v.sprite.alpha = 0;
    },
  });
  private layout: RoomLayout = computeLayout(1, 1);
  private w = 1;
  private h = 1;
  private baseScale = 1;

  private fourColor = false; // четырёхцветная колода (♦ оранж, ♣ голубой) для слабовидящих
  private cardBack: CardBackId = DEFAULT_CARD_BACK; // скин рубашки (меню → Графика)
  private deckFanned = false; // веер колоды на столе (серверное состояние; видно всем)
  private canDeal = false; // дилер может раздавать верхнюю карту
  private freeMode = false; // режим свободы: карту со стола тянет каждый себе
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
  // Клич «ГОУ!»: живёт своё время, ни к каким картам не привязан.
  private shout: { t: number; dur: number } | null = null;
  // Резиновая тянучка запрещённого жеста (свайп вверх по стопке).
  private stretchAnim: { t: number; dur: number; angle: number } | null = null;
  // Карты в текущем перевороте: по объекту (для рендера) и по идентификатору (для текстур).
  private flipMap = new Map<CardVisual, { delay: number }>();
  private flipByCard = new Map<string, { swapped: boolean; from: boolean }>();
  private stretch = { dx: 0, dy: 0 }; // текущее смещение резиновой тянучки
  private onDeckFx: ((fx: DeckFxMessage) => void) | null = null;
  private onFanChange: ((fanned: boolean) => void) | null = null;
  private onFanCollapse: (() => void) | null = null; // «сложить руку»: стрелка или свайп вниз
  private collapseBtn: Container | null = null; // стрелка под веером руки
  private deckCollapseBtn: Container | null = null; // стрелка под веером колоды (только дилер)
  private collapseWantShow = false;
  private deckCollapseWantShow = false;
  private collapseReveal = 0; // 0..1 появление: slide-up + fade
  private deckCollapseReveal = 0;
  private collapseLayout: ButtonLayout | null = null;
  private deckCollapseLayout: ButtonLayout | null = null;
  private handCounter: Text | null = null; // счётчик карт под сложенной рукой
  private deckCounter: Text | null = null; // счётчик карт под колодой в центре (стопка и веер)
  private deckHit: Container | null = null;

  // Драг колоды дилером: press — палец/мышь прижаты у колоды (ещё не факт что драг),
  // dragging — порог смещения пройден, колода реально едет за курсором.
  private hoverZone: DropTarget | null = null;
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
    fromHand: boolean; // драг из своей руки, а не из колоды
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
  // Карта, которая летит обратно в стопку после промаха мимо всех зон. Пока летит —
  // она не «лежит» в колоде: см. topDetached.
  private homingCard: CardVisual | null = null;
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

    this.buildLayers(app);
    this.buildOverlays();
    this.backTex = makeCardBackTexture(app, this.cardBack);
    this.shadowTex = makeShadowTexture(app);
    this.baseScale = this.layout.cardH / TEX_H;
    this.buildTable();
    this.buildShadows();
    this.buildHitAreas(app);

    if (this.seats.length > 0) this.applySeats(); // места могли приехать до монтирования

    // Состояние комнаты могло приехать РАНЬШЕ, чем поднялся Pixi (вход в живую комнату,
    // перезагрузка страницы): setDeck тогда только запомнил порядок и вышел на «ещё не
    // смонтированы», а повторно его никто не звал — deckKey в RoomCanvas не менялся.
    // Итог: карт не видно, пока не нажмёшь «Растасовать». Доигрываем отложенный порядок.
    if (this.deckCards.length > 0) this.setDeck(this.deckCards);
    if (this.handCards.length > 0) this.setHand(this.handCards);

    app.ticker.add(this.tick);
    this.applyProfile(); // применить текущий профиль (FPS-кап, tilt) к свежему тикеру/картам
    this.wake(); // нарисовать стартовый кадр; следующий тик усыпит, раз всё в покое
  }

  // Слои мира по zIndex: стол → места игроков → подсветка зон → тени → карты.
  private buildLayers(app: Application): void {
    this.world = new Container();
    this.world.sortableChildren = true;
    app.stage.addChild(this.world);

    this.tableG = new Graphics();
    this.tableG.zIndex = Z.table;
    this.seatLayer = new Container();
    this.seatLayer.zIndex = Z.seats; // под зонами и картами: места — часть «стола»
    this.seatG = new Graphics();
    this.seatLayer.addChild(this.seatG);
    // Рамка фокуса рисуется НАД картами: она подсказывает, к чему сейчас относятся
    // кнопки панели, и не должна прятаться под стопкой.
    this.focusG = new Graphics();
    this.focusG.zIndex = Z.focus;
    this.zoneLayer = new Graphics();
    this.zoneLayer.zIndex = Z.zones;
    this.shadowLayer = new Container();
    this.shadowLayer.zIndex = Z.shadows;
    this.cardLayer = new Container();
    this.cardLayer.zIndex = Z.cards;
    this.cardLayer.sortableChildren = true; // чересполосица половин в риффле
    this.world.addChild(this.tableG, this.seatLayer, this.zoneLayer, this.shadowLayer, this.cardLayer, this.focusG);
  }

  // Надписи поверх стола: подписи зон «водяным» текстом и крупное «низяяя» при отбое.
  private buildOverlays(): void {
    (Object.keys(dropZoneRegions(this.layout)) as DropZone[]).forEach((z) => {
      const t = new Text({
        text: zoneTitle(z),
        style: { fontFamily: PIXEL_FONT, fontSize: 24, fill: 0xffffff, letterSpacing: 2 },
      });
      t.anchor.set(0.5);
      t.visible = false;
      this.zoneLayer!.addChild(t);
      this.zoneLabels[z] = t;
    });

    // Подписи боковых слотов игрового стола — тем же «водяным» текстом, что и у зон.
    (["deck", "discard"] as TableSlot[]).forEach((slot) => {
      const t = new Text({
        text: "",
        style: { fontFamily: PIXEL_FONT, fontSize: 18, fill: 0xffffff, letterSpacing: 2 },
      });
      t.anchor.set(0.5);
      t.visible = false;
      this.zoneLayer!.addChild(t);
      this.slotLabels[slot] = t;
    });

    this.rejectText = new Text({
      text: REJECT_TEXT,
      style: {
        fontFamily: PIXEL_FONT,
        fontSize: 64,
        fill: 0xff5a4a,
        stroke: { color: 0x2a0f0c, width: 6 },
        letterSpacing: 3,
        align: "center",
      },
    });
    this.rejectText.anchor.set(0.5);
    this.rejectText.visible = false;
    this.rejectText.zIndex = Z.rejectText; // поверх карт (world.sortableChildren)
    this.world!.addChild(this.rejectText);
    this.buildShout();
    this.styleZoneLabels();
  }

  // Клич «ГОООООУУУ!!! 🔥» — контейнер из трёх надписей: слово пиксельным шрифтом и по
  // огоньку с боков системным (в VT323 эмодзи нет — он нарисовал бы «крокозябру»).
  // Анимируется контейнер целиком, поэтому огни живут ровно в такт слову.
  private buildShout(): void {
    const box = new Container();
    const word = new Text({
      text: SHOUT_TEXT,
      style: {
        fontFamily: PIXEL_FONT,
        fill: SHOUT_COLORS.fill,
        stroke: { color: SHOUT_COLORS.stroke, width: 9 },
        letterSpacing: 4,
        align: "center",
      },
    });
    word.anchor.set(0.5);
    box.addChild(word);
    this.shoutWord = word;

    this.shoutFires = [-1, 1].map(() => {
      const fire = new Text({ text: SHOUT_EMOJI, style: { fontFamily: EMOJI_FONT } });
      fire.anchor.set(0.5);
      box.addChild(fire);
      return fire;
    });

    box.visible = false;
    box.zIndex = Z.shout;
    this.shoutBox = box;
    this.world!.addChild(box);
    this.styleShout();
  }

  // Кегль и расстановка огоньков — от ширины экрана (engine/shout.ts). Пересчитываются на
  // ресайзе: клич должен влезать в поворот телефона так же, как в исходную ориентацию.
  private styleShout(): void {
    const word = this.shoutWord;
    if (!word) return;
    const size = shoutFontSize(this.w, SHOUT_TEXT.length);
    word.style.fontSize = size;
    const offset = shoutEmojiOffset(size, SHOUT_TEXT.length);
    this.shoutFires.forEach((fire, i) => {
      fire.style.fontSize = size * 0.7;
      fire.x = (i === 0 ? -1 : 1) * offset;
    });
  }

  // Тени и «кирпич» колоды. Тень у колоды ОДНА на всю стопку: раньше была тень на карту,
  // и на плотной стопке полупрозрачные тени накапливали альфу в тёмное пятно.
  private buildShadows(): void {
    const deckShadow = new Sprite(this.shadowTex!);
    deckShadow.anchor.set(0.5);
    this.shadowLayer!.addChild(deckShadow);
    this.deckShadow = deckShadow;

    // Отдельная тень под ОДНОЙ картой, которую тащат из веера: общая тень колоды в этот
    // момент лежит под самим веером и «поднятую» карту не показывает.
    const cardShadow = new Sprite(this.shadowTex!);
    cardShadow.anchor.set(0.5);
    cardShadow.visible = false;
    this.shadowLayer!.addChild(cardShadow);
    this.cardShadow = cardShadow;

    // «Кирпич» колоды живёт в слое карт под ними: верхняя карта — настоящий спрайт,
    // всё, что под ней, рисуется одной Graphics (см. drawDeckBody).
    const body = new Graphics();
    body.zIndex = Z.deckBody; // над нижней картой (zIndex 0), под всеми остальными
    this.cardLayer!.addChild(body);
    this.deckBody = body;
  }

  // Всё интерактивное: хит-зоны колоды и руки, стрелки «сложить», счётчики и сцена целиком.
  private buildHitAreas(app: Application): void {
    // Невидимая зона поверх колоды — старт драга и тап по колоде.
    const hit = new Container();
    hit.eventMode = "static";
    hit.cursor = "grab";
    hit.zIndex = Z.deckHit; // всегда над картами
    hit.on("pointerdown", (e: FederatedPointerEvent) => this.onDeckDown(e));
    hit.on("pointertap", (e: FederatedPointerEvent) => {
      // Гасим всплытие: иначе тот же тап дойдёт до сцены и «тап мимо» снимет выделение,
      // которое мы только что поставили.
      e.stopPropagation();
      this.handleDeckTap(e);
    });
    hit.on("pointermove", (e: FederatedPointerEvent) => this.onDeckHover(e)); // ховер мышью
    hit.on("pointerout", (e: FederatedPointerEvent) => this.onDeckHoverOut(e));
    this.world!.addChild(hit);
    this.deckHit = hit;
    this.positionDeckHit();

    // Стрелки «сложить»: рука — любому; колода на столе — только дилеру (syncCollapseButton).
    this.collapseBtn = this.makeCollapseButton(() => this.onFanCollapse?.());
    this.deckCollapseBtn = this.makeCollapseButton(() => this.onDeckFanChange?.(false));

    this.handCounter = this.makeCounterText();
    this.deckCounter = this.makeCounterText();
    this.syncCollapseButton();
    this.syncDeckCounter();

    // Хит-зона руки — отдельный невидимый слой над полосой handZone.
    const handHit = new Container();
    handHit.eventMode = "static";
    handHit.cursor = "pointer";
    handHit.zIndex = Z.handHit;
    handHit.on("pointerdown", (e: FederatedPointerEvent) => this.onHandDown(e));
    handHit.on("pointertap", (e: FederatedPointerEvent) => {
      e.stopPropagation();
      this.handleHandTap(e);
    });
    handHit.on("pointermove", (e: FederatedPointerEvent) => this.onHandHover(e));
    handHit.on("pointerout", (e: FederatedPointerEvent) => this.onHandHoverOut(e));
    this.world!.addChild(handHit);
    this.handHit = handHit;
    this.positionHandHit();

    this.bindStageEvents(app);
  }

  private makeCollapseButton(onTap: () => void): Container {
    const btn = new Container();
    btn.eventMode = "static";
    btn.cursor = "pointer";
    btn.zIndex = Z.collapseBtn; // ВЫШЕ хит-зоны колоды: иначе её съедала полоса веера
    btn.visible = false;
    btn.alpha = 0;
    btn.addChild(new Graphics());
    btn.on("pointerdown", (e: FederatedPointerEvent) => e.stopPropagation());
    btn.on("pointertap", (e: FederatedPointerEvent) => {
      e.stopPropagation();
      onTap();
    });
    this.world!.addChild(btn);
    return btn;
  }

  // Move/up ловим на всей сцене — палец может уйти далеко за пределы колоды.
  private bindStageEvents(app: Application): void {
    app.stage.eventMode = "static";
    app.stage.hitArea = new Rectangle(0, 0, this.w, this.h);
    app.stage.on("pointermove", (e: FederatedPointerEvent) => this.onPointerMove(e));
    app.stage.on("pointerup", (e: FederatedPointerEvent) => {
      const wasDrag = !!this.cardDrag;
      this.onPointerUp(e);
      // После настоящего драга тапа не будет — снимаем метку сами, иначе она проглотит
      // следующий честный тап по пустому месту.
      if (wasDrag) this.tapStartedOnDeck = false;
    });
    // Тап мимо всего — снять выделение. Тап по колоде сюда не доходит: он погашен на её
    // хит-зоне (stopPropagation выше).
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
  }

  // Колода и рука: спрайты и порядок живут в стопках, движок только читает их.
  private get cards(): CardVisual[] {
    return this.deckPile.cards;
  }
  private get hand(): CardVisual[] {
    return this.handPile.cards;
  }
  private get deckCards(): string[] {
    return this.deckPile.order;
  }
  private get handCards(): string[] {
    return this.handPile.order;
  }
  private get deckCount(): number {
    return this.deckPile.count;
  }
  private get handCount(): number {
    return this.handPile.count;
  }

  // Счётчик карт под стопкой (их два — под рукой и под колодой, различие только в позиции).
  private makeCounterText(): Text {
    const t = new Text({
      text: "",
      style: { fontFamily: PIXEL_FONT, fontSize: 20, fill: COLORS.gold, letterSpacing: 2 },
    });
    t.anchor.set(0.5);
    t.visible = false;
    t.zIndex = Z.counters;
    t.eventMode = "none";
    this.world!.addChild(t);
    return t;
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
    // Инвариант отрисовки: в колоде нет повторов. Дубликат означал бы рассинхрон со
    // схемой, и рисовать по нему нельзя — на экране появились бы «карты-близнецы»,
    // которые движок не смог бы развести (спрайты привязаны к идентичности карты).
    const newOrder = dedupeDeckOrder(cards).slice(0, 52);
    const oldOrder = this.cards.map((c) => c.card);
    this.ensureJitter(newOrder.length);
    if (!this.cardLayer || !this.backTex) {
      this.deckPile.remember(newOrder); // сцены ещё нет — доиграем состав на mount
      return;
    }

    this.deckPile.reconcile(newOrder); // спрайты переставлены в новый порядок, тела на месте
    // Карта могла уехать из колоды (её раздали/забрали) — ссылки на неё держать нельзя.
    if (this.homingCard && !this.cards.includes(this.homingCard)) this.homingCard = null;
    if (this.rejectCard && !this.cards.includes(this.rejectCard) && !this.hand.includes(this.rejectCard)) {
      this.rejectCard = null;
    }

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
    if (!this.cardLayer || !this.backTex) {
      this.handPile.remember(newOrder);
      return;
    }

    this.handPile.reconcile(newOrder);
    this.hand.forEach((c, i) => {
      c.body.snapTo(this.handRestTarget(i));
      c.sprite.zIndex = Z.handCards + (this.handRowMode() ? this.hand.length - i : i);
      c.sprite.texture = this.faceTexture(c.card); // свою руку владелец видит всегда
      c.sprite.visible = true;
    });
    this.syncHandCounter();
    this.syncCollapseButton();
    this.positionHandHit();
    this.warmFaceTextures();
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
    if (this.deckHit) this.deckHit.cursor = this.deckCursor();
    this.syncCollapseButton();
  }

  // Кто может снять карту с колоды: дилер в раздаче или ЛЮБОЙ в режиме свободы.
  private canPullCard(): boolean {
    return this.canDeal || this.freeMode;
  }

  private deckCursor(): "grab" | "pointer" {
    return this.canPullCard() ? "grab" : "pointer";
  }

  // Режим свободы: колода на столе общая. Верхнюю карту тянет любой игрок, но только СЕБЕ
  // — чужие места перестают быть дроп-зонами (см. dropCard и aimDealDrag).
  // Режим свободы: колода на столе общая. Верхнюю карту тянет любой игрок, но только СЕБЕ
  // — чужие места перестают быть дроп-зонами (см. dropCard и aimDealDrag). Заодно меняется
  // разметка стола: колода уезжает в левый слот, справа появляется сброс (см. layout.ts).
  setFreeMode(v: boolean): void {
    if (v === this.freeMode) return;
    this.freeMode = v;
    this.rebuildLayout();
    this.cards.forEach((c, i) => c.body.setTarget(this.restTarget(i)));
    this.hand.forEach((c, i) => c.body.setTarget(this.handRestTarget(i)));
    if (this.deckHit) this.deckHit.cursor = this.deckCursor();
    this.positionDeckHit();
    this.positionHandHit();
    this.syncDeckCounter();
    this.syncCollapseButton();
    this.drawZones();
    this.drawFocus();
    this.wake();
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

  // Фокус на руке = выделена стопка руки (HAND_ID): полоса разъезжается веером, карты
  // едут пружиной. Веер колоды на столе не трогаем — он общий и живёт отдельно.
  private applyHandFocus(): void {
    const next = this.selectedDecks.includes(HAND_ID);
    if (next === this.handFocused) return;
    this.handFocused = next;
    this.rebuildLayout();
    this.hand.forEach((c, i) => c.body.setTarget(this.handRestTarget(i)));
    this.hoverTarget = 0;
    this.hoverEnv = 0;
    this.poke = null;
    this.positionDeckHit();
    this.positionHandHit();
    this.drawZones();
    this.syncCollapseButton();
    this.syncHandCounter();
    this.updateVisibility();
    this.onFanChange?.(next);
  }

  private rebuildLayout(): void {
    this.layout = computeLayout(
      this.w,
      this.h,
      { ...this.seatInsets, bottom: this.bottomInset },
      this.freeMode,
    );
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
    const a = this.layout.deckAnchor;
    const scale = deckScale();
    const w = this.layout.cardW * scale;
    const h = this.layout.cardH * scale;
    const pad = Math.max(6, this.layout.cardH * 0.12);
    const x = a.x - w / 2 - pad;
    const y = a.y - h / 2 - pad;
    g.roundRect(x, y, w + pad * 2, h + pad * 2, 14).stroke({ width: 3, color: 0xffe9a8, alpha: 0.95 });
    g.roundRect(x, y, w + pad * 2, h + pad * 2, 14).fill({ color: 0xffe08a, alpha: 0.08 });
  }

  // Место игрока: прямоугольник с именем, числом карт и метками (дилер/готов/бот/пауза),
  // плюс стопка/веер его руки. Вся отрисовка — в engine/seatPaint.ts.
  private drawSeats(): void {
    const g = this.seatG;
    const layer = this.seatLayer;
    if (!g || !layer || !this.backTex) return;
    g.clear();
    this.seatTexts.forEach((t) => t.destroy());
    for (const n of this.seatHandNodes) n.destroy({ children: true });

    const painted = paintSeats(this.seats, this.seatBoxes, {
      layer,
      g,
      backTex: this.backTex,
      faceTex: (card) => this.faceTexFor(card),
      cardBack: this.cardBack,
      cardW: this.layout.cardW,
      cardH: this.layout.cardH,
      hoverSeat: this.hoverSeat,
      dealDragging: !!this.cardDrag && this.dealDrag,
      visualCount: (seat) => this.seatVisualCount(seat),
    });
    this.seatTexts = painted.texts;
    this.seatHandNodes = painted.nodes;
  }


  // Скин рубашки: перерисовываем текстуру и раздаём её картам (лица не трогаем).
  setCardBack(id: CardBackId): void {
    if (id === this.cardBack) return;
    this.cardBack = id;
    if (!this.app) return;
    const old = this.backTex;
    this.backTex = makeCardBackTexture(this.app, this.cardBack);
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
      this.startFlip(changed, Math.PI / 2, anim.flip.cardDur, changed.length === this.cards.length);
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

  // Колбэк на перестановку карты в колоде (драг карты в раскрытом веере) — React шлёт
  // reorder_deck на сервер, тот подтверждает эхом.
  setOnCardReorder(fn: ((card: string, to: number) => void) | null): void {
    this.onCardReorder = fn;
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
    fn?.(this.handFocused);
  }

  // Проиграть чужой эффект (пришёл с сервера). Состояние он не трогает — только показывает.
  playFx(fx: DeckFxMessage): void {
    if (this.destroyed) return;
    const dur = Math.max(0.05, fx.dur / 1000);
    if (fx.kind === "flip-deck") this.startFlip(this.cards, fx.angle, dur);
    else if (fx.kind === "flip-cards") {
      const vs = this.cards.filter((c) => fx.cards.includes(c.card));
      this.startFlip(vs, fx.angle, dur);
    } else if (fx.kind === "stretch") this.startStretch(fx.angle, dur);
    else if (fx.kind === "spill") this.startSpill(fx.count, dur, false);
  }

  // Колбэк на ЛЮБУЮ тасовку: наверх уходит готовый порядок колоды.
  setOnShuffleChange(fn: ((order: string[]) => void) | null): void {
    this.onShuffleChange = fn;
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


  // Колбэк на старт/конец драга колоды (React прячет кнопки действий на время драга).
  setOnDragChange(fn: ((active: boolean) => void) | null): void {
    this.onDragChange = fn;
  }

  // ——— драг колоды ———

  private onDeckDown(e: FederatedPointerEvent): void {
    this.tapStartedOnDeck = true;
    this.skipNextTap = false; // новый жест — прошлое подавление тапа больше не актуально
    // Что вообще можно делать этим нажатием, решает dragMode.ts.
    const mode = this.dragMode();
    if (mode === "none") return;

    if (this.cardPress || this.cardDrag) return;
    if (this.cards.length === 0 && mode !== "card") return;
    // topCard — раздача со стопки/веера: тащим верхнюю (или ту, что под пальцем).
    // peek — не-дилер на открытом вееере: только глиссандо и тык, без драга и тасовки.
    // card — рука в фокусе: жест относится к КАРТЕ. Зажатый веер не таскаем, пока карта
    //        не показала достаточную полоску (canGrabAt) — но палец не игнорируем:
    //        ведение раскрывает веер под пальцем, и в открытый зазор карту уже можно взять.
    const nearest = this.nearestFanIndex(e.global.x);
    this.dealDrag = mode === "topCard";
    if (mode !== "card") this.deckPointer = true;
    this.cardPress = {
      id: e.pointerId,
      ...this.pressPoint(e),
      // В свободе берём именно ВЕРХНЮЮ карту, даже если веер раскрыт: сервер по take_card
      // снимает верхнюю, и картинка не должна расходиться с тем, что он выдаст.
      index:
        mode === "topCard"
          ? dealSourceIndex(this.cards.length, this.deckFanned && !this.freeMode, nearest)
          : nearest,
      canGrab: mode === "topCard" ? true : mode === "peek" ? false : this.canGrabAt(nearest),
      fromHand: false,
      samples: this.startSamples(e),
    };
    this.wake();
  }

  /** Точка нажатия: старт жеста и его текущая позиция — поначалу одно и то же. */
  private pressPoint(e: FederatedPointerEvent): { startX: number; startY: number; x: number; y: number } {
    return { startX: e.global.x, startY: e.global.y, x: e.global.x, y: e.global.y };
  }

  private startSamples(e: FederatedPointerEvent): SwipeSample[] {
    return [{ x: e.global.x, y: e.global.y, t: performance.now() }];
  }

  // Движение пальца адресуется тому жесту, который он начал: карта в драге, нажатие на
  // карту (ещё не решено, что это), или драг всей колоды.
  private onPointerMove(e: FederatedPointerEvent): void {
    if (this.cardDrag && e.pointerId === this.cardDrag.id) {
      this.moveDraggedCard(e);
      return;
    }
    if (this.cardPress && e.pointerId === this.cardPress.id) {
      this.moveCardPress(e);
      return;
    }
  }

  // Карта уже в руке у игрока: ведём её и подсвечиваем то, куда она может лечь.
  private moveDraggedCard(e: FederatedPointerEvent): void {
    const d = this.cardDrag!;
    pushSample(d.samples, { x: e.global.x, y: e.global.y, t: performance.now() });

    // Резкий бросок ВНИЗ прерывает драг: карта возвращается на место, рука складывается.
    // При раздаче верхней карты свайп вниз просто отменяет жест (без сворачивания руки).
    const v = swipeVelocity(d.samples, anim.swipe.windowMs);
    if (!this.dealDrag && isSwipeDown(v.vx, v.vy)) {
      this.cancelCardDrag(d.v);
      return;
    }

    d.x = e.global.x;
    d.y = e.global.y;
    if (this.dealDrag) this.aimDealDrag(e.global.x, e.global.y);
    else this.aimReorderDrag(e.global.x, e.global.y);
    this.wake();
  }

  private cancelCardDrag(dragged: CardVisual): void {
    this.cardDrag = null;
    this.skipNextTap = true;
    this.hoverZone = null;
    this.returnCardHome(dragged);
    this.drawZones();
    this.onDragChange?.(false);
    this.onFanCollapse?.();
    this.wake();
  }

  // Раздача: карта ищет чужое место или мою полосу руки.
  private aimDealDrag(x: number, y: number): void {
    // Ховерим и неготовых — чтобы показать «Неа»; принять или отбить решает дроп.
    const seatHit = pickSeat(x, y, this.seatBoxes);
    this.setHoverSeat(seatHit && seatHit !== this.selfId ? seatHit : null);
    const to = pickDealTarget(x, y, this.seatBoxes, this.layout, this.selfId, this.dealReadyIds(), this.freeMode);
    // Своя рука подсвечивается как обычная дроп-зона hand.
    this.hoverZone = to === this.selfId ? { zone: "hand" } : null;

    if (this.deckFanned) {
      // Веер колоды раступается перед картой (дырка по x), как рука при реордере.
      if (this.inDeckFanArea(x, y)) this.cardDrag!.insertAt = this.insertDeckIndexAt(x);
      this.applyCardDragTargets();
    } else {
      this.cardDrag!.v.body.setTarget({ x, y, rot: 0, scale: DRAG_SCALE });
    }
    this.drawSeats();
    this.drawZones();
  }

  // Перестановка внутри веера: карта ищет свой новый слот.
  private aimReorderDrag(x: number, y: number): void {
    const d = this.cardDrag!;
    d.insertAt = d.fromHand ? this.insertHandIndexAt(x) : this.insertDeckIndexAt(x);
    this.hoverZone = pickDropTarget(x, y, this.layout);
    this.applyCardDragTargets();
    this.drawZones();
  }

  // Палец прижат к карте, но что это за жест — ещё не решено. Решает pressIntent.
  private moveCardPress(e: FederatedPointerEvent): void {
    const p = this.cardPress!;
    pushSample(p.samples, { x: e.global.x, y: e.global.y, t: performance.now() });
    p.x = e.global.x;
    p.y = e.global.y;
    const v = swipeVelocity(p.samples, anim.swipe.windowMs);
    const intent = pressIntent({
      dx: p.x - p.startX,
      dy: p.y - p.startY,
      vx: v.vx,
      vy: v.vy,
      travelUp: p.startY - p.y,
      travelDown: p.y - p.startY,
      cardH: this.layout.cardH,
      fromHand: p.fromHand,
      dealDrag: this.dealDrag,
      canGrab: p.canGrab,
      swipeable: this.fanOpen() && this.deckCount >= 2,
      canShuffle: this.canDeal,
    });

    switch (intent) {
      case "wait":
        return;
      case "deal":
        this.skipNextTap = true; // после драга верхней карты тап не откроет веер
        this.beginCardDrag();
        return;
      case "collapse-hand":
        this.cardPress = null;
        this.dealDrag = false;
        this.onFanCollapse?.();
        return;
      case "shuffle":
        this.startSwipeShuffle(v.vx, v.vy, p.index);
        this.cardPress = null;
        this.dealDrag = false;
        this.deckPointer = false;
        return;
      case "grab":
        this.beginCardDrag();
        return;
      case "glissando":
        this.glissandoTo(e.global.x);
    }
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
  }

  // ——— перевороты, тянучка, рассыпание ———

  // Переворот набора карт вокруг оси, перпендикулярной жесту. Стопка переворачивается
  // волной (задержка на карту), отдельные карты — разом.
  //
  // СВОИХ переворотов у клиента больше нет: карты в колоде всегда лежат рубашкой вверх, и
  // сторону меняет только состояние сервера (setCardFacing) или чужой эффект. Механика
  // осталась ради этих двух случаев — и ради будущих правил, где карта ляжет на стол лицом.
  private startFlip(cards: CardVisual[], angle: number, dur: number, wholeDeck = false): void {
    if (cards.length === 0) return;
    // Волна по картам уместна только в РАСКРЫТОМ вее­ре, где карты видно поодиночке.
    // Стопка — одна вещь: она переворачивается целиком, иначе верхняя (единственная
    // видимая) карта начинала бы поворот последней, и жест выглядел бы «залипающим».
    const stagger = wholeDeck && this.deckFanned ? anim.flip.stagger : 0;
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
    this.wake();
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

    // Рассыпание — чистое украшение: стороны карт оно больше не меняет (в колоде все
    // карты лежат рубашкой вверх), поэтому наверх уходит только сам эффект.
    if (emit) {
      this.onDeckFx?.({ kind: "spill", angle: 0, cards: [], count: take, dur: Math.round(dur * 1000) });
    }
    this.wake();
  }

  /**
   * Клич «ГОУ!»: дилер объявил начало, и это видит весь стол — включая его самого.
   * Ничего не двигает и ни к чему не привязан, только надпись поверх стола.
   */
  playShout(): void {
    if (this.destroyed) return;
    this.shout = { t: 0, dur: SHOUT_DUR };
    this.wake();
  }

  /** Короткая надпись поверх стола БЕЗ отката карт: отказ, которому нечего возвращать. */
  showRejectNotice(text: string): void {
    if (this.destroyed) return;
    this.showNotice(text);
  }

  // Короткая надпись поверх стола (переиспользуем оверлей «низяяя»).
  private showNotice(text: string): void {
    this.setNoticeText(text);
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

  /**
   * Карта уходит с колоды: призрак летит с пальца к месту получателя, а сама карта
   * ПОКИДАЕТ стопку сразу же, не дожидаясь эха сервера.
   *
   * Немедленное удаление обязательно: к верхней карте привязаны кирпич колоды, её тень и
   * счётчик. Пока улетевшая карта числится в стопке верхней, вся колода «переезжает» в
   * точку дропа и возвращается в центр только с приходом состояния — со стороны это
   * выглядит так, будто карта и колода поменялись местами.
   *
   * Если сервер откажет или отдаст другую карту (в свободе двое могли потянуть разом),
   * состояние вернёт правду и карта просто появится в колоде обратно.
   */
  flyCardOff(card: string, from: FlightPoint, toId: string): void {
    if (this.destroyed) return;
    this.playDealFlight(card, from, toId);
    this.setDeck(withoutCard(this.deckCards, card));
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

  // Веер руки «живой»: стопка Player.hand в фокусе.
  private fanOpen(): boolean {
    return this.handFocused && this.hand.length > 0;
  }

  // Рука лежит шеренгой (сложена), а не веером.
  private handRowMode(): boolean {
    return this.handCount > 0 && !this.handFocused;
  }

  // Что берёт палец на КОЛОДЕ (у руки свой обработчик — onHandDown).
  private dragMode(): DragMode {
    return dragModeFor({
      onHand: false,
      handFocused: this.handFocused,
      canDeal: this.canDeal,
      deckFanned: this.deckFanned,
      freeMode: this.freeMode,
    });
  }

  // Достаточно ли видна карта, чтобы её взять. Считаем по фактическим позициям спрайтов:
  // в зажатом веере полоска карты — пара пикселей, тащить нечего, сначала раздвинь тыком
  // или ховером (они и дают нужный зазор).
  private canGrabAt(index: number): boolean {
    const xs = this.cards.map((c) => c.sprite.x);
    return visibleSliver(xs, index) >= this.layout.cardW * anim.cardDrag.minGrabSliver;
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
    const g = this.handFanGeom();
    return fanBandContains(x, y, g.anchor, g.width, g.angleDeg, anim.fan.widthFactor, l.cardW, l.cardH, l.cardH * 0.5);
  }

  // Удержание состоялось — карта под пальцем «прилипает» к нему и выходит из веера.
  private beginCardDrag(): void {
    const p = this.cardPress;
    if (!p) return;
    const fromHand = this.handFocused && !this.dealDrag;
    const stack = fromHand ? this.hand : this.cards;
    if (stack.length === 0) return;
    const v = stack[Math.max(0, Math.min(stack.length - 1, p.index))]!;
    this.cardPress = null;
    this.poke = null;
    this.hoverTarget = 0;
    this.cardDrag = {
      id: p.id,
      v,
      insertAt: fromHand ? p.index : this.dealDrag ? p.index : this.insertDeckIndexAt(p.x),
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
      const to = pickDealTarget(
        p.x,
        p.y,
        this.seatBoxes,
        this.layout,
        this.selfId,
        this.dealReadyIds(),
        this.freeMode,
      );
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
          : this.deckFanTarget(vi);
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
    if (this.deckHit) this.deckHit.cursor = this.deckCursor();

    if (dealing) {
      const seatHit = pickSeat(x, y, this.seatBoxes);
      const readyIds = this.dealReadyIds();
      // В свободе чужая рука закрыта для всех — включая дилера (сервер скажет то же).
      // Не готов (в обычной раздаче) — отбой «нииизя». Карта в обоих случаях не уходит.
      const foreignSeat = !!seatHit && seatHit !== this.selfId;
      if (foreignSeat && (this.freeMode || !readyIds.has(seatHit!))) {
        this.startCardReject(d.v, x, y, this.freeMode ? FREE_DROP_REJECT_TEXT : DEAL_DROP_REJECT_TEXT);
        this.onDragChange?.(false);
        this.drawSeats();
        this.drawZones();
        this.positionDeckHit();
        this.wake();
        return;
      }
      const seat = pickDealTarget(x, y, this.seatBoxes, this.layout, this.selfId, readyIds, this.freeMode);
      if (seat) {
        const card = d.v.card;
        // Плавный полёт с пальца к месту; эхо card_moved этот же card пропустит.
        this.flyCardOff(card, { x: d.v.sprite.x, y: d.v.sprite.y, rot: d.v.sprite.rotation }, seat);
        this.onDealCard?.(card, seat);
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
      const to = fromHand ? this.insertHandIndexAt(x) : this.insertDeckIndexAt(x);
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
    if (!this.deckPile.moveCard(card, to)) return; // рассинхрон — не трогаем
    this.layoutDeck();
  }

  private reorderHandLocally(card: string, to: number): void {
    if (!this.handPile.moveCard(card, to)) return;
    this.layoutHand();
  }

  // Разложить стопку по местам покоя пружиной, попутно выставив z-порядок.
  private layoutDeck(): void {
    this.deckPile.layout((c, i, t) => {
      c.sprite.zIndex = i;
      c.body.setTarget(t);
    });
  }

  private layoutHand(): void {
    this.handPile.layout((c, i, t) => {
      c.sprite.zIndex = Z.handCards + i;
      c.body.setTarget(t);
    });
  }

  // Применить готовый порядок колоды локально (жест-выплеск считает его сам). Спрайты
  // переиспользуются по идентичности карты, поэтому каждая карта просто едет в свой слот;
  // эхо сервера с тем же порядком уже ничего не сдвинет (см. setDeck).
  private applyOrderLocally(order: string[]): void {
    if (!this.deckPile.applyOrder(order)) return; // рассинхрон — не трогаем
    this.layoutDeck();
  }

  private returnCardHome(v: CardVisual): void {
    const hi = this.hand.indexOf(v);
    if (hi >= 0) {
      v.sprite.zIndex = Z.handCards + hi;
      this.hand.forEach((c, j) => c.body.setTarget(this.handRestTarget(j)));
      this.updateVisibility();
      return;
    }
    const i = Math.max(0, this.cards.indexOf(v));
    v.sprite.zIndex = i;
    // Карта возвращается домой ПРУЖИНОЙ и всё это время остаётся верхней в стопке.
    // Пока она в пути, стопку рисуем как n−1 (topDetached), иначе кирпич колоды летит
    // домой вместе с ней — со стороны это выглядит как возвращающаяся целиком колода.
    this.homingCard = v;
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
        : this.restTarget(Math.max(0, this.cards.indexOf(v)));
    let dx = home.x! - px;
    let dy = home.y! - py;
    const len = Math.hypot(dx, dy) || 1;
    this.reject = { t: 0, dur: 0.5, dirX: dx / len, dirY: dy / len };
    this.rejectCard = v;
    this.setNoticeText(text);
    v.body.setTarget({ x: px, y: py, scale: DRAG_SCALE, rot: 0 });
    this.wake();
  }

  // «Ударный» отскок: колода держится у точки удара и делает затухающие колебания
  // В СТОРОНУ ДОМА, затем возвращается. Надпись — REJECT_TEXT («низяяя»).
  private startReject(px: number, py: number): void {
    const a = this.layout.deckAnchor;
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
    this.setNoticeText(REJECT_TEXT);
    const zs = deckScale();
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

  // Зоны видны ВСЕГДА, но по-разному. В покое — еле заметные очертания и подпись, что это
  // за зона: игрок понимает разметку стола, не отвлекаясь на неё. Во время драга зоны
  // заливаются оверлеем, а подпись меняется на ДЕЙСТВИЕ — что будет, если бросить сюда.
  // Сами правила — в engine/zoneChrome.ts, рисование — в engine/zonePaint.ts.
  private drawZones(): void {
    if (!this.zoneLayer) return;
    paintZones({
      g: this.zoneLayer,
      labels: this.zoneLabels,
      slotLabels: this.slotLabels,
      deckEmpty: this.deckCount === 0,
      layout: this.layout,
      dragging: !!this.cardDrag,
      hoverZone: this.hoverZone,
      // В свободе тянут карту СЕБЕ — у зоны руки должна быть своя подпись («взять себе»),
      // а не «оставить в руке», как при перестановке своей же карты.
      dragged: (this.freeMode && this.dealDrag ? "take" : "card") as DraggedKind,
      myReady: this.selfDealReady(),
    });
  }

  // Размер шрифта подписей/«низяяя» от размера карты (обновляется на ресайзе).
  private styleZoneLabels(): void {
    styleZoneLabels(this.zoneLabels, this.layout, this.rejectText, this.w);
  }

  // Текст надписи поверх стола + подгонка кегля и переноса под него: длинная причина
  // отказа обязана лечь в две строки, а не уехать за оба края экрана.
  private setNoticeText(text: string): void {
    const t = this.rejectText;
    if (!t) return;
    t.text = text;
    applyNoticeStyle(t, this.layout.cardH, this.w);
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
    {
      this.dealDrag = false; // тап открытия — не раздача
      if (forbidDeckOpenTap(this.canDeal, this.deckFanned, this.freeMode)) {
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
  }

  private onHandDown(e: FederatedPointerEvent): void {
    if (this.hand.length === 0) return;
    this.tapStartedOnDeck = true;
    this.skipNextTap = false;
    if (!this.handFocused) return; // сложенная рука — только тап (выделение), без драга карт
    if (this.cardPress || this.cardDrag) return;
    this.dealDrag = false;
    this.cardPress = {
      id: e.pointerId,
      ...this.pressPoint(e),
      index: this.nearestHandFanIndex(e.global.x),
      canGrab: true,
      fromHand: true,
      samples: this.startSamples(e),
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
    return nearestIndexByX(this.hand.map((c) => c.sprite.x), x);
  }

  private positionHandHit(): void {
    if (!this.handHit) return;
    if (this.handCount === 0) {
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
    // Веер колоды на столе.
    if (this.deckFanned) {
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
    const a = this.layout.deckAnchor;
    const zs = deckScale();
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
      const slots = this.cards.map((_, i) => this.restTarget(i));
      const perm = randomPermutation(this.cards.length);
      const rise = this.layout.cardH * SCRAMBLE_RISE;
      this.cards.forEach((c, i) => {
        const s = slots[perm[i]!]!;
        c.body.setTarget({ x: s.x ?? 0, y: (s.y ?? 0) - rise, rot: (s.rot ?? 0) + scrambleRot() });
        c.sprite.zIndex = perm[i]!;
      });
      sc.nextAt = sc.t + SCRAMBLE_STEP_SEC;
    }
    // Страховка от «вечного» сумбура, если новый порядок так и не пришёл.
    if (sc.t > SCRAMBLE_MAX_SEC) {
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
      this.deckFanned ||
      !!this.shuffleAnim ||
      !!this.scrambleAnim ||
      !!this.cardDrag ||
      !!this.splashAnim
    );
  }

  /**
   * Верхняя карта колоды сейчас НЕ лежит в стопке: её либо тащат (раздача/тянучка), либо
   * она отбивается после запрещённого дропа и летит домой.
   *
   * Признак нужен всем трём отрисовкам стопки разом: к верхней карте привязаны и кирпич
   * колоды, и её видимость. Пока карта в стороне, стопку рисуем как n−1 — иначе колода
   * «переезжает» за картой (на чужое место при отбое), а в своём слоте остаётся одна
   * нижняя карта.
   */
  private topDetached(): boolean {
    const n = this.cards.length;
    if (n === 0) return false;
    if (this.dealDrag && this.cardDrag) return true;
    const top = this.cards[n - 1];
    return this.rejectCard === top || this.homingCard === top;
  }

  private updateVisibility(): void {
    const detailed = this.detailedCards();
    const n = this.cards.length;
    const dealing = this.topDetached();
    if (dealing && n >= 1 && !this.deckFanned) {
      const dragged = n - 1;
      const stackTop = n >= 2 ? n - 2 : -1;
      for (let i = 0; i < n; i++) {
        this.cards[i]!.sprite.visible = (i === dragged || i === stackTop || i === 0);
      }
      if (this.deckBody) this.deckBody.visible = n > 3;
      if (this.deckShadow) {
        this.deckShadow.visible = this.profile.shadows && n > 1;
      }
      return;
    }
    const top = n - 1;
    for (let i = 0; i < n; i++) {
      this.cards[i]!.sprite.visible = (detailed || i === top || i === 0);
    }
    if (this.deckBody) this.deckBody.visible = !detailed && n > 2;
    if (this.deckShadow) {
      this.deckShadow.visible = this.profile.shadows && this.cards.length > 0;
    }
  }

  // Геометрия «кирпича»: торцы карт, лежащих ПОД верхней. Перерисовывается только когда
  // меняется число карт или раскладка — каждый кадр блок просто едет за верхней картой.
  private drawDeckBody(): void {
    const g = this.deckBody;
    if (!g) return;
    g.clear();
    // Пока верхняя карта в стороне (тащат или отбивают), кирпич рисуем по оставшейся стопке.
    const dealing = this.topDetached();
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
    const dealing = this.topDetached();
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
    this.styleShout();
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
    this.cardPress = null;
    this.cardDrag = null;
    this.rejectCard = null;
    this.homingCard = null;
    if (this.app) {
      this.app.ticker.remove(this.tick); // сперва глушим цикл, потом рушим сцену
      this.app.destroy({ removeView: true }, { children: true, texture: true }); // removeView убирает канвас из DOM
      this.app = null;
    }
    this.world = null;
    this.tableG = null;
    this.zoneLayer = null;
    this.zoneLabels = {};
    this.slotLabels = {};
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
    this.shoutBox = null;
    this.shoutWord = null;
    this.shoutFires = [];
    this.shout = null;
    this.shadowLayer = null;
    this.deckShadow = null;
    this.cardShadow = null;
    this.deckBody = null;
    this.cardLayer = null;
    this.backTex = null;
    this.shadowTex = null;
    this.faces.clear(); // снимает прогрев и освобождает лицевые текстуры
    this.deckHit = null;
    this.handHit = null;
    this.onDealCard = null;
    this.onDeckFanChange = null;
    this.onDragChange = null;
    this.reject = null;
    this.deckPile.clear();
    this.handPile.clear();
  }

  // ——— внутреннее ———

  // Кадр целиком: физика сабстепами, затем эффекты, затем синхронизация сцены и сон.
  // Каждая фаза — отдельный метод: раньше это была одна простыня на 228 строк, в которой
  // порядок шагов (кто кого перетирает) приходилось вычитывать целиком.
  private onTick(ticker: Ticker): void {
    if (this.destroyed || !this.app) return;
    const frameDt = Math.min(ticker.deltaMS / 1000, 0.05);

    this.stepPhysics(frameDt);
    if (this.idleRunning()) this.idleT += frameDt;
    this.stepFanWiggle(frameDt);
    this.stepDraggedCard();
    this.stepFlipAnim(frameDt);
    this.stepOverlays(frameDt);
    this.syncScene(frameDt);
    this.maybeSleep();
  }

  // Пружины и полёты. Скорость (1х/2х/3х) масштабирует время, поэтому интегрируем
  // сабстепами не крупнее maxStepSec — иначе на 3х пружина «взрывается». Реальный лаг
  // кадра тоже клампим (защита от фризов вкладки).
  private stepPhysics(frameDt: number): void {
    let remaining = frameDt * this.profile.speed;
    do {
      const dt = Math.min(remaining, anim.maxStepSec);
      remaining -= dt;

      if (this.scrambleAnim) this.stepScramble(dt);
      if (this.splashAnim) this.stepSplash(dt);
      this.stepCardFlights(dt);
      this.stepPendingShuffle(dt);
      if (this.shuffleAnim) this.stepShuffleAnim(dt);

      for (const c of this.cards) c.body.step(dt);
      for (const c of this.hand) c.body.step(dt);
    } while (remaining > 0);

    // Карта долетела домой — стопка снова целая (см. topDetached).
    if (this.homingCard && this.homingCard.body.isResting()) {
      this.homingCard = null;
      this.deckBodyCount = -1; // кирпич перерисуется на полное число карт
      this.updateVisibility();
    }
  }

  // Лид-ин кнопочной тасовки доиграл — раскладываем по настоящему порядку.
  private stepPendingShuffle(dt: number): void {
    const ps = this.pendingShuffle;
    if (!ps) return;
    ps.t += dt;
    if (ps.t < ps.delay) return;
    this.pendingShuffle = null;
    const oldOrder = this.cards.map((c) => c.card);
    this.scrambleAnim = null;
    this.applyOrderLocally(ps.order);
    this.startShuffleAnim(oldOrder);
  }

  // Настоящая растасовка: каждая карта летит по своей дуге (см. engine/shufflePose.ts).
  private stepShuffleAnim(dt: number): void {
    const sa = this.shuffleAnim;
    if (!sa) return;
    sa.t += dt;
    for (const e of sa.entries) {
      const p = shuffleProgress(sa.t, e.delay, e.dur);
      if (p < 0) {
        e.v.body.setTarget(e.from); // ждёт своей очереди в каскаде — стоит на месте
        continue;
      }
      e.v.body.setTarget(shufflePose(e, p));
      if (shouldSwapZ(p) && !e.zSwapped) {
        e.v.sprite.zIndex = e.newZ;
        e.zSwapped = true;
      }
    }
    if (sa.t < sa.totalDur) return;
    for (const e of sa.entries) {
      e.v.body.setTarget(e.to);
      e.v.sprite.zIndex = e.newZ;
    }
    this.shuffleAnim = null;
  }

  // «Червячок» тесного веера плюс локальное раскрытие под пальцем/курсором.
  // На просторном веере (мало карт) эффект не включаем — иначе средняя карта «колбасится».
  private stepFanWiggle(frameDt: number): void {
    // Огибающую ховера сглаживаем всегда, чтобы она плавно гасла после увода курсора.
    this.hoverEnv += (this.hoverTarget - this.hoverEnv) * Math.min(1, frameDt * 12);
    if (this.hoverTarget === 0 && this.hoverEnv < 0.002) this.hoverEnv = 0;

    const live = this.liveFan();
    const wantsReveal = this.poke !== null || this.hoverTarget === 1 || this.hoverEnv > 0.001;
    const wiggle =
      live !== null && (this.fanCrowd() > 0 || (wantsReveal && this.fanRevealScaleNow() > 0.001));

    if (wiggle && live) {
      if (!this.fanWiggling) this.fanKickT = 0; // старт — с буста энергии
      const w = anim.fan.wiggle;
      this.fanKickT += frameDt;
      this.fanCrowdNow = this.fanCrowd();
      this.fanEnergy = energyEnvelope(this.fanKickT, w.decayTime, w.boost);
      const baseFreq = this.profile.tilt ? w.freq : w.moderateFreq; // умеренная медленнее
      this.fanWavePhase += baseFreq * this.fanEnergy * frameDt; // быстрее при высокой энергии
      this.fanJitterPhase += w.jitterFreq * this.fanEnergy * frameDt;
      this.stepPoke(frameDt);
      this.applyFanWave(live);
    } else if (this.fanWiggling) {
      // Эффект закончился — оба веера снова ровные.
      this.cards.forEach((c, i) => c.body.setTarget(this.restTarget(i)));
      this.hand.forEach((c, i) => c.body.setTarget(this.handRestTarget(i)));
      this.fanCrowdNow = 0;
      this.poke = null;
      this.hoverTarget = 0;
      this.hoverEnv = 0;
    }
    this.fanWiggling = wiggle;
  }

  // Локальное раскрытие от тыка: точка раскрытия ПЕРЕЕЗЖАЕТ к цели, а не прыгает.
  private stepPoke(frameDt: number): void {
    const p = this.poke;
    if (!p) return;
    const w = anim.fan.wiggle;
    p.t += frameDt;
    const follow = this.cardPress ? w.poke.followDrag : w.poke.follow;
    p.index += (p.target - p.index) * Math.min(1, frameDt * follow);
    if (pokeEnvelope(p.t, w.poke.in, w.poke.hold, w.poke.out) <= 0 && p.t > w.poke.in) {
      this.poke = null;
    }
  }

  // Карта под пальцем каждый кадр едет за ним; веер вокруг неё раступается.
  private stepDraggedCard(): void {
    const d = this.cardDrag;
    if (!d) return;
    if (!this.dealDrag || this.deckFanned) {
      this.applyCardDragTargets();
      return;
    }
    // Раздача со стопки: за пальцем идёт только верхняя карта, кирпич не трогаем.
    d.v.body.setTarget({ x: d.x, y: d.y, rot: 0, scale: DRAG_SCALE });
  }

  // Переворот: у каждой карты своя задержка (стопка идёт волной). Ровно на «ребре»
  // подменяем текстуру — это единственный момент, когда подмену не видно.
  private stepFlipAnim(frameDt: number): void {
    const fa = this.flipAnim;
    if (!fa) return;
    fa.t += frameDt;

    // Порядок колоды реверсится на ПОСЛЕДНЕМ ребре: до него стопка просто крутится,
    // и менять, кто наверху, рано.
    const lastEdge = (fa.halfTurns - 0.5) / fa.halfTurns;
    if (fa.reverseAtEdge && !fa.reversed && fa.t / fa.dur >= lastEdge) {
      fa.reversed = true;
      this.applyOrderLocally([...this.deckCards].reverse());
    }

    let done = true;
    for (const e of fa.entries) {
      const p = (fa.t - e.delay) / fa.dur;
      if (p < 1) done = false;
      // Сторона переключается на КАЖДОМ ребре вращения, а не один раз: полтора оборота —
      // это три ребра, и на каждом карта честно показывает следующую сторону.
      const other = spinShowsOther(spinAngle(clamp01(p), fa.halfTurns));
      if (e.swapped !== other) {
        e.swapped = other;
        e.v.sprite.texture = this.textureFor(e.v.card);
      }
    }
    if (!done) return;
    this.flipAnim = null;
    this.flipMap.clear();
    this.flipByCard.clear();
    this.applyCardTextures(); // теперь показываем ровно то, что говорит состояние
  }

  // Короткоживущие эффекты поверх стола: надпись-объяснение, резиновая тянучка
  // запрещённого жеста и «ударный» отбой.
  private stepOverlays(frameDt: number): void {
    if (this.shout) {
      this.shout.t += frameDt;
      if (this.shout.t >= this.shout.dur) this.shout = null;
    }

    if (this.notice) {
      this.notice.t += frameDt;
      if (this.notice.t >= this.notice.dur) {
        this.notice = null;
        this.setNoticeText(REJECT_TEXT); // вернуть текст по умолчанию
      }
    }

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
  }

  // Перенести состояние движка на сцену: тряска, видимость, счётчики, спрайты, тени.
  private syncScene(frameDt: number): void {
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
    this.syncShout();
  }

  // Клич летит через экран справа налево, дрожа на ходу (поза — в engine/shout.ts).
  private syncShout(): void {
    const box = this.shoutBox;
    if (!box) return;
    if (!this.shout) {
      if (box.visible) box.visible = false;
      return;
    }
    const pose = shoutPose(this.shout.t / this.shout.dur);
    const size = shoutFontSize(this.w, SHOUT_TEXT.length);
    // За краем экрана надпись должна оказаться ЦЕЛИКОМ, иначе на выезде у края повисает
    // хвост из огонька: к полуэкрану добавляем полуширину самой надписи.
    const travel = this.w / 2 + shoutEmojiOffset(size, SHOUT_TEXT.length) * pose.scale;
    box.visible = true;
    box.x = this.w / 2 + pose.x * travel;
    // Чуть выше центра: по центру клич накрыл бы колоду, ради которой всё и затевалось.
    box.y = this.h * 0.4 + pose.shakeY * size;
    box.rotation = pose.rot;
    box.scale.set(pose.scale);
    box.alpha = pose.alpha;
  }

  // Всё осело и ничего не движется → усыпляем цикл. Список активностей — в
  // engine/idleGate.ts: новая непрерывная анимация обязана появиться там, иначе цикл
  // либо уснёт под ней, либо больше не заснёт никогда.
  private maybeSleep(): void {
    if (
      canSleep({
        shuffle: !!this.shuffleAnim,
        scramble: !!this.scrambleAnim,
        splash: !!this.splashAnim,
        pendingShuffle: !!this.pendingShuffle,
        flip: !!this.flipAnim,
        stretch: !!this.stretchAnim,
        notice: !!this.notice,
        shout: !!this.shout,
        reject: !!this.reject,
        flights: this.cardFlights.length,
        cardPress: !!this.cardPress,
        cardDrag: !!this.cardDrag,
        collapseBusy:
          this.collapseReveal !== (this.collapseWantShow ? 1 : 0) ||
          this.deckCollapseReveal !== (this.deckCollapseWantShow ? 1 : 0),
        idle: this.idleRunning(),
        fanWiggle: this.fanWiggling,
        cardsResting: this.cards.every((c) => c.body.isResting()),
        handResting: this.hand.every((c) => c.body.isResting()),
      })
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
    return this.idleEnabled && this.cards.length > 0;
  }

  private syncVisual(c: CardVisual): void {
    let rot = c.body.rotation;
    let scale = this.baseScale * c.body.scaleVal;

    // Лёгкая idle-«дыхалка»: только в покое (не во время растасовки/драга), когда
    // idle разрешён профилем. Наложение поверх пружинного состояния, тело не трогаем.
    if (this.idleEnabled && !this.shuffleAnim && !this.scrambleAnim && !this.reject && c.body.isResting()) {
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
    if (!base || this.shuffleAnim || this.scrambleAnim || !this.profile.shadows) {
      s.visible = false; // при растасовке/сумбуре карты разлетаются — общей тени нет
      return;
    }
    s.visible = true;
    // Приподнятость — ОТНОСИТЕЛЬНО масштаба зоны: в центре колода крупнее сама по себе,
    // и без деления её тень всегда выглядела бы как у поднятой колоды.
    const elev = Math.max(0, base.body.scaleVal / deckScale() - 1);
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
    if (!v || !this.profile.shadows) {
      s.visible = false;
      return;
    }
    s.visible = true;
    const elev = Math.max(0, v.body.scaleVal / deckScale() - 1);
    const off = lightShadowOffset(this.layout.cardH, elev);
    s.x = v.sprite.x + off.dx;
    s.y = v.sprite.y + off.dy;
    s.rotation = v.sprite.rotation;
    s.scale.set(this.baseScale * v.body.scaleVal * 1.05);
    s.alpha = 0.5 + elev * 0.4;
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

  // Прогреть лицевые текстуры заранее, порциями (иначе первый переворот генерил все 52
  // разом и заметно «тупил»). Что именно греть — колода, моя рука и открытые чужие руки.
  private warmFaceTextures(): void {
    if (this.destroyed || !this.app) return;
    const openHands = this.seats.filter((s) => s.handOpen || s.handFanned).flatMap((s) => s.hand);
    this.faces.warm(
      [...this.deckCards, ...this.handCards, ...openHands],
      this.fourColor,
      () => !this.destroyed && !!this.app,
    );
  }

  private faceTexFor(card: string): Texture {
    if (!this.app) return this.backTex!;
    return this.faces.get(card, this.fourColor);
  }

  // Колода лежит лицом вверх? Смотрим по верхней карте: от этого зависит, в какую
  // сторону «растёт» стопка (перевёрнутая пачка смещается зеркально).
  private deckIsFaceUp(): boolean {
    const top = this.cards[this.cards.length - 1];
    return !!top && !!this.facing[top.card];
  }

  // Стрелки «сложить»: рука — всем; колода — только дилеру. Могут быть обе сразу.
  // Раскладка и отрисовка кнопки — в engine/collapseArrow.ts.
  private syncCollapseButton(): void {
    const cardH = this.layout.cardH;
    const handFan = this.fanOpen();
    // Стрелка колоды: только дилер, независимо от фокуса руки.
    const deckFanBtn = this.canDeal && this.deckFanned && this.cards.length > 0;
    this.collapseWantShow = handFan;
    this.deckCollapseWantShow = deckFanBtn;

    if (handFan && this.collapseBtn) {
      const fan = this.handFanGeom();
      this.collapseLayout = layoutCollapseButton(this.layout.handZone.cx, fan, cardH);
      paintCollapseArrow(this.collapseBtn, this.collapseLayout.r);
    }

    if (deckFanBtn && this.deckCollapseBtn) {
      this.deckCollapseLayout = layoutCollapseButton(this.layout.centerZone.cx, this.deckFanGeom(), cardH);
      paintCollapseArrow(this.deckCollapseBtn, this.deckCollapseLayout.r);
    }

    this.applyCollapseReveal();
  }

  // Фаза появления обеих стрелок едет к своей цели; перерисовываем, только если сдвинулась.
  private stepCollapseReveal(dt: number): void {
    const speed = this.profile.speed;
    const hand = stepReveal(this.collapseReveal, this.collapseWantShow, dt, speed);
    const deck = stepReveal(this.deckCollapseReveal, this.deckCollapseWantShow, dt, speed);
    if (hand === this.collapseReveal && deck === this.deckCollapseReveal) return;
    this.collapseReveal = hand;
    this.deckCollapseReveal = deck;
    this.applyCollapseReveal();
  }

  private applyCollapseReveal(): void {
    const cardH = this.layout.cardH;
    applyCollapseReveal(this.collapseBtn, this.collapseLayout, this.collapseReveal, this.collapseWantShow, cardH);
    applyCollapseReveal(
      this.deckCollapseBtn,
      this.deckCollapseLayout,
      this.deckCollapseReveal,
      this.deckCollapseWantShow,
      cardH,
    );
  }

  // Колода всегда в центре стола: стопка либо веер, раскрытый дилером.
  private restTarget(i: number): CardTargets {
    if (this.deckFanned) return this.deckFanTarget(i);
    return this.stackRestTarget(i, this.cards.length);
  }

  // Стопка в центре: count — сколько карт сейчас «лежат» в кирпиче (при драге верхней — n-1).
  private stackRestTarget(i: number, count: number): CardTargets {
    const a = this.layout.deckAnchor;
    const zs = deckScale();
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
    const show = this.handRowMode();
    t.visible = show;
    if (!show) return;
    const z = this.layout.handZone;
    t.text = String(this.handCount);
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
    const show = this.deckCount > 0;
    t.visible = show;
    if (!show) return;
    t.text = String(this.deckCount);
    t.style.fontSize = Math.max(11, Math.min(28, this.rowCounterSpace() * 0.85));
    const a = this.layout.deckAnchor;
    const zs = deckScale();
    const ext = stackExtent(this.deckCount);
    t.x = a.x;
    t.y = a.y + (this.layout.cardH / 2) * zs + ext.h * zs + this.rowCounterSpace() * 0.45;
  }

  // Веер РУКИ (полоса снизу): якорь у верха зоны, провис и кнопка — вниз. Формула целиком
  // в engine/fanGeometry.ts; здесь только подстановка текущего состояния.
  // Колода в центре — своя геометрия (layoutDeckFan / deckFanGeom), якорь = deckAnchor.
  private handFanGeomFor(focused: boolean, count: number): FanGeom {
    // Драг руки допускает более широкий шаг: иначе «дырку» под карту не видно.
    const draggingHand = !!this.cardDrag && this.cardDrag.fromHand;
    return handFanGeom({
      zone: this.layout.handZone,
      cardW: this.layout.cardW,
      cardH: this.layout.cardH,
      count,
      focused,
      dragging: draggingHand,
    });
  }

  private handFanGeom(): FanGeom {
    return this.handFanGeomFor(true, this.handCount);
  }

  // Веер колоды в центре: якорь = якорь стопки (рядом со счётчиком).
  // НЕ fanGeomFor(centerZone) — та формула для руки (якорь у верха полосы), от неё веер
  // улетал на «вышку» при открытии.
  private deckFanGeom(): FanGeom {
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

  private faceTexture(card: string): Texture {
    return this.faceTexFor(card);
  }

  // Какой веер сейчас «живой» для ховера/волны. Колода и рука могут быть открыты вместе:
  // приоритет у того, над которым палец/мышь (deckPointer / press по колоде).
  private liveFan(): "deck" | "hand" | null {
    if (this.shuffleAnim || this.scrambleAnim || this.splashAnim || this.cardDrag) {
      return null;
    }
    {
      const handLive = this.handFocused && this.hand.length > 1;
      // dealDrag без cardDrag — ещё не драг; ховер/peek веера колоды не глушим.
      const deckLive = this.deckFanned && this.deckCount > 1 && !(this.dealDrag && this.cardDrag);
      const onDeck = this.deckPointer || (!!this.cardPress && !this.cardPress.fromHand);
      if (deckLive && onDeck) return "deck";
      if (handLive) return "hand";
      if (deckLive) return "deck";
      return null;
    }
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
    return fanCrowd(this.deckCount, this.deckFanGeom().width, this.layout.cardW, anim.fan.widthFactor, w.gap, w.ramp);
  }

  // Индекс карты веера, ближайшей по x к точке тыка (по текущим позициям спрайтов).
  private nearestFanIndex(x: number): number {
    return nearestIndexByX(this.cards.map((c) => c.sprite.x), x);
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
    if (!this.deckFanned || this.deckCount < 2) return;
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

  // Ховер мышью над веером колоды в центре.
  private onDeckHover(e: FederatedPointerEvent): void {
    if (e.pointerType !== "mouse") return;
    if (!this.deckFanned || this.deckCount < 2) {
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
    if (e.pointerType !== "mouse") return;
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
      live === "hand" ? this.handFanGeom().width : this.deckFanGeom().width;
    const step = fanStep(count, width, anim.fan.widthFactor);
    return fanRevealScale(step, this.layout.cardW, anim.fan.wiggle.gap, anim.fan.maxStepIdle);
  }

  // Бегущая волна + локальный поке: двигает только карты ЖИВОГО веера (колода или рука).
  private applyFanWave(live: "deck" | "hand"): void {
    const stack = live === "hand" ? this.hand : this.cards;
    const n = Math.max(2, stack.length);
    const w = anim.fan.wiggle;
    const waveScale = this.fanCrowdNow * w.amp * this.fanEnergy;
    for (let i = 0; i < stack.length; i++) {
      const wave = waveScale * Math.sin(w.cycles * Math.PI * 2 * (i / (n - 1)) - this.fanWavePhase);
      const vi = Math.max(0, Math.min(n - 1, i + wave + this.pokeShiftAt(i)));
      const t =
        live === "hand" ? this.handFanTarget(vi) : this.deckFanTarget(vi);
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

}
