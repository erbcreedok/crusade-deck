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
import { boardEdgeWidth, computeLayout, type RoomLayout, type LayoutInsets } from "./layout";
import { dropZoneRegions, pickDropTarget, pickDealTarget, pickSeat, type DropZone, type DropTarget } from "./dropZones";
import { layoutSeats, type SeatBox } from "./seatLayout";
import { dragModeFor, type DragMode } from "./dragMode";
import { activeDropZones, type DragSource } from "./dropZoneActivity";
import { dealSourceIndex } from "./topCard";
import type { SeatView } from "./seats";
import { layoutSeatHand, seatCardFaceUp, type SeatHandLayout } from "./seatHand";
import { fanCardScale } from "./deckFan";
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
  pickTopFanCard,
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
  DRAG_SHADOW_LIFT,
  FAN_SHADOW_LIFT,
  FINGER_TOUCH_PX,
  GRAB_SLIVER_CAP,
  TOUCH_GRAB_WIDEN,
  HAND_SHADOW_LIFT,
  SHADOW_ALPHA,
  SHADOW_COLOR,
  SHADOW_LABEL,
  EMOJI_FONT,
  HAND_ID,
  PIXEL_FONT,
  REJECT_TEXT,
  DECK_DROP_REJECT_TEXT,
  SHOUT_COLORS,
  SHOUT_EMOJI,
  SHOUT_TEXT,
  TEX_H,
  TEX_W,
  Z,
  ZERO_SHAKE,
} from "./engine/constants";
import type { BoardPile, ButtonLayout, CardVisual, FanGeom, ShadowLayer, ShufflePose } from "./engine/types";
import { playPile, playPileIndex } from "./engine/boardPile";
import { playStackOffset } from "./playStack";
import { discardHeapExtent, discardHeapPose, discardHeapVisible } from "./discardHeap";
import { CLEAR_PLAY_LABEL, clearPlayButton, hitsClearPlay } from "./engine/clearPlayButton";
import { flattenPlay, type PlaySlot } from "./playFlat";
import { pickPlayCell, playGrid, type PlayGrid } from "./playGrid";
import { playHoverAdjust } from "./playHover";
import { makeCardBackTexture, makeCardFaceTexture, makeShadowTexture } from "./engine/cardTextures";
import { FaceTextureCache } from "./engine/faceTextureCache";
import { handFanGeom } from "./engine/fanGeometry";
import { paintSeats } from "./engine/seatPaint";
import { applyNoticeStyle, paintZones, styleZoneLabels } from "./engine/zonePaint";
import type { TableSlot } from "./engine/zoneChrome";
import { applyCollapseReveal, layoutCollapseButton, paintCollapseArrow, stepReveal } from "./engine/collapseArrow";
import { randomPermutation, scrambleRot, SCRAMBLE_MAX_SEC, SCRAMBLE_RISE, SCRAMBLE_STEP_SEC } from "./engine/scramble";
import { canSleep } from "./engine/idleGate";
import { fanShadowIndices, liftOf, shadowSilhouette, type ShadowCaster } from "./engine/shadowPass";
import { SHOUT_DUR, shoutEmojiOffset, shoutFontSize, shoutPose } from "./engine/shout";
import { TAUNT_COLORS, TAUNT_DUR, TAUNT_TEXT, tauntFontSize, tauntPose, type TauntKind } from "./taunt";
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
  private tauntWord: Text | null = null;
  private shadowLayer: Container | null = null; // слой под картами
  // ОДНА тень на всю колоду (стопка движется как целое). Раньше была тень на карту —
  // на плотной стопке полупрозрачные тени накапливали альфу в тёмное пятно.
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
  // Прокрутка верхней полосы мест: за столом может быть до 32 человек, а экран один.
  // Боковые соседи прокруткой не двигаются — они закреплены (см. seatLayout.ts).
  private seatScrollX = 0;
  private seatScrollMax = 0;
  private seatPan: { startX: number; startScroll: number } | null = null;
  private seatStripHit: Container | null = null;
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
    place: (v, i) => (v.sprite.zIndex = this.pileZ("deck", i)),
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
  // Сброс: сыгранные карты лежат лицом вверх в правом слоте игрового стола. Стопка та же
  // самая по устройству, что колода и рука, — только якорь другой.
  private discardPile = new CardPile({
    create: (card) => this.createCardVisual(card),
    restTarget: (i) => this.discardRestTarget(i),
    place: (v, i) => (v.sprite.zIndex = this.pileZ("discard", i)),
  });
  // ИГРАЛЬНАЯ ЗОНА — средний бокс стола. Стопка ОДНА на всю зону, хотя кучек в ней много:
  // карты развёрнуты в плоский порядок (playFlat), а раскладка переводит номер обратно в
  // «кучка k, j-я снизу» (playGrid). Так зона получает то же, что колода и рука, — спрайты
  // по идентичности карты, а значит переезд карты между кучками играется перелётом.
  private playPile = new CardPile({
    create: (card) => this.createCardVisual(card),
    restTarget: (i) => this.playRestTarget(i),
    place: (v, i) => (v.sprite.zIndex = i),
  });
  /** Состав зоны как его прислал сервер: кучка → карты снизу вверх. */
  private playStacks: string[][] = [];
  /** Место каждой карты зоны, тем же индексом, что и в playPile (см. playFlat). */
  private playSlots: PlaySlot[] = [];
  // Прокрутка зоны. Появляется, только когда кучки перестали влезать даже сжатыми в пол
  // (см. playGrid): сначала мельчаем, и лишь потом листаем.
  private playScroll = 0;
  // На какую кучку сейчас примеривается карта в драге. Кучки лежат плотно, и без ответа
  // стола не видно, попадёшь ты в кучку или начнёшь новую рядом (см. playHover.ts).
  private playHover: number | null = null;
  private layout: RoomLayout = computeLayout(1, 1);
  private w = 1;
  private h = 1;
  private baseScale = 1;

  private fourColor = false; // четырёхцветная колода (♦ оранж, ♣ голубой) для слабовидящих
  private cardBack: CardBackId = DEFAULT_CARD_BACK; // скин рубашки (меню → Графика)
  // Какая стопка ДОСКИ сейчас раскрыта веером — и раскрыта она всегда в одном месте, по
  // центру игровой зоны (layout.boardFanAnchor). Веер один на доску: колода и сброс делят
  // это место, открытие одного закрывает другой. Веер руки живёт отдельно и независимо.
  private boardFan: BoardPile | null = null;
  private canDeal = false; // дилер может раздавать верхнюю карту
  private freeMode = false; // режим свободы: карту со стола тянет каждый себе
  private deckPointer = false; // мышь/палец над веером колоды (для liveFan при двух веерах)
  private selfId: string | null = null; // sessionId владельца клиента — дроп в руку = себе
  // Своё место НЕ в this.seats (RoomScreen вычитает self) — готовность/дилерство кэшируем отдельно.
  private selfReady = false;
  private selfIsDealer = false;
  private onDealCard: ((card: string, to: string) => void) | null = null;
  private onDiscardCard: ((card: string) => void) | null = null;
  private onTakeDiscard: ((card: string) => void) | null = null;
  // Игральная зона. stack === null означает «новой кучкой» — ровно то, что видит игрок,
  // когда роняет карту мимо уже лежащих.
  private onPlayCard: ((card: string, stack: number | null) => void) | null = null;
  private onTakePlay: ((card: string) => void) | null = null;
  private onClearPlay: (() => void) | null = null;
  private onPutToDeck: ((card: string) => void) | null = null;
  private onDeckFanChange: ((open: boolean) => void) | null = null;
  private onBoardFanChange: ((pile: BoardPile | null) => void) | null = null; // тап открывает / стрелка сворачивает
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
  // Кричалка: помимо времени жизни несёт СВОЮ точку-источник. Она берётся один раз, в
  // момент крика, и дальше не пересчитывается — иначе надпись поехала бы вслед за местом,
  // если сосед в этот момент вышел и посадка пересобралась.
  private taunt: { kind: TauntKind; t: number; dur: number; x: number; y: number } | null = null;
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
  private discardCounter: Text | null = null; // счётчик карт под сбросом
  private deckCounter: Text | null = null; // счётчик карт под колодой в центре (стопка и веер)
  private deckHit: Container | null = null;
  private discardHit: Container | null = null; // тап по сбросу раскрывает его веером
  private playHit: Container | null = null; // тап по кучке зоны раскрывает её веером
  private playClearBtn: Container | null = null; // кнопка «В СБРОС», вшитая в бокс зоны

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
    fromHand: boolean; // жест по руке (иначе — по стопке доски)
    pile: BoardPile; // с какой стопки доски начат жест (для руки не используется)
    samples: SwipeSample[]; // короткая история движения — по ней считается скорость свайпа
  } | null = null;
  private cardDrag: {
    id: number;
    v: CardVisual;
    insertAt: number;
    x: number;
    y: number;
    fromHand: boolean; // драг из своей руки, а не со стопки доски
    pile: BoardPile; // с какой стопки доски взята карта
    // Карта взята со СЛОЖЕННОЙ стопки: едет за пальцем одна, соседи не раздвигаются.
    loose: boolean;
    samples: SwipeSample[]; // история движения — по ней ловим бросок вниз
  } | null = null;
  // Слои теней — по одному на высоту сцены (стопки, веер, поднятая карта). В каждом маска
  // из силуэтов и одна заливка сквозь неё, поэтому тени слоя сливаются, а не темнеют.
  private shadowLayers: ShadowLayer[] = [];
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
  /**
   * В ТЕКУЩЕМ жесте карта уже поехала за пальцем. Тап после такого жеста игнорируют все
   * обработчики — и рука, и колода, и сброс, и «тап мимо».
   *
   * Раньше здесь стоял одноразовый флаг: первый же тап его съедал. На тач-экране этого
   * мало — после драга прилетает ещё и синтетический тап (браузер добавляет его к
   * касанию), он доходил до руки и раскрывал веер прямо посреди перетаскивания карты.
   * Признак живёт до СЛЕДУЮЩЕГО нажатия и потому гасит сколько угодно поздних тапов.
   */
  private dragHappened = false;
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
    this.buildTaunt();
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

  // Кричалка — одна надпись, без эмодзи: и «гхх гхх гхх», и «сосааааать» пишутся тем же
  // пиксельным шрифтом, что и весь стол. Текст и цвет ставятся в момент крика (их два
  // вида), поэтому здесь только пустая заготовка.
  private buildTaunt(): void {
    const word = new Text({
      text: "",
      style: { fontFamily: PIXEL_FONT, stroke: { color: 0x000000, width: 8 }, letterSpacing: 3 },
    });
    word.anchor.set(0.5);
    word.visible = false;
    word.zIndex = Z.shout;
    this.tauntWord = word;
    this.world!.addChild(word);
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

  // «Кирпич» колоды и два слоя теней (см. paintShadows).
  private buildShadows(): void {

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

    // Своя хит-зона у сброса: тап по нему раскрывает его веером — там же, по центру доски.
    const discardHit = new Container();
    discardHit.label = "discardHit";
    discardHit.eventMode = "none";
    discardHit.cursor = "pointer";
    discardHit.zIndex = Z.deckHit;
    discardHit.on("pointertap", (e: FederatedPointerEvent) => {
      e.stopPropagation();
      if (this.dragHappened) return;
      this.onBoardFanChange?.("discard");
    });
    this.world!.addChild(discardHit);
    this.discardHit = discardHit;

    // Хит-зона ИГРАЛЬНОЙ ЗОНЫ. Одна на весь бокс, а не по хит-зоне на кучку: кучки
    // появляются и исчезают на ходу, и заводить им контейнеры значило бы вести второй
    // список того же самого. Какая кучка под пальцем — спрашивается у сетки в момент тапа.
    const playHit = new Container();
    // Имена хит-зон: Pixi ими не пользуется, зато в инспекторе сцены и в тестах видно,
    // КТО из четырёх невидимых прямоугольников на этом слое поймал палец.
    playHit.label = "playHit";
    playHit.eventMode = "none";
    playHit.cursor = "pointer";
    playHit.zIndex = Z.deckHit;
    playHit.on("pointerdown", (e: FederatedPointerEvent) => this.onPlayDown(e));
    playHit.on("pointertap", (e: FederatedPointerEvent) => {
      e.stopPropagation();
      if (this.dragHappened) return;
      const { x, y } = e.global;
      // Кнопка «В СБРОС» лежит внутри бокса и перехватывает тап первой.
      if (this.playClearVisible() && hitsClearPlay(clearPlayButton(this.layout.centerZone, this.layout.cardH), x, y)) {
        this.onClearPlay?.();
        return;
      }
      const stack = pickPlayCell(this.playGridNow(), x, y);
      if (stack !== null) this.onBoardFanChange?.(playPile(stack));
    });
    this.world!.addChild(playHit);
    this.playHit = playHit;

    this.positionDeckHit();

    // Стрелки «сложить»: рука — любому; колода на столе — только дилеру (syncCollapseButton).
    this.collapseBtn = this.makeCollapseButton(() => this.onFanCollapse?.());
    this.collapseBtn.label = "handCollapse";
    // Стрелка живёт только в раздаче (см. syncCollapseButton), поэтому сворачивает именно
    // дилерский веер колоды. В игре её нет — там веер закрывается тапом.
    this.deckCollapseBtn = this.makeCollapseButton(() => this.onDeckFanChange?.(false));
    this.deckCollapseBtn.label = "deckCollapse";

    this.handCounter = this.makeCounterText();
    this.deckCounter = this.makeCounterText();
    this.discardCounter = this.makeCounterText();
    this.playClearBtn = this.makePlayClearButton();
    this.syncCollapseButton();
    this.syncDeckCounter();
    this.syncDiscardCounter();

    // Полоса мест прокручивается пальцем, когда людей больше, чем влезает. Отдельная
    // хит-зона, а не общий жест сцены: полоса живёт над столом, и её протяжка не должна
    // ни начинать драг колоды, ни считаться свайпом по вееру.
    const stripHit = new Container();
    stripHit.eventMode = "none";
    stripHit.cursor = "grab";
    stripHit.zIndex = Z.deckHit;
    stripHit.on("pointerdown", (e: FederatedPointerEvent) => {
      e.stopPropagation();
      this.seatPan = { startX: e.global.x, startScroll: this.seatScrollX };
    });
    stripHit.on("pointermove", (e: FederatedPointerEvent) => {
      if (!this.seatPan) return;
      this.setSeatScroll(this.seatPan.startScroll - (e.global.x - this.seatPan.startX));
    });
    const endPan = () => {
      this.seatPan = null;
    };
    stripHit.on("pointerup", endPan);
    stripHit.on("pointerupoutside", endPan);
    this.world!.addChild(stripHit);
    this.seatStripHit = stripHit;
    this.positionSeatStripHit();

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
    // Нажатие всплывает до сцены с любой хит-зоны — значит здесь виден старт ЛЮБОГО
    // жеста, и это единственное место, где нужно снимать признак драга.
    app.stage.on("pointerdown", () => {
      this.dragHappened = false;
    });
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
      // Тап, которым закончился настоящий драг, — не «тап по пустому месту». Pixi шлёт его
      // на общего предка (сцену), когда палец нажали на карте, а отпустили мимо неё, и без
      // этой проверки любой драг снимал бы фокус руки, то есть складывал веер.
      if (this.dragHappened) return;
      // Жест начался на колоде, а палец отпустили мимо зоны — тоже не пустое место.
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
  private get discardCards(): CardVisual[] {
    return this.discardPile.cards;
  }
  /** Колода раскрыта веером (в раздаче это общий дилерский веер, в игре — личный). */
  private get deckFanned(): boolean {
    return this.boardFan === "deck";
  }

  /** Карты стопки доски по её имени. */
  private pileCards(pile: BoardPile): CardVisual[] {
    const play = playPileIndex(pile);
    if (play !== null) return this.playCards.filter((_, i) => this.playSlots[i]?.stack === play);
    return pile === "discard" ? this.discardCards : this.cards;
  }

  /** Карты той стопки, что сейчас лежит веером на доске. По умолчанию — колода. */
  private get fanCards(): CardVisual[] {
    return this.boardFan ? this.pileCards(this.boardFan) : this.cards;
  }

  private get fanCount(): number {
    if (!this.boardFan || this.boardFan === "deck") return this.deckCount;
    return this.pileCards(this.boardFan).length;
  }

  /** Масштаб собранных стопок доски: в игре они обычного размера, в раздаче — крупнее. */
  private pileScale(): number {
    return deckScale(this.freeMode);
  }

  /** База z-порядка стопки доски: раскрытый веер поднимается над всем столом. */
  private pileZBase(pile: BoardPile): number {
    return this.boardFan === pile ? Z.boardFan : 0;
  }

  /**
   * z-порядок карты номер i в стопке доски. ВСЕГДА через это, никогда голым индексом.
   *
   * Раскрытый веер живёт на Z.boardFan (3000+), а его тень — слоем ниже, на Z.boardFan−1.
   * Любое место, которое ставило карте просто `i`, роняло её на z ≈ 0 — под собственную
   * тень, и веер оказывался ею закрашен. Ровно так ломались тени после тасовки, реордера,
   * сумбура и выплеска: каждый из них раскладывал карты по-своему и своим же голым
   * индексом. База берётся В МОМЕНТ ПРИМЕНЕНИЯ, а не запоминается заранее: веер могут
   * свернуть посреди анимации, и замороженная база пережила бы сворачивание.
   */
  private pileZ(pile: BoardPile, i: number): number {
    return this.pileZBase(pile) + i;
  }

  /**
   * Разложить стопки доски по слоям: раскрытая — сверху, собранная — на своём месте.
   *
   * Карту, которую держит палец, не трогаем: она уже поднята на самый верх (Z.draggedCard),
   * и вернуть её в слой стопки значило бы уронить её ПОД собственную тень — та лежит на
   * слой ниже поднятой карты, а не ниже стопки.
   */
  private applyPileZ(): void {
    const held = this.cardDrag?.v ?? this.rejectCard;
    this.cards.forEach((c, i) => {
      if (c !== held) c.sprite.zIndex = this.pileZBase("deck") + i;
    });
    this.discardCards.forEach((c, i) => {
      if (c !== held) c.sprite.zIndex = this.pileZBase("discard") + i;
    });
  }

  private get deckCount(): number {
    return this.deckPile.count;
  }
  private get handCount(): number {
    return this.handPile.count;
  }

  // Счётчик карт под стопкой (их два — под рукой и под колодой, различие только в позиции).
  /**
   * Кнопка «В СБРОС» в боксе зоны: подложка + надпись. Своей хит-зоны у неё нет — палец
   * ловит хит-зона всего бокса и первым делом спрашивает у кнопки, не в неё ли попали
   * (см. playHit). Иначе кнопка перекрывала бы сетку и тап «мимо кучек» рядом с ней
   * переставал бы создавать новую кучку.
   */
  private makePlayClearButton(): Container {
    const box = new Container();
    box.zIndex = Z.counters;
    box.eventMode = "none";
    box.visible = false;
    box.addChild(new Graphics());
    const t = new Text({
      text: CLEAR_PLAY_LABEL,
      style: { fontFamily: PIXEL_FONT, fontSize: 16, fill: COLORS.ink, letterSpacing: 1 },
    });
    t.anchor.set(0.5);
    t.eventMode = "none";
    box.addChild(t);
    this.world!.addChild(box);
    return box;
  }

  private syncPlayClearButton(): void {
    const box = this.playClearBtn;
    if (!box) return;
    const show = this.playClearVisible();
    box.visible = show;
    if (!show) return;
    const b = clearPlayButton(this.layout.centerZone, this.layout.cardH);
    const g = box.children[0] as Graphics;
    const t = box.children[1] as Text;
    g.clear();
    g.roundRect(b.cx - b.w / 2, b.cy - b.h / 2, b.w, b.h, b.r).fill({ color: COLORS.gold, alpha: 0.85 });
    t.style.fontSize = b.fontSize;
    t.x = b.cx;
    t.y = b.cy;
  }

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
        c.sprite.zIndex = this.pileZBase("deck") + i;
        c.body.setTarget(this.restTarget(i));
      });
    } else if (sameSet && changed && shouldPlay(anim.priority.shuffle, this.profile)) {
      this.scrambleAnim = null; // сумбур закончился — оседаем в реальный порядок
      this.startShuffleAnim(oldOrder);
    } else if (sameSet && !changed) {
      // Порядок ровно тот же — это эхо нашего же оптимистичного реордера (драг карты).
      // Ничего не двигаем: карта как раз доезжает пружиной в новый слот.
    } else if (!this.shuffleAnim && !this.scrambleAnim && !this.cardDrag) {
      // В стопке телепорт незаметен (карты лежат друг на друге), а раскрытый веер обязан
      // ПЕРЕСОБИРАТЬСЯ на глазах: пока он открыт, соседи тянут из него карты.
      this.cards.forEach((c, i) => {
        if (this.deckFanned) c.body.setTarget(this.restTarget(i));
        else c.body.snapTo(this.restTarget(i));
        c.sprite.zIndex = this.pileZBase("deck") + i;
      });
    }

    this.applyCardTextures();
    this.updateVisibility();
    this.cards.forEach((c) => this.syncVisual(c));
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
      // Одно правило на все раскладки руки: z растёт слева направо, правая карта сверху.
      // Раньше шеренга разворачивала порядок (length - i), а layoutHand — нет, и наложение
      // «ломалось» в зависимости от того, какой путь тронул карты последним.
      c.sprite.zIndex = Z.handCards + i;
      c.sprite.texture = this.faceTexture(c.card); // свою руку владелец видит всегда
      c.sprite.visible = true;
    });
    this.syncHandCounter();
    this.syncCollapseButton();
    this.positionHandHit();
    this.warmFaceTextures();
    this.wake();
  }

  /** Сброс с сервера: сыгранные карты. Лежат лицом вверх в своём слоте. */
  setDiscard(cards: string[]): void {
    const order = dedupeDeckOrder(cards).slice(0, 52);
    if (!this.cardLayer || !this.backTex) {
      this.discardPile.remember(order);
      return;
    }
    this.discardPile.reconcile(order);
    this.discardCards.forEach((c, i) => {
      c.body.snapTo(this.discardRestTarget(i));
      c.sprite.alpha = 1;
    });
    this.syncDiscardVisibility(); // она же расставит стороны: в покое горка лежит рубашкой
    this.syncDiscardCounter();
    this.wake();
  }

  /**
   * Игральная зона с сервера: список кучек. Приезжает целиком на каждое изменение —
   * зона короткая, а diff по кучкам стоил бы ровно тех багов с индексами, ради которых
   * на сервере зона тоже переписывается целиком.
   */
  setPlay(stacks: string[][]): void {
    this.playStacks = stacks.map((s) => [...s]);
    const flat = flattenPlay(this.playStacks);
    this.playSlots = flat.slots;
    if (!this.cardLayer || !this.backTex) {
      this.playPile.remember(flat.order);
      return;
    }
    // Веер мог остаться раскрытым на кучке, которую только что смахнули в сброс или
    // разобрали по рукам. Раскрытой «пустоты» не бывает — сворачиваем сами, не дожидаясь
    // React: тот узнает об этом тем же колбэком, что и при тапе по стрелке.
    const fanned = playPileIndex(this.boardFan);
    if (fanned !== null && !this.playStacks[fanned]?.length) {
      this.boardFan = null;
      this.onBoardFanChange?.(null);
    }
    this.playPile.reconcile(flat.order);
    this.playCards.forEach((c, i) => {
      c.body.snapTo(this.playRestTarget(i));
      c.sprite.texture = this.faceTexture(c.card); // выложенную карту видят все
      c.sprite.alpha = 1;
    });
    this.syncPlayVisibility();
    this.drawZones();
    this.wake();
  }

  private get playCards(): CardVisual[] {
    return this.playPile.cards;
  }

  /**
   * На какую кучку примеривается карта в драге. Кучки едут к новым местам ПРУЖИНОЙ, а не
   * прыжком: подъём и отступ должны читаться как реакция стола, а не как подмена кадра.
   */
  private setPlayHover(stack: number | null): void {
    if (stack === this.playHover) return;
    this.playHover = stack;
    this.playCards.forEach((c, i) => c.body.setTarget(this.playRestTarget(i)));
    this.wake();
  }

  /**
   * Куда целится карта, которую сейчас тащат: индекс кучки под пальцем или null — «мимо
   * всех, будет новая». Считается только для чужой карты в игре: своя рука и раздача к
   * зоне отношения не имеют.
   */
  private aimPlayHover(x: number, y: number): void {
    if (!this.freeMode || !this.cardDrag?.fromHand) return this.setPlayHover(null);
    const zone = pickDropTarget(x, y, this.layout)?.zone;
    this.setPlayHover(zone === "center" ? pickPlayCell(this.playGridNow(), x, y) : null);
  }

  /** Сетка зоны на текущую раскладку. Дёшево и без состояния — считается по месту. */
  private playGridNow(): PlayGrid {
    return playGrid(
      this.layout.centerZone,
      this.layout.cardW,
      this.layout.cardH,
      this.playStacks.length,
      this.playScroll,
    );
  }

  /**
   * Где лежит карта зоны с плоским номером i: своя кучка в сетке, внутри кучки — обычная
   * стопка (та же geometry, что у колоды и сброса). Раскрытая кучка уезжает в общий веер
   * доски, как это делают колода и сброс.
   */
  private playRestTarget(i: number): CardTargets {
    const slot = this.playSlots[i];
    const grid = this.playGridNow();
    if (!slot || !grid.cells[slot.stack]) return { x: -9999, y: -9999, rot: 0, scale: this.pileScale() };
    if (this.boardFan === playPile(slot.stack)) return this.deckFanTarget(slot.within);
    const cell = grid.cells[slot.stack]!;
    // Масштаб карты в зоне задаёт сетка: чем больше кучек, тем мельче карта (см. playGrid).
    // Поверх неё ложится ответ стола на драг: наведённая кучка приподнята, соседи отступили.
    const hov = playHoverAdjust(grid, this.playHover, slot.stack);
    const zs = (grid.cardW / this.layout.cardW) * hov.scale;
    // Разъезд кучки — свой (playStack.ts), в долях карты: колодная геометрия здесь не
    // годится, она про толщину пачки, а кучке нужно показать, что лежит на дне.
    const so = playStackOffset(slot.within, slot.of);
    return {
      x: cell.cx + hov.dx + so.dx * this.layout.cardW * zs,
      y: cell.cy + hov.dy + so.dy * this.layout.cardH * zs,
      rot: this.restJitter[i] ?? 0,
      scale: zs,
    };
  }

  /**
   * Кучка зоны показывает ВСЕ свои карты, в отличие от колоды и сброса.
   *
   * У тех видна только верхушка, и это правильно: они про «сколько там осталось». Кучка
   * же разъезжается веером-лесенкой (playStack.ts) — задние торчат из-под передней, а
   * нижняя выпирает углом. Прятать их значило бы рисовать разъезд, которого не видно.
   * Карт в кучке единицы, так что спрайты тут не экономим.
   *
   * z-порядок обратный номеру: нижняя карта (within = 0) выпирает ВПРАВО-ВНИЗ и обязана
   * лежать под всеми — иначе её выступающий угол накрыл бы соседей сверху.
   */
  private syncPlayVisibility(): void {
    const held = this.cardDrag?.v ?? this.rejectCard;
    this.playCards.forEach((c, i) => {
      const slot = this.playSlots[i];
      if (!slot) return;
      c.sprite.visible = true;
      if (c !== held) c.sprite.zIndex = this.pileZBase(playPile(slot.stack)) + slot.within;
    });
  }

  /** Какую стопку доски держать раскрытой: "deck", "discard" или ничего. */
  setBoardFan(pile: BoardPile | null): void {
    if (pile === this.boardFan) return;
    const was = this.boardFan;
    this.boardFan = pile;
    // Прежний веер собирается обратно в свой слот, новый — разъезжается по центру.
    if (was === "discard" || pile === "discard") {
      this.discardCards.forEach((c, i) => c.body.setTarget(this.discardRestTarget(i)));
      // Сторона сброса зависит от веера: горка лежит рубашкой, раскрытый веер — лицами.
      this.syncDiscardVisibility();
    }
    // Кучки зоны пересчитываем всегда: разъезжается одна, но собраться обратно должна
    // ровно та, что была раскрыта до этого.
    if (playPileIndex(was) !== null || playPileIndex(pile) !== null) {
      this.playCards.forEach((c, i) => c.body.setTarget(this.playRestTarget(i)));
      this.syncPlayVisibility();
    }
    this.syncDiscardCounter();
    this.cards.forEach((c, i) => c.body.setTarget(this.restTarget(i)));
    this.applyPileZ();
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
    this.discardCards.forEach((c, i) => c.body.snapTo(this.discardRestTarget(i)));
    if (this.deckHit) this.deckHit.cursor = this.deckCursor();
    this.positionDeckHit();
    this.positionHandHit();
    this.syncDeckCounter();
    this.syncDiscardCounter();
    this.syncCollapseButton();
    this.drawZones();
    // Места перерисовываем вместе со сменой режима: в игре с них пропадает счётчик карт,
    // и без этого он висел бы до следующей чужой перерисовки (чей-то «Готов», ресайз).
    this.drawSeats();
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

  /** Карту из руки скинули в сброс (React шлёт discard_card на сервер). */
  setOnDiscardCard(fn: ((card: string) => void) | null): void {
    this.onDiscardCard = fn;
  }

  /** Карту забрали ИЗ сброса себе в руку (React шлёт take_discard). */
  setOnTakeDiscard(fn: ((card: string) => void) | null): void {
    this.onTakeDiscard = fn;
  }

  /** Карту из руки выложили в игральную зону; stack === null — новой кучкой. */
  setOnPlayCard(fn: ((card: string, stack: number | null) => void) | null): void {
    this.onPlayCard = fn;
  }

  /** Карту забрали ИЗ игральной зоны себе в руку. */
  setOnTakePlay(fn: ((card: string) => void) | null): void {
    this.onTakePlay = fn;
  }

  /** Кнопка «В СБРОС» в боксе зоны: вся зона уезжает в сброс. */
  setOnClearPlay(fn: (() => void) | null): void {
    this.onClearPlay = fn;
  }

  /**
   * Куда визуально летит карта, брошенная в зону: в ячейку своей кучки, а не в центр
   * бокса. Полёт с пальца начинается ДО ответа сервера, и промах мимо будущего места
   * читался бы как рывок, когда приедет настоящее состояние.
   */
  private playDropRect(stack: number | null): { cx: number; cy: number } {
    const grid = this.playGridNow();
    const cell = stack === null ? grid.addCell : (grid.cells[stack] ?? grid.addCell);
    return { cx: cell.cx, cy: cell.cy };
  }

  /** Карту из руки вернули в колоду — так можно только в раздаче (put_card_to_deck). */
  setOnPutToDeck(fn: ((card: string) => void) | null): void {
    this.onPutToDeck = fn;
  }

  setOnDeckFanChange(fn: ((open: boolean) => void) | null): void {
    this.onDeckFanChange = fn;
  }

  /** Игрок раскрыл/свернул веер доски (в игре он личный — наружу не рассылается). */
  setOnBoardFanChange(fn: ((pile: BoardPile | null) => void) | null): void {
    this.onBoardFanChange = fn;
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

  // Сдвинуть полосу мест. Клампится по факту раскладки: за край списка не уводим,
  // иначе полоса «улетает» в пустоту и вернуть её нечем.
  private setSeatScroll(px: number): void {
    const next = Math.max(0, Math.min(this.seatScrollMax, px));
    if (next === this.seatScrollX) return;
    this.seatScrollX = next;
    this.applySeats();
  }

  private positionSeatStripHit(): void {
    const hit = this.seatStripHit;
    if (!hit) return;
    // Полоса ловит пальцы, только когда её действительно есть куда крутить.
    if (this.seatScrollMax <= 0 || this.seatInsets.top <= 0) {
      hit.eventMode = "none";
      hit.hitArea = new Rectangle(0, 0, 0, 0);
      return;
    }
    hit.eventMode = "static";
    hit.hitArea = new Rectangle(0, 0, this.w, this.seatInsets.top);
  }

  private applySeats(): void {
    const placed = layoutSeats(
      this.seats.map((s) => s.id),
      this.w,
      this.h,
      {
        topOffset: this.topInset,
        scrollX: this.seatScrollX,
        // Место соседа занимает всю полосу от края экрана до внешнего края слота колоды:
        // сосед и слот под ним читаются как одна колонка (см. layout.boardEdgeWidth).
        sideW: boardEdgeWidth(this.w, this.h, this.bottomInset),
      },
    );
    this.seatBoxes = placed.seats;
    this.seatInsets = placed.insets;
    this.seatScrollMax = placed.topScrollMax;
    this.seatScrollX = Math.min(this.seatScrollX, this.seatScrollMax);
    this.positionSeatStripHit();
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
    const scale = this.pileScale();
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
      inGame: this.freeMode,
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
    // Что вообще можно делать этим нажатием, решает dragMode.ts.
    const mode = this.dragMode();
    if (mode === "none") return;

    if (this.cardPress || this.cardDrag) return;
    // Пусто именно в ТОЙ стопке, с которой сейчас работает палец: колода может быть
    // разобрана до нуля, а веер сброса — раскрыт, и тянуть из него по-прежнему можно.
    if (this.fanCards.length === 0 && mode !== "card") return;
    // topCard — раздача со стопки/веера: тащим верхнюю (или ту, что под пальцем).
    // peek — не-дилер на открытом вееере: только глиссандо и тык, без драга и тасовки.
    // card — рука в фокусе: жест относится к КАРТЕ. Зажатый веер не таскаем, пока карта
    //        не показала достаточную полоску (canGrabAt) — но палец не игнорируем:
    //        ведение раскрывает веер под пальцем, и в открытый зазор карту уже можно взять.
    // Захват берёт ВЕРХНЮЮ карту под пальцем (на стыке — правую), а не ближайшую по центру.
    const nearest = this.pickFanGrab(this.fanCards, e);
    // В свободе любой драг с колоды — это взятие карты себе: со стопки уходит верхняя,
    // из веера — та, что под пальцем (mode === "card").
    this.dealDrag = mode === "topCard" || (this.freeMode && mode === "card");
    if (mode !== "card") this.deckPointer = true;
    this.cardPress = {
      id: e.pointerId,
      ...this.pressPoint(e),
      // Стопка отдаёт верхнюю карту, раскрытый веер — ту, что под пальцем. В свободе
      // раскрытый веер приходит сюда уже как mode === "card", то есть по второй ветке.
      index: mode === "topCard" ? dealSourceIndex(this.fanCards.length, !!this.boardFan, nearest) : nearest,
      canGrab: mode === "topCard" ? true : mode === "peek" ? false : this.canGrabAt(nearest),
      fromHand: false,
      pile: this.boardFan ?? "deck", // жест по доске относится к раскрытой стопке
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

  // Отмена драга: вернуть карту домой — и всё. Раскладку стола она не трогает: веер руки
  // и веер колоды независимы и живут, пока игрок не свернёт их САМ (стрелкой, свайпом
  // вниз или тапом мимо). Раньше отсюда дёргался onFanCollapse, и любой прерванный жест
  // складывал руку побочным эффектом.
  private cancelCardDrag(dragged: CardVisual): void {
    this.cardDrag = null;
    this.hoverZone = null;
    this.setPlayHover(null);
    this.returnCardHome(dragged);
    this.drawZones();
    this.onDragChange?.(false);
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

    if (this.cardDrag && this.boardFan === this.cardDrag.pile) {
      // Раскрытый веер доски (колода/сброс/зона) раступается перед картой (дырка по x).
      if (this.inDeckFanArea(x, y)) this.cardDrag.insertAt = this.insertDeckIndexAt(x);
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
    // Карта из СЛОЖЕННОЙ руки просто едет за пальцем: шеренга стоит как стояла, ей нечего
    // раздвигать, а перестановка в сложенной руке лишена смысла.
    if (d.loose) {
      d.v.body.setTarget({ x, y, rot: 0, scale: DRAG_SCALE });
      this.hoverZone = pickDropTarget(x, y, this.layout);
      this.aimPlayHover(x, y);
      this.drawZones();
      return;
    }
    d.insertAt = d.fromHand ? this.insertHandIndexAt(x) : this.insertDeckIndexAt(x);
    this.hoverZone = pickDropTarget(x, y, this.layout);
    this.aimPlayHover(x, y);
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
      // Сворачивать нечего, пока рука сложена: там свайп вниз — это драг верхней карты.
      canCollapse: this.handFocused,
      dealDrag: this.dealDrag,
      canGrab: p.canGrab,
      swipeable: this.fanOpen() && this.deckCount >= 2,
      canShuffle: this.canDeal,
    });

    switch (intent) {
      case "wait":
        return;
      case "deal":
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
        // Глиссандо — это жест, а не тап: гасим тап, иначе на pointerup веер доски в игре
        // свернулся бы (handleDeckTap toggle), едва его раздвинули.
        this.dragHappened = true;
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

  /**
   * Кричалка: игрок нажал кнопку, и это слышит весь стол — включая его самого.
   *
   * Разница между видами вся в том, ОТКУДА надпись идёт. «Гхх» — личная: она вылетает из
   * места того, кто крикнул, а себе — снизу, из своей полосы руки (своего места на столе
   * нет, оно и есть рука). «Сосать» — общая: у неё источника нет, всем одинаково по центру.
   */
  playTaunt(kind: TauntKind, from: string): void {
    if (this.destroyed) return;
    const at = kind === "suck" ? null : this.tauntSource(from);
    this.taunt = {
      kind,
      t: 0,
      dur: TAUNT_DUR[kind],
      x: at?.x ?? this.w / 2,
      // Центр экрана чуть выше середины: ровно по центру надпись накрыла бы колоду.
      y: at?.y ?? this.h * 0.42,
    };
    this.wake();
  }

  // Откуда кричат: своя полоса руки, место соседа или — если крикнувший уже вышел и
  // места под ним нет — центр стола.
  private tauntSource(from: string): { x: number; y: number } | null {
    if (from === this.selfId) return { x: this.layout.handAnchor.x, y: this.layout.handZone.cy };
    const box = this.seatBox(from);
    return box ? { x: box.rect.cx, y: box.rect.cy } : null;
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
      // Смещение счётчика — только у настоящего МЕСТА соседа (схема уже +1, но призрак ещё
      // летит). Для сброса/зоны/колоды места нет — bias там ни к чему.
      const seatBiasId = !toSelf && this.seatBoxes.some((b) => b.id === m.to) ? m.to : null;
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

  /**
   * Карта уходит ИЗ РУКИ в сброс: призрак летит с пальца в слот, а сама карта покидает
   * руку сразу — по той же причине, что и у колоды (см. flyCardOff): пока она числится в
   * стопке, веер руки продолжает держать под неё место.
   */
  flyHandCardOff(card: string, from: FlightPoint, to: { cx: number; cy: number } | null): void {
    if (this.destroyed) return;
    if (to) {
      this.enqueueCardFlight({
        card,
        from,
        to: { x: to.cx, y: to.cy, rot: 0 },
        faceUp: true, // сыгранную карту видно всем
        delay: 0,
        toSelf: false,
        seatBiasId: null,
        seatBias: 0,
      });
    }
    this.setHand(withoutCard(this.handCards, card));
  }

  /**
   * Карта уходит ИЗ СБРОСА в руку: то же самое, что flyCardOff у колоды, только стопка
   * другая. Уходит сразу, не дожидаясь эха, иначе веер сброса продолжал бы держать место.
   */
  flyDiscardCardOff(card: string, from: FlightPoint, toId: string): void {
    if (this.destroyed) return;
    this.playDealFlight(card, from, toId);
    this.setDiscard(withoutCard(this.discardPile.order, card));
  }

  /**
   * Карта уходит ИЗ ИГРАЛЬНОЙ ЗОНЫ в руку. Кучку правим локально, не дожидаясь эха: иначе
   * раскрытый веер кучки продолжал бы держать место карты, которая уже улетела с пальца.
   * Опустевшая кучка исчезает здесь так же, как на сервере, — иначе сетка на мгновение
   * показала бы пустую ячейку и все остальные кучки дёрнулись бы на место.
   */
  flyPlayCardOff(card: string, from: FlightPoint, toId: string): void {
    if (this.destroyed) return;
    this.playDealFlight(card, from, toId);
    this.setPlay(this.playStacks.map((s) => s.filter((c) => c !== card)).filter((s) => s.length > 0));
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
    // Сброс и игральная зона — свои якоря. Раньше их тут НЕ БЫЛО, и любой card_moved с
    // from/to = "discard"/"play" сваливался в дефолт (якорь колоды): карта из стека зоны
    // летела «от колоды», а «В СБРОС» (play→discard) давал колода→колода и дёргал стопку.
    if (pile === "discard") {
      const slot = this.layout.discardSlot;
      if (slot) return { x: slot.cx, y: slot.cy, rot: 0 };
      const z = this.layout.centerZone;
      return { x: z.cx, y: z.cy, rot: 0 };
    }
    if (pile === "play" || pile.startsWith("play:")) {
      const a = this.layout.boardFanAnchor;
      return { x: a.x, y: a.y, rot: 0 };
    }
    if (pile === this.selfId) {
      const a = this.layout.handAnchor;
      return { x: a.x, y: a.y, rot: 0 };
    }
    const box = this.seatBoxes.find((b) => b.id === pile);
    if (box) return { x: box.rect.cx, y: box.rect.cy, rot: 0 };
    // Неизвестное место — центр стола, а НЕ колода: карта из ниоткуда пусть летит из
    // центра, а не тревожит колоду.
    const z = this.layout.centerZone;
    return { x: z.cx, y: z.cy, rot: 0 };
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
      // Раскрыт ЛЮБОЙ веер доски — карту берут под пальцем, а не «сверху стопки».
      deckFanned: !!this.boardFan,
      freeMode: this.freeMode,
    });
  }

  /**
   * Минимальная видимая полоска карты, при которой её можно ВЫТЯНУТЬ. Порог — размер
   * пальца (FINGER_TOUCH_PX), но не больше доли карты: см. константы. Пока полоска у́же —
   * драг не начинается, сначала глиссандо/тык раздвигают веер под пальцем.
   */
  private grabSliverPx(): number {
    return Math.min(FINGER_TOUCH_PX, this.layout.cardW * GRAB_SLIVER_CAP);
  }

  // Достаточно ли видна карта веера ДОСКИ, чтобы её взять. По фактическим x спрайтов: в
  // зажатом вееере полоска — пара пикселей, тащить нечего, сначала раздвинь тыком/ховером.
  private canGrabAt(index: number): boolean {
    return visibleSliver(this.fanCards.map((c) => c.sprite.x), index) >= this.grabSliverPx();
  }

  // То же для веера СВОЕЙ руки — стопка другая, а правило одно: у́же пальца не вытянуть.
  private canGrabHandAt(index: number): boolean {
    return visibleSliver(this.hand.map((c) => c.sprite.x), index) >= this.grabSliverPx();
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
      Math.max(1, this.fanCount),
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
    // Откуда карта — знает САМО нажатие. Раньше это выводили из фокуса руки, и жест по
    // сложенной руке уходил за картой в колоду: фокуса нет — значит «не рука».
    const fromHand = p.fromHand && !this.dealDrag;
    const stack = fromHand ? this.hand : this.pileCards(p.pile);
    if (stack.length === 0) return;
    const v = stack[Math.max(0, Math.min(stack.length - 1, p.index))]!;
    this.cardPress = null;
    this.poke = null;
    this.hoverTarget = 0;
    this.dragHappened = true; // с этого мига поздние тапы жеста игнорируются
    this.cardDrag = {
      id: p.id,
      v,
      insertAt: fromHand ? p.index : this.dealDrag ? p.index : this.insertDeckIndexAt(p.x),
      x: p.x,
      y: p.y,
      fromHand,
      pile: p.pile,
      loose: fromHand && !this.handFocused,
      samples: [{ x: p.x, y: p.y, t: performance.now() }],
    };
    v.sprite.zIndex = 100_000;
    if (this.deckHit) this.deckHit.cursor = "grabbing";
    if (this.dealDrag) {
      // Что делать с ОСТАВШИМИСЯ картами той стопки, откуда ушла карта.
      //
      // Смотрим на стопку ЖЕСТА, а не на «раскрыт ли веер колоды»: раньше здесь стояло
      // !this.deckFanned, и драг из раскрытого веера сброса или кучки зоны (веер-то не
      // колоды) уводил в перекладку КОЛОДУ — она молча пересобиралась как n−1.
      const fanned = this.boardFan === p.pile;
      if (fanned) {
        // Веер: карты раступаются, оставляя дырку под взятой.
        this.applyCardDragTargets();
      } else if (p.pile === "deck") {
        // Стопка колоды: остальные как n−1 на якоре, иначе кирпич уезжает вместе с картой.
        const left = this.cards.length - 1;
        this.cards.forEach((c, i) => {
          if (c === v) return;
          c.body.snapTo(this.stackRestTarget(i, left));
        });
        this.deckBodyCount = -1;
        this.drawDeckBody();
        v.body.setTarget({ x: p.x, y: p.y, rot: 0, scale: DRAG_SCALE });
      } else {
        // Кучка зоны или сброс: кирпича и общего якоря у них нет, остальные карты уже
        // лежат по своим местам — двигать нечего, карта просто уходит с пальцем.
        v.body.setTarget({ x: p.x, y: p.y, rot: 0, scale: DRAG_SCALE });
        this.syncPlayVisibility();
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
    } else if (this.cardDrag.loose) {
      // Свёрнутая рука: тянем ВЕРХНЮЮ карту, остальные лежат как лежали — веер НЕ
      // раскрывается. Ровно как снятие верхней с колоды или кучки зоны: общая механика,
      // раскрытие — это отдельный жест (тап), а не побочный эффект драга.
      this.hoverZone = pickDropTarget(p.x, p.y, this.layout);
      this.aimPlayHover(p.x, p.y);
      v.body.setTarget({ x: p.x, y: p.y, rot: 0, scale: DRAG_SCALE });
      this.drawZones();
    } else {
      this.hoverZone = pickDropTarget(p.x, p.y, this.layout);
      this.aimPlayHover(p.x, p.y);
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
    const stack = d.fromHand ? this.hand : this.pileCards(d.pile);
    const n = stack.length;
    // На просторном веере (мало карт) amp=0: только дырка слота. Иначе сосед улетает
    // за следующую карту (визуально 2_31 вместо превью 213). Сила — по типу веера.
    const amp = fanDragSpreadAmp(sp.amp, this.fanRevealScaleNow()) * this.fanSpreadScale(this.dragFanKind(d));
    let k = 0;
    for (const c of stack) {
      if (c === d.v) continue;
      const slot = k < d.insertAt ? k : k + 1; // пропускаем слот под перетаскиваемую карту
      // Плюс раскрытие вокруг точки вставки: соседи разъезжаются, и видно, между какими
      // именно картами ляжет перетаскиваемая (одной «дырки» в тесном веере не видно).
      // Раздвиг с прибитыми краями: у пивота шире, дальше плотнее, общая ширина та же.
      const spread = amp > 0 ? fanSpreadPinned(slot, n, d.insertAt, sp.cards, amp) : 0;
      const vi = Math.max(0, Math.min(n - 1, slot + spread));
      // Веер руки кладёт карты своей геометрией; веер доски (колода/сброс/зона) — своей.
      const t = d.fromHand ? this.handFanTarget(vi) : this.deckFanTarget(vi);
      // Масштаб — свой веерный (fanCardScale), а НЕ 1: соседи не должны ужиматься, пока
      // тянут карту. Место под неё освобождает раздвиг (fanSpreadPinned), а не сжатие;
      // раньше здесь стояло scale:1, и веер заметно мельчал на старте драга.
      c.body.setTarget({ x: t.x, y: t.y, rot: t.rot, scale: t.scale ?? 1 });
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
    this.hoverZone = null;
    // Ответ стола гаснет ДО того, как карта ляжет: кучки успевают вернуться на свои места
    // ровно тем же движением, каким расступались.
    this.setPlayHover(null);
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
        const from = { x: d.v.sprite.x, y: d.v.sprite.y, rot: d.v.sprite.rotation };
        if (playPileIndex(d.pile) !== null) {
          this.flyPlayCardOff(card, from, seat);
          this.onTakePlay?.(card);
        } else if (d.pile === "discard") {
          this.flyDiscardCardOff(card, from, seat);
          this.onTakeDiscard?.(card);
        } else {
          this.flyCardOff(card, from, seat);
          this.onDealCard?.(card, seat);
        }
      } else if (this.boardFan && this.inDeckFanArea(x, y)) {
        // Дроп обратно в тот же веер. В раздаче дилер так перекладывает карты колоды; в
        // ИГРЕ порядок стопок доски не двигают — карта просто ложится обратно.
        //
        // Молча, без надписи: игрок ничего не нарушил и ничего не потерял — он подвигал
        // карту и отпустил её там же, откуда взял. Ругаться на такое значит ругаться на
        // каждое «передумал», а надпись-отказ должна оставаться редкой, иначе её
        // перестают читать. Отбой с объяснением остаётся там, где действие ОСМЫСЛЕННОЕ,
        // но запрещено (карта в закрытую колоду, раздача не готовому игроку).
        // Правило пока зашито; станет настройкой вместе с правилами игры.
        if (this.freeMode) {
          this.returnCardHome(d.v);
        } else {
          const to = this.insertDeckIndexAt(x);
          this.reorderLocally(d.v.card, to);
          this.alignUnderTouch(x, y);
          this.onCardReorder?.(d.v.card, to);
        }
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

    if (fromHand) {
      const zone = pickDropTarget(x, y, this.layout)?.zone;
      const card = d.v.card;
      const from = { x: d.v.sprite.x, y: d.v.sprite.y, rot: d.v.sprite.rotation };
      const finish = () => {
        this.onDragChange?.(false);
        this.drawZones();
        this.positionDeckHit();
        this.wake();
      };

      // Сброс принимает карту всегда — и собранный, и раскрытый веером: слот на месте
      // в обоих случаях. Зона есть только в игре (см. layout.discardSlot).
      if (zone === "discard" || (this.boardFan === "discard" && this.inDeckFanArea(x, y))) {
        this.flyHandCardOff(card, from, this.layout.discardSlot);
        this.onDiscardCard?.(card);
        finish();
        return;
      }
      // Колода в ИГРЕ закрыта: бокс на столе есть, но карты не принимает — отбой с
      // объяснением, а не молчаливый возврат.
      if (zone === "deck") {
        this.startCardReject(d.v, x, y, DECK_DROP_REJECT_TEXT);
        finish();
        return;
      }
      // В ИГРЕ центр стола — ИГРАЛЬНАЯ ЗОНА. Куда именно легла карта, решает сетка:
      // попала на кучку — доливается в неё, мимо всех — начинает новую.
      if (this.freeMode && zone === "center") {
        const stack = pickPlayCell(this.playGridNow(), x, y);
        this.flyHandCardOff(card, from, this.playDropRect(stack));
        this.onPlayCard?.(card, stack);
        finish();
        return;
      }
      // В РАЗДАЧЕ центр стола — место колоды: брошенная туда карта возвращается в неё.
      if (!this.freeMode && zone === "center") {
        this.flyHandCardOff(card, from, { cx: this.layout.deckAnchor.x, cy: this.layout.deckAnchor.y });
        this.onPutToDeck?.(card);
        finish();
        return;
      }
    }

    // Карта из сложенной руки: перекладывать в шеренге нечего — просто возвращаем домой.
    if (d.loose) {
      this.returnCardHome(d.v);
      this.onDragChange?.(false);
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
      c.sprite.zIndex = this.pileZ("deck", i);
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

  /** Куда карта ляжет, когда вернётся: поза её собственной стопки. */
  private homeTargetOf(v: CardVisual): CardTargets {
    const hi = this.hand.indexOf(v);
    if (hi >= 0) return this.handFanTarget(hi);
    const di = this.discardCards.indexOf(v);
    if (di >= 0) return this.discardRestTarget(di);
    const pi = this.playCards.indexOf(v);
    if (pi >= 0) return this.playRestTarget(pi);
    return this.restTarget(Math.max(0, this.cards.indexOf(v)));
  }

  // Дом карты — та стопка, которой она принадлежит. Стопок три (колода, сброс, рука), и
  // раньше здесь искали только в двух: карта сброса не находилась нигде, ей не ставили
  // цель, и она так и оставалась висеть там, где её бросили.
  private returnCardHome(v: CardVisual): void {
    const hi = this.hand.indexOf(v);
    if (hi >= 0) {
      v.sprite.zIndex = Z.handCards + hi;
      this.hand.forEach((c, j) => c.body.setTarget(this.handRestTarget(j)));
      this.updateVisibility();
      return;
    }
    const di = this.discardCards.indexOf(v);
    if (di >= 0) {
      v.sprite.zIndex = this.pileZ("discard", di);
      this.homingCard = v;
      this.discardCards.forEach((c, j) => c.body.setTarget(this.discardRestTarget(j)));
      this.updateVisibility();
      return;
    }
    const pi = this.playCards.indexOf(v);
    if (pi >= 0) {
      this.homingCard = v;
      this.playCards.forEach((c, j) => c.body.setTarget(this.playRestTarget(j)));
      this.syncPlayVisibility();
      this.updateVisibility();
      return;
    }
    const i = Math.max(0, this.cards.indexOf(v));
    v.sprite.zIndex = this.pileZ("deck", i);
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
    const home = this.homeTargetOf(v);
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
    const zs = this.pileScale();
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

  // Какие зоны сейчас принимают карты. Раскрытый веер доски занимает середину стола и
  // гасит всё вокруг — правила в dropZoneActivity.ts.
  private liveDropZones(): Set<DropZone> {
    const source: DragSource = !this.cardDrag ? "none" : this.cardDrag.fromHand ? "hand" : "board";
    return activeDropZones({ boardFan: this.boardFan, source, gameMode: !!this.layout.discardSlot });
  }

  // Зоны видны ВСЕГДА, но по-разному. В покое — еле заметные очертания и подпись, что это
  // за зона: игрок понимает разметку стола, не отвлекаясь на неё. Во время драга зоны
  // заливаются оверлеем, а подпись меняется на ДЕЙСТВИЕ — что будет, если бросить сюда.
  // Сами правила — в engine/zoneChrome.ts, рисование — в engine/zonePaint.ts.
  private drawZones(): void {
    this.syncPlayClearButton();
    if (!this.zoneLayer) return;
    paintZones({
      g: this.zoneLayer,
      live: this.liveDropZones(),
      labels: this.zoneLabels,
      slotLabels: this.slotLabels,
      layout: this.layout,
      dragging: !!this.cardDrag,
      hoverZone: this.hoverZone,
      // В свободе тянут карту СЕБЕ — у зоны руки должна быть своя подпись («взять себе»),
      // а не «оставить в руке», как при перестановке своей же карты.
      dragged: (this.freeMode && this.dealDrag ? "take" : "card") as DraggedKind,
      myReady: this.selfDealReady(),
      inGame: this.freeMode,
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
    if (this.dragHappened) return; // жест был драгом — тап к нему не относится
    // Одинарный тап по колоде в центре — раскрыть веер. Сворачивает стрелка.
    {
      this.dealDrag = false; // тап открытия — не раздача
      // В игре веер доски — личный: тап раскрывает стопку и складывает её обратно. Веер
      // руки при этом не трогается, они независимы.
      if (this.freeMode) {
        this.onBoardFanChange?.(this.boardFan ? null : "deck");
        return;
      }
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
    if (this.cardPress || this.cardDrag) return;
    this.dealDrag = false;
    // Раскрытая рука отдаёт карту под пальцем, сложенная — ВЕРХНЮЮ (ту, что видна поверх
    // шеренги). Из сложенной так быстрее достать единственную карту, а заодно видно, что
    // под ней, — и всё это не раскрывая веер, который виден всему столу.
    //
    // Верх шеренги — ПРАВАЯ карта: z руки растёт слева направо (см. handRow.ts), поэтому
    // сверху лежит последняя, а не нулевая. Индекс 0 брал бы нижнюю, почти скрытую.
    // Раскрытый веер: карту под пальцем можно вытянуть, ТОЛЬКО если её полоска шире пальца
    // (canGrabHandAt). Иначе жест уходит в глиссандо — веер раздвигается под пальцем, и на
    // следующее касание, когда зазор подрос, карта уже тянется. Сложенная шеренга отдаёт
    // верхнюю всегда (одна видимая карта, целиться не в кого).
    // Верх шеренги — правая карта; в вееере захват берёт верхнюю карту под пальцем.
    const focused = this.handFocused;
    const nearest = focused ? this.pickFanGrab(this.hand, e) : this.hand.length - 1;
    this.cardPress = {
      id: e.pointerId,
      ...this.pressPoint(e),
      index: nearest,
      canGrab: focused ? this.canGrabHandAt(nearest) : true,
      fromHand: true,
      pile: "deck", // рука — не стопка доски, поле не используется
      samples: this.startSamples(e),
    };
    this.wake();
  }

  private handleHandTap(e: FederatedPointerEvent): void {
    this.tapStartedOnDeck = false;
    if (this.dragHappened) return;
    // Рука УЖЕ раскрыта и это тач — тык раздвигает веер под пальцем (как у колоды), чтобы
    // из слитых карт выбрать нужную, не вытягивая её сразу. На мыши раздвигает ховер.
    if (this.handFocused && e.pointerType !== "mouse") this.pokeHandFan(e.global.x);
    // Тап по руке выделяет HAND_ID (фокус → веер). Колоду на столе не трогаем.
    this.onDeckTap?.(HAND_ID);
  }

  // Локальный раздвиг веера руки у точки тыка — близнец pokeDeckFan для стопок доски.
  private pokeHandFan(x: number): void {
    if (!this.handFocused || this.hand.length < 2) return;
    const p = anim.fan.wiggle.poke;
    const pi = this.nearestHandFanIndex(x);
    if (this.poke && Math.abs(pi - this.poke.target) <= p.cards) {
      this.poke.target = pi;
      this.poke.t = Math.min(this.poke.t, p.in);
      this.wake();
      return;
    }
    this.poke = { index: pi, target: pi, t: 0 };
    this.reKickWaveAt(pi, this.hand.length);
    this.wake();
  }

  /**
   * Какую карту веера ЗАХВАТИТ палец. В отличие от nearest*FanIndex (ближайший центр —
   * для раскрытия/ховера) берём верхнюю карту под точкой (pickTopFanCard): на стыке двух
   * карт видна правая, её и тянем. На тач хитбокс шире карты — крючок для толстых пальцев.
   */
  private pickFanGrab(cards: readonly CardVisual[], e: FederatedPointerEvent): number {
    const widen = e.pointerType === "mouse" ? 1 : TOUCH_GRAB_WIDEN;
    return pickTopFanCard(cards.map((c) => c.sprite.x), e.global.x, (this.layout.cardW / 2) * widen);
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
    this.positionDiscardHit();
    this.positionPlayHit();
    if (!this.deckHit) return;
    // Раскрытый веер доски — любой стопки: он лежит по центру, и палец работает с ним.
    if (this.boardFan) {
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
    const zs = this.pileScale();
    const ext = stackExtent(this.cards.length);
    const w = (this.layout.cardW * 1.3 + ext.w) * zs;
    const h = (this.layout.cardH * 1.3 + ext.h) * zs;
    this.deckHit.hitArea = new Rectangle(a.x - w / 2, a.y - h / 2, w, h);
  }

  /**
   * Палец прижат к кучке игральной зоны — тянем её ВЕРХНЮЮ карту.
   *
   * Раскрывать веер ради одной верхней карты незачем: чаще всего нужна именно она, а
   * тянуться за веером на каждый ход утомительно. Веер остаётся на «покопаться в середине»
   * и открывается тапом — жесты не спорят: сдвинул палец — потащил карту, не сдвинул —
   * раскрыл кучку (тап проверяет dragHappened).
   *
   * Раскрытым веером заведует хит-зона доски (deckHit), поэтому при открытом вееере эта
   * ветка молчит — иначе за одну карту дрались бы два обработчика.
   */
  private onPlayDown(e: FederatedPointerEvent): void {
    if (!this.freeMode || this.boardFan) return;
    if (this.cardPress || this.cardDrag) return;
    const stack = pickPlayCell(this.playGridNow(), e.global.x, e.global.y);
    if (stack === null) return;
    const pile = playPile(stack);
    const cards = this.pileCards(pile);
    if (cards.length === 0) return;
    // Из кучки карту БЕРУТ себе — это раздача (в свободе только самому себе), а не
    // перестановка внутри стопки. Отсюда dealDrag: он же коротит pressIntent на «deal».
    this.dealDrag = true;
    this.cardPress = {
      id: e.pointerId,
      ...this.pressPoint(e),
      index: cards.length - 1, // верхняя карта кучки
      canGrab: true,
      fromHand: false,
      pile,
      samples: this.startSamples(e),
    };
    this.wake();
  }

  /** Видна ли кнопка «В СБРОС»: в игре, при непустой зоне и пока не раскрыт никакой веер. */
  private playClearVisible(): boolean {
    return this.freeMode && this.playStacks.length > 0 && !this.boardFan;
  }

  // Хит-зона игральной зоны: сам бокс, и только пока не раскрыт веер — раскрытая стопка
  // живёт по центру, и там за палец отвечает хит-зона доски (та же логика, что у сброса).
  private positionPlayHit(): void {
    const hit = this.playHit;
    if (!hit) return;
    const z = this.layout.centerZone;
    const idle = this.freeMode && !this.boardFan && z.w > 0 && z.h > 0;
    hit.eventMode = idle ? "static" : "none";
    hit.hitArea = idle ? new Rectangle(z.cx - z.w / 2, z.cy - z.h / 2, z.w, z.h) : new Rectangle(0, 0, 0, 0);
  }

  // Хит-зона сброса — только его слот и только пока никакой веер не раскрыт: раскрытая
  // стопка живёт по центру, и там за палец отвечает хит-зона доски.
  private positionDiscardHit(): void {
    const hit = this.discardHit;
    if (!hit) return;
    const slot = this.layout.discardSlot;
    const idle = !this.boardFan && !!slot && this.discardPile.count > 0;
    hit.eventMode = idle ? "static" : "none";
    if (!idle || !slot) {
      hit.hitArea = new Rectangle(0, 0, 0, 0);
      return;
    }
    hit.hitArea = new Rectangle(slot.cx - slot.w / 2, slot.cy - slot.h / 2, slot.w, slot.h);
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
        c.sprite.zIndex = this.pileZ("deck", perm[i]!);
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
    this.syncDiscardVisibility();
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
      return;
    }
    const top = n - 1;
    for (let i = 0; i < n; i++) {
      this.cards[i]!.sprite.visible = (detailed || i === top || i === 0);
    }
    if (this.deckBody) this.deckBody.visible = !detailed && n > 2;
  }

  // Сброс: раскрытый веер показывает все карты, горочка в покое — только верхние семь.
  private syncDiscardVisibility(): void {
    const cards = this.discardCards;
    const fanned = this.boardFan === "discard";
    const z = this.pileZBase("discard");
    const held = this.cardDrag?.v ?? this.rejectCard;
    cards.forEach((c, i) => {
      c.sprite.visible = fanned || discardHeapVisible(this.discardDepth(i)) || c === held;
      if (c !== held) c.sprite.zIndex = z + i; // поднятая карта остаётся наверху сцены
    });
    this.syncDiscardTextures();
  }

  /**
   * Чем сброс повёрнут к столу. В ПОКОЕ — рубашкой вверх: горка это «уже сыграно и убрано
   * с глаз», а не витрина. Раскрытый веер показывает лица — за тем его и открывают.
   *
   * Это правило ПОКАЗА, а не состояние: на сервере карты сброса лежат лицом вверх
   * (GameState.discard), и прятать их по-настоящему незачем — любой может раскрыть веер и
   * посмотреть. Поэтому сторона решается здесь, а не через facing.
   */
  private syncDiscardTextures(): void {
    if (!this.backTex) return;
    const fanned = this.boardFan === "discard";
    for (const c of this.discardCards) {
      c.sprite.texture = fanned ? this.faceTexture(c.card) : this.backTex;
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
    const placed = layoutSeats(this.seats.map((st) => st.id), this.w, this.h, {
      topOffset: this.topInset,
      scrollX: this.seatScrollX,
      sideW: boardEdgeWidth(this.w, this.h, this.bottomInset),
    });
    this.seatBoxes = placed.seats;
    this.seatInsets = placed.insets;
    this.seatScrollMax = placed.topScrollMax;
    this.seatScrollX = Math.min(this.seatScrollX, this.seatScrollMax);
    this.positionSeatStripHit();
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
    this.positionDeckHit();
    this.positionHandHit();
    this.syncCollapseButton();
    this.syncHandCounter();
    this.syncDeckCounter();
    this.discardCards.forEach((c, i) => c.body.snapTo(this.discardRestTarget(i)));
    this.syncDiscardCounter();
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
    this.discardCounter = null;
    this.rejectText = null;
    this.shoutBox = null;
    this.shoutWord = null;
    this.shoutFires = [];
    this.shout = null;
    this.shadowLayer = null;
    this.shadowLayers = [];
    this.deckBody = null;
    this.cardLayer = null;
    this.backTex = null;
    this.shadowTex = null;
    this.faces.clear(); // снимает прогрев и освобождает лицевые текстуры
    this.deckHit = null;
    this.discardHit = null;
    this.playHit = null;
    this.playClearBtn = null;
    this.handHit = null;
    this.onDealCard = null;
    this.onDiscardCard = null;
    this.onTakeDiscard = null;
    this.onPutToDeck = null;
    this.onDeckFanChange = null;
    this.onBoardFanChange = null;
    this.onDragChange = null;
    this.reject = null;
    this.deckPile.clear();
    this.handPile.clear();
    this.discardPile.clear();
    this.playPile.clear();
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
      for (const c of this.discardCards) c.body.step(dt);
      for (const c of this.playCards) c.body.step(dt);
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
        e.v.sprite.zIndex = this.pileZ("deck", e.newZ);
        e.zSwapped = true;
      }
    }
    if (sa.t < sa.totalDur) return;
    for (const e of sa.entries) {
      e.v.body.setTarget(e.to);
      e.v.sprite.zIndex = this.pileZ("deck", e.newZ);
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
    // Веер раздвигается за пальцем ТОЛЬКО когда карту тянут ИЗ веера: раскрытая рука или
    // раскрытый веер доски. Из стопки и из свёрнутой шеренги за пальцем идёт одна верхняя
    // карта, остальные лежат как лежали — общая механика с колодой и кучкой зоны, где
    // раскрытие это отдельный жест, а не побочный эффект драга. Раньше здесь стояло
    // «!dealDrag → раздвинуть», и любой драг из шеренги её раскрывал.
    // Раздвигаем соседей, когда карту тянут ИЗ раскрытого веера — колоды, сброса или
    // кучки зоны. Раньше здесь стояло deckFanned (только колода), и веер сброса/зоны при
    // драге не расступался. Из закрытой стопки/шеренги за пальцем идёт одна карта.
    const fromFan = !d.loose && (this.dealDrag ? this.boardFan === d.pile : true);
    if (fromFan) {
      this.applyCardDragTargets();
      return;
    }
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

    if (this.taunt) {
      this.taunt.t += frameDt;
      if (this.taunt.t >= this.taunt.dur) this.taunt = null;
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
        const card = this.rejectCard;
        this.rejectCard = null;
        if (card) this.returnCardHome(card); // укладывает ИМЕННО его стопку
        else this.cards.forEach((c, i) => c.body.setTarget(this.restTarget(i)));
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
    for (const c of this.discardCards) if (c.sprite.visible) this.syncVisual(c);
    for (const c of this.playCards) if (c.sprite.visible) this.syncVisual(c);
    this.syncDeckBody();
    this.syncShadows();
    this.syncRejectText();
    this.syncShout();
    this.syncTaunt();
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

  // Кричалка сидит у своей точки-источника и дрожит (поза — в game/taunt.ts). Кегль
  // считается от ширины экрана, поэтому в любой поворот телефона надпись влезает целиком.
  private syncTaunt(): void {
    const word = this.tauntWord;
    if (!word) return;
    if (!this.taunt) {
      if (word.visible) word.visible = false;
      return;
    }
    const { kind, x, y } = this.taunt;
    const pose = tauntPose(kind, this.taunt.t / this.taunt.dur);
    const size = tauntFontSize(this.w, kind);
    if (word.text !== TAUNT_TEXT[kind]) word.text = TAUNT_TEXT[kind];
    word.style.fontSize = size;
    word.style.fill = TAUNT_COLORS[kind].fill;
    word.style.stroke = { color: TAUNT_COLORS[kind].stroke, width: 8 };
    word.visible = true;
    word.rotation = pose.rot;
    word.scale.set(pose.scale);
    word.alpha = pose.alpha;
    // Прижим к экрану считается ПОСЛЕ масштаба: word.width уже с ним, а масштаб за
    // кричалку растёт — по старому кадру полуширина выходит меньше настоящей, и надпись
    // из крайнего места успевает вылезти за кромку.
    const half = word.width / 2;
    word.x = Math.max(half, Math.min(this.w - half, x + pose.dx * size));
    word.y = y + pose.dy * size;
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
        taunt: !!this.taunt,
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
        handResting:
          this.hand.every((c) => c.body.isResting()) &&
          this.discardCards.every((c) => c.body.isResting()) &&
          this.playCards.every((c) => c.body.isResting()),
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
  /**
   * ЕДИНЫЙ проход теней. Раньше их было три независимых механизма — общая тень колоды,
   * тени веера и тень поднятой карты, — и каждый жил по своим правилам: разная плотность,
   * разные слои, разное понятие «высоты». Наложившись, они темнели вдвое и мазали стол.
   *
   * Теперь тень одна и та же для всех: список «кто отбрасывает» собирается здесь, правила
   * («под какими картами веера нужна тень») — в engine/shadowPass.ts, а плотность у всех
   * теней одинаковая и НЕПРОЗРАЧНАЯ. Две наложенные тени выглядят ровно как одна — это и
   * есть то самое «сливаются», которого не даёт полупрозрачность.
   */
  private syncShadows(): void {
    const specs: ShadowCaster[] = [];
    const lifted = this.cardDrag?.v ?? this.rejectCard;

    if (this.profile.shadows) {
      // Собранные стопки: одна тень на стопку, под её нижней картой.
      if (!this.deckFanned) this.pushPileShadow(specs, this.cards, this.pileZBase("deck"));
      if (this.boardFan !== "discard") {
        // Тень под КАЖДОЙ видимой картой горки, а не одна на всю стопку: карты лежат
        // внахлёст под разными углами, и один силуэт оставил бы половину кучки висеть.
        // Силуэты сливаются маской, поэтому в перекрытии не темнеет (shadowPass).
        const heap = this.discardCards.filter((_, i) => discardHeapVisible(this.discardDepth(i)));
        for (const c of heap) this.pushPileShadow(specs, [c], this.pileZBase("discard"));
      }
      // Каждая кучка зоны — своя стопка, значит своя тень. Раскрытую пропускаем: её
      // карты уже в вееере, и тень им кладёт общая ветка веера ниже.
      //
      // Покойный масштаб кучки — тот, что дала сетка. Наведённая кучка поднята НАД ним, и
      // её тень уходит дальше сама собой: считать её отдельно не нужно, подъём и есть
      // превышение над покоем.
      const restScale = this.playGridNow().cardW / this.layout.cardW;
      this.playStacks.forEach((_, k) => {
        const pile = playPile(k);
        if (this.boardFan === pile) return;
        const cards = this.pileCards(pile);
        // Две тени на кучку: под нижней картой и под верхней. Кучка разъезжается на пятую
        // часть ширины и треть высоты, и один силуэт оставил бы половину стопки висеть
        // без тени. Силуэты сливаются маской, поэтому в перекрытии не темнеет (shadowPass).
        this.pushPileShadow(specs, cards, this.pileZBase(pile), restScale);
        if (cards.length > 1) {
          this.pushPileShadow(specs, cards.slice(-1), this.pileZBase(pile), restScale);
        }
      });

      // Раскрытый веер: тени через одну-две, чтобы не сложиться в полосу.
      if (this.boardFan) {
        const cards = this.fanCards;
        const skip = lifted ? cards.indexOf(lifted) : -1;
        const idx = fanShadowIndices({
          xs: cards.map((c) => c.sprite.x),
          cardW: this.layout.cardW,
          skip: skip >= 0 ? skip : undefined,
        });
        for (const i of idx) {
          const c = cards[i]!;
          if (!c.sprite.visible) continue;
          specs.push({
            x: c.sprite.x,
            y: c.sprite.y,
            rot: c.sprite.rotation,
            scale: c.sprite.scale.x,
            lift: FAN_SHADOW_LIFT,
            z: Z.boardFan - 1,
          });
        }
      }

      // Своя рука: тени как у веера доски — под картами, но по разреженным индексам,
      // чтобы в тесном вееере не сложиться в сплошную полосу. Работает и для шеренги, и
      // для раскрытого веера: fanShadowIndices берёт по фактическим x спрайтов.
      {
        const skip = lifted ? this.hand.indexOf(lifted) : -1;
        const idx = fanShadowIndices({
          xs: this.hand.map((c) => c.sprite.x),
          cardW: this.layout.cardW,
          skip: skip >= 0 ? skip : undefined,
        });
        for (const i of idx) {
          const c = this.hand[i]!;
          if (!c.sprite.visible) continue;
          specs.push({
            x: c.sprite.x,
            y: c.sprite.y,
            rot: c.sprite.rotation,
            scale: c.sprite.scale.x,
            lift: HAND_SHADOW_LIFT,
            z: Z.handCards - 1,
          });
        }
      }

      // Карта в руке у игрока — выше всех, и тень уходит дальше всех.
      if (lifted) {
        specs.push({
          x: lifted.sprite.x,
          y: lifted.sprite.y,
          rot: lifted.sprite.rotation,
          scale: lifted.sprite.scale.x,
          lift: liftOf(lifted.body.scaleVal) * DRAG_SHADOW_LIFT,
          z: Z.draggedCard - 1,
        });
      }
    }

    this.paintShadows(specs);
  }

  /** Тень собранной стопки — одна, под нижней картой (по ней видно всю пачку). */
  /**
   * `restScale` — масштаб, на котором эта стопка ЛЕЖИТ в покое. Подъём тени считается как
   * превышение над ним, поэтому у кучек зоны он свой: они и так мельче обычной стопки (их
   * размер задаёт сетка), и мерить их подъём общей меркой стола значило бы, что кучка
   * отбрасывает тень «вглубь стола» просто за то, что она мелкая.
   */
  private pushPileShadow(out: ShadowCaster[], cards: CardVisual[], z: number, restScale?: number): void {
    const base = cards[0];
    if (!base || this.shuffleAnim || this.scrambleAnim) return; // разлетелись — общей тени нет
    // Именно спрайт: он уже включает и тряску отбоя, и idle-«дыхалку».
    out.push({
      x: base.sprite.x,
      y: base.sprite.y,
      rot: base.sprite.rotation,
      scale: base.sprite.scale.x,
      lift: liftOf(base.body.scaleVal / (restScale ?? this.pileScale())),
      z: z - 1, // строго ПОД своей стопкой, иначе тень накроет собственные карты
    });
  }

  /**
   * Нарисовать тени так, чтобы наложения НЕ складывали альфу.
   *
   * Приём стандартный: силуэты всех теней слоя собираются в МАСКУ (это их объединение), и
   * сквозь неё один раз заливается полупрозрачный прямоугольник во весь экран. Пересеклись
   * две тени или двадцать — заливка ложится ровно один раз, плотность везде одна.
   * Спрайт-на-тень так не умеет в принципе: каждый кладёт свою альфу поверх предыдущей.
   *
   * Слой — на каждую ВЫСОТУ сцены, и это принципиально: тень стопки обязана лежать ПОД
   * своими картами, тень веера — под веером, но над столом, тень поднятой карты — над
   * всем. Свалить их в один слой нельзя: тогда тень колоды легла бы поверх самой колоды.
   * Внутри слоя наложений нет по построению; между слоями пересечься могут только тени
   * РАЗНОЙ высоты, и лёгкое сгущение там читается правильно.
   */
  private paintShadows(specs: ShadowCaster[]): void {
    const byHeight = new Map<number, ShadowCaster[]>();
    for (const spec of specs) {
      const at = byHeight.get(spec.z);
      if (at) at.push(spec);
      else byHeight.set(spec.z, [spec]);
    }
    const heights = [...byHeight.keys()].sort((a, b) => a - b);
    heights.forEach((z, i) => this.paintShadowLayer(this.shadowLayerAt(i), byHeight.get(z)!, z));
    for (let i = heights.length; i < this.shadowLayers.length; i++) {
      this.paintShadowLayer(this.shadowLayers[i]!, [], 0);
    }
  }

  /** Слой теней по номеру; недостающие создаются на лету. */
  private shadowLayerAt(i: number): ShadowLayer {
    while (this.shadowLayers.length <= i) this.shadowLayers.push(this.makeShadowLayer());
    return this.shadowLayers[i]!;
  }

  /** Один слой теней: маска из силуэтов + единственная заливка сквозь неё. */
  private paintShadowLayer(layer: ShadowLayer, specs: ShadowCaster[], z: number): void {
    const { mask, fill } = layer;
    mask.clear();
    if (specs.length === 0) {
      fill.visible = false;
      return;
    }
    for (const spec of specs) {
      const off = lightShadowOffset(this.layout.cardH, spec.lift);
      const scale = spec.scale * 1.04;
      mask
        .poly(
          shadowSilhouette({
            x: spec.x + off.dx,
            y: spec.y + off.dy,
            w: TEX_W * scale,
            h: TEX_H * scale,
            rot: spec.rot,
          }),
        )
        // Цвет маски не важен — важна её форма. Но красим ею же: если движок вдруг решит
        // нарисовать маску как обычную фигуру, на столе будут тени, а не белые пятна.
        .fill({ color: SHADOW_COLOR, alpha: SHADOW_ALPHA });
    }
    fill.visible = true;
    fill.zIndex = z;
    fill.clear();
    fill.rect(0, 0, this.w, this.h).fill({ color: SHADOW_COLOR, alpha: SHADOW_ALPHA });
  }

  /** Слой теней: заливка во весь экран, обрезанная маской-объединением силуэтов. */
  private makeShadowLayer(): ShadowLayer {
    const mask = new Graphics();
    const fill = new Graphics();
    fill.label = SHADOW_LABEL;
    fill.mask = mask;
    fill.visible = false;
    // Маска обязана жить на сцене, иначе Pixi её не отрисует и не применит.
    this.cardLayer!.addChild(mask);
    this.cardLayer!.addChild(fill);
    return { mask, fill };
  }

  private createCardVisual(card: string): CardVisual {
    const sprite = new Sprite(this.backTex!);
    // Имя спрайта — сама карта. Pixi им не пользуется, зато в инспекторе сцены и в тестах
    // видно, ЧТО за прямоугольник поехал не туда (тени зовутся "shadow" по той же причине).
    sprite.label = card;
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
    // Стрелка веера доски — ТОЛЬКО в раздаче (дилер сворачивает слепой веер колоды). В
    // игре её нет: веер там личный и закрывается повторным тапом по нему (handleDeckTap),
    // а стрелка поверх личного веера всё равно не работала — «невидимка».
    const deckFanBtn = this.canDeal && !!this.boardFan && this.fanCount > 0;
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
    const zs = this.pileScale();
    const n = Math.max(1, count);
    const so = stackOffset(i, n, this.deckIsFaceUp());
    return { x: a.x + so.dx * zs, y: a.y + so.dy * zs, rot: this.restJitter[i] ?? 0, scale: zs };
  }

  // Сброс лежит стопкой в своём слоте (в раздаче слота нет — прячем за экран).
  private discardRestTarget(i: number): CardTargets {
    if (this.boardFan === "discard") return this.deckFanTarget(i);
    const slot = this.layout.discardSlot;
    if (!slot) return { x: -9999, y: -9999, rot: 0, scale: this.pileScale() };
    const zs = this.pileScale();
    // Сброс лежит ГОРОЧКОЙ, а не стопкой: «сюда бросили» — это кучка внахлёст, каждая
    // карта под своим углом. Ровная стопка читалась бы как колода, то есть как то,
    // откуда берут, — а из сброса в покое не берут, его сначала раскрывают тапом.
    const pose = discardHeapPose(this.discardDepth(i));
    return {
      x: slot.cx + pose.dx * this.layout.cardW * zs,
      y: slot.cy + pose.dy * this.layout.cardH * zs,
      rot: (pose.deg * Math.PI) / 180,
      scale: zs,
    };
  }

  /** Насколько глубоко лежит карта сброса: 0 — верхняя (последняя в массиве). */
  private discardDepth(i: number): number {
    return this.discardPile.count - 1 - i;
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
  // Счётчик сброса — под его слотом, как у колоды.
  private syncDiscardCounter(): void {
    const t = this.discardCounter;
    const slot = this.layout.discardSlot;
    if (!t) return;
    const n = this.discardPile.count;
    const show = !!slot && n > 0;
    t.visible = show;
    if (!show || !slot) return;
    t.text = String(n);
    t.style.fontSize = Math.max(11, Math.min(28, this.rowCounterSpace() * 0.85));
    const zs = this.pileScale();
    // Габарит ГОРКИ, а не стопки: её силуэт замирает на седьмой карте, и счётчик не
    // должен уползать вниз до тридцать шестой.
    const ext = discardHeapExtent();
    t.x = slot.cx;
    t.y =
      slot.cy +
      (this.layout.cardH / 2) * zs +
      (ext.h / 2) * this.layout.cardH * zs +
      this.rowCounterSpace() * 0.45;
  }

  private syncDeckCounter(): void {
    const t = this.deckCounter;
    if (!t) return;
    const show = this.deckCount > 0;
    t.visible = show;
    if (!show) return;
    t.text = String(this.deckCount);
    t.style.fontSize = Math.max(11, Math.min(28, this.rowCounterSpace() * 0.85));
    const a = this.layout.deckAnchor;
    const zs = this.pileScale();
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

  /** Карты раскрытого веера доски: чуть крупнее эталона, тесный веер ужимается. */
  private boardFanScale(): number {
    return fanCardScale(this.fanCount);
  }

  /** Множитель силы раздвига по типу веера (см. anim.fan.spread). */
  private fanSpreadScale(kind: "deck" | "hand" | "board"): number {
    return anim.fan.spread[kind];
  }

  /** Тип веера, из которого тянут карту: колода / рука / прочая стопка доски. */
  private dragFanKind(d: { fromHand: boolean; pile: BoardPile }): "deck" | "hand" | "board" {
    if (d.fromHand) return "hand";
    return d.pile === "deck" ? "deck" : "board";
  }

  /** Тип ЖИВОГО веера (для глиссандо/тыка): рука / колода / прочая стопка доски. */
  private liveFanKind(): "deck" | "hand" | "board" {
    if (this.liveFan() === "hand") return "hand";
    return this.boardFan === "deck" ? "deck" : "board";
  }

  /**
   * Веер доски раскрывается по центру игровой зоны (boardFanAnchor) — одно место для всех
   * стопок стола, где бы сами стопки ни лежали.
   *
   * Размер — РОВНО как у веера руки: та же формула (handFanGeom) с зоной той же ширины и
   * высоты, только якорь дуги ставим на месте доски. Раньше веер доски считал своя формула
   * (layoutDeckFan) в узкой полосе до слота сброса и выходил заметно мельче руки. Пусть
   * теперь краями заходит на боксы колоды/сброса: пока веер открыт, он главный на столе, а
   * сброс всё равно виден снизу.
   */
  private deckFanGeom(): FanGeom {
    const g = handFanGeom({
      zone: {
        cx: this.layout.boardFanAnchor.x,
        cy: this.layout.boardFanAnchor.y,
        w: this.layout.handZone.w,
        h: this.layout.handZone.h,
      },
      cardW: this.layout.cardW,
      cardH: this.layout.cardH,
      count: this.fanCount,
      focused: true,
      dragging: !!this.cardDrag && !this.cardDrag.fromHand,
    });
    // Якорь дуги — у стопки на доске, а не у верха полосы руки.
    return { ...g, anchor: { x: this.layout.boardFanAnchor.x, y: this.layout.boardFanAnchor.y } };
  }

  // Веер-дуга в руке (чистая математика — см. fan.ts). i может быть дробным
  // (для волны «червячка», где карта плавно ездит между слотами).
  private handFanTarget(i: number): CardTargets {
    const g = this.handFanGeom();
    const c = fanCard(i, Math.max(1, this.handCount), g.anchor, g.width, g.angleDeg, anim.fan.widthFactor);
    // Раскрытый веер руки живёт по тому же правилу, что и веер доски: чуть крупнее
    // эталона, а тесный — ужимается.
    return { x: c.x, y: c.y, rot: c.rot, scale: fanCardScale(this.handCount) };
  }

  // Слот веера доски: геометрия одна на все стопки — где бы стопка ни лежала, раскрывается
  // она по центру игровой зоны.
  private deckFanTarget(i: number): CardTargets {
    const g = this.deckFanGeom();
    const c = fanCard(i, Math.max(1, this.fanCount), g.anchor, g.width, g.angleDeg, anim.fan.widthFactor);
    return { x: c.x, y: c.y, rot: c.rot, scale: this.boardFanScale() };
  }

  private faceTexture(card: string): Texture {
    return this.faceTexFor(card);
  }

  // Какой веер сейчас «живой» для ховера/волны. Колода и рука могут быть открыты вместе:
  // приоритет у того, над которым палец/мышь (deckPointer / press по колоде).
  // Какой веер сейчас «живой» для глиссандо/тыка/волны. "board" — ЛЮБАЯ раскрытая стопка
  // доски (колода, сброс, кучка зоны): механизм у них общий, отличается только сила
  // раздвига (см. fanSpreadScale). "hand" — своя раскрытая рука. Рука и веер доски могут
  // быть открыты вместе; приоритет у того, над которым палец/мышь.
  private liveFan(): "board" | "hand" | null {
    if (this.shuffleAnim || this.scrambleAnim || this.splashAnim || this.cardDrag) {
      return null;
    }
    {
      const handLive = this.handFocused && this.hand.length > 1;
      // dealDrag без cardDrag — ещё не драг; ховер/peek веера доски не глушим.
      const boardLive = !!this.boardFan && this.fanCount > 1 && !(this.dealDrag && this.cardDrag);
      const onBoard = this.deckPointer || (!!this.cardPress && !this.cardPress.fromHand);
      if (boardLive && onBoard) return "board";
      if (handLive) return "hand";
      if (boardLive) return "board";
      return null;
    }
  }

  // Теснота текущего живого веера (0..1).
  private fanCrowd(): number {
    const w = anim.fan.wiggle;
    // Веер доски (любая стопка) считает тесноту по своему числу карт и своей геометрии.
    const count = this.liveFan() === "hand" ? this.handCount : this.fanCount;
    const width = this.liveFan() === "hand" ? this.handFanGeom().width : this.deckFanGeom().width;
    return fanCrowd(count, width, this.layout.cardW, anim.fan.widthFactor, w.gap, w.ramp);
  }

  // Индекс карты веера, ближайшей по x к точке тыка (по текущим позициям спрайтов).
  private nearestFanIndex(x: number): number {
    return nearestIndexByX(this.fanCards.map((c) => c.sprite.x), x);
  }

  // Тык по вееру ДОСКИ (любой стопки): даже если рука тоже открыта — волна идёт по доске.
  private pokeDeckFan(x: number): void {
    if (!this.boardFan || this.fanCount < 2) return;
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
    this.reKickWaveAt(pi, this.fanCount);
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
        e.v.sprite.zIndex = this.pileZ("deck", i < 0 ? 0 : i); // вернулись в общий порядок
        if (i >= 0) e.v.body.setTarget(this.restTarget(i));
      }
      this.splashAnim = null;
    }
  }

  // «Глиссандо»: палец ведут по зажатому вееру — раскрытие едет за ним и НЕ перезапускается
  // (в отличие от тыка), сколько бы карт палец ни прошёл. Тачевый аналог ховера мышью.
  // Ведение пальцем по вееру раздвигает его под пальцем («гармошка»). Работает и для веера
  // колоды на столе, и для СВОЕЙ раскрытой руки — раньше только для колоды, и рука
  // раздвигаться перестала, из-за чего в тесном вееере нельзя было выбрать карту.
  private glissandoTo(x: number): void {
    const live = this.liveFan();
    let pi: number;
    let count: number;
    if (live === "hand" && this.hand.length >= 2) {
      pi = this.nearestHandFanIndex(x);
      count = this.hand.length;
    } else if (this.boardFan && this.fanCount >= 2) {
      this.deckPointer = true; // при двух веерах волна остаётся на доске
      pi = this.nearestFanIndex(x);
      count = this.fanCount;
    } else {
      return;
    }
    const p = anim.fan.wiggle.poke;
    if (!this.poke) {
      this.poke = { index: pi, target: pi, t: p.in };
      this.reKickWaveAt(pi, count);
    } else {
      this.poke.target = pi;
      this.poke.t = Math.min(this.poke.t, p.in); // держим открытым, пока ведут
    }
    this.wake();
  }

  // Ховер мышью над раскрытым веером ДОСКИ (любой стопки) в центре.
  private onDeckHover(e: FederatedPointerEvent): void {
    if (e.pointerType !== "mouse") return;
    if (!this.boardFan || this.fanCount < 2) {
      this.deckPointer = false;
      return;
    }
    this.deckPointer = true;
    const idx = this.nearestFanIndex(e.global.x);
    if (this.hoverTarget === 0 || this.liveFan() !== "board") this.reKickWaveAt(idx, this.fanCount);
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
    // Сила раздвига под пальцем — по типу веера (колода толкает сильнее, см. anim.fan.spread).
    return fanSpreadShift(i, index, p.cards, p.amp, env, p.rightBias) * scale * this.fanSpreadScale(this.liveFanKind());
  }

  private fanRevealScaleNow(): number {
    // Во время deal-драга liveFan() глушит веер доски — считаем его тесноту напрямую.
    if (this.dealDrag && this.boardFan) {
      const step = fanStep(this.fanCount, this.deckFanGeom().width, anim.fan.widthFactor);
      return fanRevealScale(step, this.layout.cardW, anim.fan.wiggle.gap, anim.fan.maxStepIdle);
    }
    const live = this.liveFan();
    if (!live) return 0;
    const count = live === "hand" ? this.hand.length : this.fanCount;
    const width = live === "hand" ? this.handFanGeom().width : this.deckFanGeom().width;
    const step = fanStep(count, width, anim.fan.widthFactor);
    return fanRevealScale(step, this.layout.cardW, anim.fan.wiggle.gap, anim.fan.maxStepIdle);
  }

  // Бегущая волна + локальный поке: двигает только карты ЖИВОГО веера (колода или рука).
  private applyFanWave(live: "board" | "hand"): void {
    // Веер доски — какая стопка сейчас раскрыта (fanCards), не обязательно колода.
    const stack = live === "hand" ? this.hand : this.fanCards;
    const n = Math.max(2, stack.length);
    const w = anim.fan.wiggle;
    const waveScale = this.fanCrowdNow * w.amp * this.fanEnergy;
    for (let i = 0; i < stack.length; i++) {
      const wave = waveScale * Math.sin(w.cycles * Math.PI * 2 * (i / (n - 1)) - this.fanWavePhase);
      const vi = Math.max(0, Math.min(n - 1, i + wave + this.pokeShiftAt(i)));
      const t = live === "hand" ? this.handFanTarget(vi) : this.deckFanTarget(vi);
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
