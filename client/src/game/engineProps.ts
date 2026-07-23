import type { RoomEngine } from "./RoomEngine";
import type { AnimationSettings } from "./anim/animationSettings";
import { resolveProfile } from "./anim/animationSettings";
import type { CardBackId } from "./cardBack";
import type { DeckFxIncoming, DeckFxMessage } from "./deckFxClient";
import type { SeatView } from "./seats";

// Что React передаёт движку стола. Отдельный модуль, потому что список длинный и нужен
// в двух видах: как пропсы компонента и как «залить всё разом» при монтировании.

/** Данные стола: их движок держит у себя и рисует. */
export interface EngineState {
  deck: string[];
  hand: string[]; // моя рука (Player.hand)
  discard: string[]; // сброс: сыгранные карты, лицом вверх
  seats: SeatView[];
  selectedDecks: readonly string[];
  topInset: number;
  bottomInset: number;
  /** Режим свободы: карту со стола тянет каждый себе, в чужие руки не кладёт никто. */
  freeMode: boolean;
  deckFanned: boolean;
  canDeal: boolean;
  selfId: string; // sessionId — дроп раздачи в полосу руки = себе
  selfReady: boolean;
  selfIsDealer: boolean;
  fourColor: boolean;
  cardBack: CardBackId;
  facing: Record<string, boolean>;
  animation: AnimationSettings;
}

/** Жесты стола наверх: движок о сети не знает, решения принимает React. */
export interface EngineCallbacks {
  onDeckTap: (deckId: string) => void;
  onEmptyTap: () => void;
  onDealCard: (card: string, to: string) => void;
  /** Карта из руки ушла в сброс. */
  onDiscardCard: (card: string) => void;
  onDeckFanChange: (open: boolean) => void;
  onCardReorder: (card: string, to: number) => void;
  onShuffleChange: (order: string[]) => void;
  onFanChange: (fanned: boolean) => void;
  onFanCollapse: () => void;
  onDeckFx: (fx: DeckFxMessage) => void;
  onDragChange: (active: boolean) => void;
}

/**
 * Разовые события: не состояние, а «сыграй это». Каждое со своим счётчиком/seq, иначе два
 * одинаковых события подряд слились бы в одно и второе не проигралось бы.
 */
export interface EngineSignals {
  shuffleSignal: number;
  incomingFx: DeckFxIncoming | null;
  /** Отказ без отката карт — только надпись. */
  noticeSignal: { text: string; seq: number } | null;
  /** Клич «ГОУ!» на весь стол. */
  shoutSignal: { seq: number } | null;
  collectSignal: { order: string[]; counts?: Record<string, number>; seq: number } | null;
  cardMovedSignal: { moves: { card: string; from: string; to: string }[]; seq: number } | null;
}

export type EngineProps = EngineState & EngineCallbacks & EngineSignals;

/**
 * Залить в движок ВСЁ текущее состояние и все колбэки. Нужно ровно один раз — сразу после
 * mount: пока шёл await init, пропсы могли уехать, а точечные эффекты уже отработали
 * вхолостую (движка ещё не было).
 *
 * Порядок важен: режим свободы и права влияют на то, куда лягут карты, поэтому они
 * выставляются ДО setDeck/setHand.
 */
export function applyAllToEngine(engine: RoomEngine, p: EngineProps): void {
  engine.setTopInset(p.topInset);
  engine.setBottomInset(p.bottomInset);
  engine.setSeats(p.seats);
  engine.setAnimationProfile(resolveProfile(p.animation));
  engine.setFourColor(p.fourColor);
  engine.setCardBack(p.cardBack);
  engine.setFreeMode(p.freeMode);
  engine.setDeckFanned(p.deckFanned);
  engine.setCanDeal(p.canDeal);
  engine.setSelfId(p.selfId);
  engine.setSelfDealState(p.selfReady, p.selfIsDealer);
  engine.setAuthoritative(p.canDeal);
  engine.setDeck(p.deck);
  engine.setHand(p.hand);
  engine.setDiscard(p.discard);
  engine.setCardFacing(p.facing);
  engine.setSelectedDecks(p.selectedDecks);

  engine.setOnDeckTap(p.onDeckTap);
  engine.setOnEmptyTap(p.onEmptyTap);
  engine.setOnDealCard(p.onDealCard);
  engine.setOnDiscardCard(p.onDiscardCard);
  engine.setOnDeckFanChange(p.onDeckFanChange);
  engine.setOnCardReorder(p.onCardReorder);
  engine.setOnShuffleChange(p.onShuffleChange);
  engine.setOnFanChange(p.onFanChange);
  engine.setOnFanCollapse(p.onFanCollapse);
  engine.setOnDeckFx(p.onDeckFx);
  engine.setOnDragChange(p.onDragChange);
}
