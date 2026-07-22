import { useEffect, useRef } from "react";
import { RoomEngine } from "./RoomEngine";
import { resolveProfile, type AnimationSettings } from "./anim/animationSettings";
import type { DeckZone } from "./deckZone";
import type { SeatView } from "./seats";
import type { CardBackId } from "./cardBack";
import type { DeckFxMessage, DeckFxIncoming } from "./deckFxClient";

interface Props {
  deck: string[];
  hand: string[]; // моя рука (Player.hand)
  seats: SeatView[];
  deckHolder: string | null;
  onDeckDropToSeat: (playerId: string) => void;
  selectedDecks: readonly string[];
  onDeckTap: (deckId: string) => void;
  onEmptyTap: () => void;
  topInset: number;
  bottomInset: number;
  deckZone: DeckZone;
  deckDraggable: boolean;
  dealMode: boolean;
  deckFanned: boolean;
  canDeal: boolean;
  selfId: string; // sessionId — дроп раздачи в полосу руки = себе
  selfReady: boolean;
  selfIsDealer: boolean;
  fourColor: boolean;
  cardBack: CardBackId;
  facing: Record<string, boolean>;
  shuffleSignal: number;
  flipSignal: number;
  incomingFx: DeckFxIncoming | null;
  rejectedFlip: { cards: string[]; text: string; seq: number } | null;
  onDeckDrop: (zone: "center" | "hand") => void;
  onDealCard: (card: string, to: string) => void;
  onDeckFanChange: (open: boolean) => void;
  collectSignal: { order: string[]; counts?: Record<string, number>; seq: number } | null;
  cardMovedSignal: { moves: { card: string; from: string; to: string }[]; seq: number } | null;
  onCardReorder: (card: string, to: number) => void;
  onShuffleChange: (order: string[]) => void;
  onFanChange: (fanned: boolean) => void;
  onFanCollapse: () => void;
  onFlipDeck: () => void;
  onFlipCards: (cards: string[]) => void;
  onDeckFx: (fx: DeckFxMessage) => void;
  onDragChange: (active: boolean) => void;
  animation: AnimationSettings;
}

export function RoomCanvas({
  deck,
  hand,
  seats,
  deckHolder,
  onDeckDropToSeat,
  selectedDecks,
  onDeckTap,
  onEmptyTap,
  topInset,
  bottomInset,
  deckZone,
  deckDraggable,
  dealMode,
  deckFanned,
  canDeal,
  selfId,
  selfReady,
  selfIsDealer,
  fourColor,
  cardBack,
  facing,
  shuffleSignal,
  flipSignal,
  incomingFx,
  rejectedFlip,
  onDeckDrop,
  onDealCard,
  onDeckFanChange,
  collectSignal,
  cardMovedSignal,
  onCardReorder,
  onShuffleChange,
  onFanChange,
  onFanCollapse,
  onFlipDeck,
  onFlipCards,
  onDeckFx,
  onDragChange,
  animation,
}: Props) {
  const deckKey = deck.join(",");
  const handKey = hand.join(",");
  const wrapRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<RoomEngine | null>(null);

  const latest = useRef({
    deck,
    hand,
    seats,
    deckHolder,
    deckZone,
    deckDraggable,
    dealMode,
    deckFanned,
    canDeal,
    selfId,
    selfReady,
    selfIsDealer,
    selectedDecks,
    fourColor,
    cardBack,
    facing,
    topInset,
    bottomInset,
    animation,
    onDeckTap,
    onEmptyTap,
    onDeckDrop,
    onDeckDropToSeat,
    onDealCard,
    onDeckFanChange,
    onCardReorder,
    onShuffleChange,
    onFanChange,
    onFanCollapse,
    onFlipDeck,
    onFlipCards,
    onDeckFx,
    onDragChange,
  });
  latest.current = {
    deck,
    hand,
    seats,
    deckHolder,
    deckZone,
    deckDraggable,
    dealMode,
    deckFanned,
    canDeal,
    selfId,
    selfReady,
    selfIsDealer,
    selectedDecks,
    fourColor,
    cardBack,
    facing,
    topInset,
    bottomInset,
    animation,
    onDeckTap,
    onEmptyTap,
    onDeckDrop,
    onDeckDropToSeat,
    onDealCard,
    onDeckFanChange,
    onCardReorder,
    onShuffleChange,
    onFanChange,
    onFanCollapse,
    onFlipDeck,
    onFlipCards,
    onDeckFx,
    onDragChange,
  };

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;

    const engine = new RoomEngine();
    engineRef.current = engine;
    const rect = wrap.getBoundingClientRect();
    void engine.mount(wrap, rect.width, rect.height).then(() => {
      if (engineRef.current !== engine) return;
      const p = latest.current;
      engine.setTopInset(p.topInset);
      engine.setBottomInset(p.bottomInset);
      engine.setSeats(p.seats);
      engine.setAnimationProfile(resolveProfile(p.animation));
      engine.setFourColor(p.fourColor);
      engine.setCardBack(p.cardBack);
      engine.setDealMode(p.dealMode);
      engine.setDeckFanned(p.deckFanned);
      engine.setCanDeal(p.canDeal);
      engine.setSelfId(p.selfId);
      engine.setSelfDealState(p.selfReady, p.selfIsDealer);
      engine.setDeckDraggable(p.deckDraggable);
      engine.setAuthoritative(p.deckDraggable || p.canDeal);
      engine.setDeck(p.deck);
      engine.setHand(p.hand);
      engine.setCardFacing(p.facing);
      engine.setDeckHolder(p.deckHolder);
      engine.setDeckZone(p.deckZone);
      engine.setSelectedDecks(p.selectedDecks);
      engine.setOnDeckTap(p.onDeckTap);
      engine.setOnEmptyTap(p.onEmptyTap);
      engine.setOnDeckDrop(p.onDeckDrop);
      engine.setOnDeckDropToSeat(p.onDeckDropToSeat);
      engine.setOnDealCard(p.onDealCard);
      engine.setOnDeckFanChange(p.onDeckFanChange);
      engine.setOnCardReorder(p.onCardReorder);
      engine.setOnShuffleChange(p.onShuffleChange);
      engine.setOnFanChange(p.onFanChange);
      engine.setOnFanCollapse(p.onFanCollapse);
      engine.setOnFlipDeck(p.onFlipDeck);
      engine.setOnFlipCards(p.onFlipCards);
      engine.setOnDeckFx(p.onDeckFx);
      engine.setOnDragChange(p.onDragChange);
    });

    const ro = new ResizeObserver((entries) => {
      const cr = entries[0].contentRect;
      engine.resize(cr.width, cr.height);
    });
    ro.observe(wrap);

    return () => {
      ro.disconnect();
      engine.destroy();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    engineRef.current?.setDeck(deck);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deckKey]);
  useEffect(() => {
    engineRef.current?.setHand(hand);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handKey]);
  useEffect(() => {
    engineRef.current?.setDeckZone(deckZone);
  }, [deckZone]);
  useEffect(() => {
    engineRef.current?.setDealMode(dealMode);
  }, [dealMode]);
  useEffect(() => {
    engineRef.current?.setDeckFanned(deckFanned);
  }, [deckFanned]);
  useEffect(() => {
    engineRef.current?.setCanDeal(canDeal);
  }, [canDeal]);
  useEffect(() => {
    engineRef.current?.setSelfId(selfId);
  }, [selfId]);
  useEffect(() => {
    engineRef.current?.setSelfDealState(selfReady, selfIsDealer);
  }, [selfReady, selfIsDealer]);
  const seatsKey = seats
    .map((s) =>
      [
        s.id,
        s.name,
        s.handCount,
        +s.isReady,
        +s.isDealer,
        +s.connected,
        +s.handOpen,
        +s.handFanned,
        s.hand.join(","),
      ].join(":"),
    )
    .join("|");
  useEffect(() => {
    engineRef.current?.setSeats(seats);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seatsKey]);
  useEffect(() => {
    engineRef.current?.setTopInset(topInset);
  }, [topInset]);
  useEffect(() => {
    engineRef.current?.setBottomInset(bottomInset);
  }, [bottomInset]);
  useEffect(() => {
    engineRef.current?.setDeckHolder(deckHolder);
  }, [deckHolder]);
  useEffect(() => {
    engineRef.current?.setOnDeckDropToSeat(onDeckDropToSeat);
  }, [onDeckDropToSeat]);
  useEffect(() => {
    engineRef.current?.setOnDeckTap(onDeckTap);
  }, [onDeckTap]);
  useEffect(() => {
    engineRef.current?.setOnEmptyTap(onEmptyTap);
  }, [onEmptyTap]);
  const selectedKey = selectedDecks.join(",");
  useEffect(() => {
    engineRef.current?.setSelectedDecks(selectedDecks);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey]);
  useEffect(() => {
    engineRef.current?.setDeckDraggable(deckDraggable);
    engineRef.current?.setAuthoritative(deckDraggable || canDeal);
  }, [deckDraggable, canDeal]);
  useEffect(() => {
    engineRef.current?.setFourColor(fourColor);
  }, [fourColor]);
  useEffect(() => {
    engineRef.current?.setCardBack(cardBack);
  }, [cardBack]);
  useEffect(() => {
    engineRef.current?.setCardFacing(facing);
  }, [facing]);
  useEffect(() => {
    if (shuffleSignal > 0) engineRef.current?.shuffleAll();
  }, [shuffleSignal]);
  useEffect(() => {
    if (flipSignal > 0) engineRef.current?.flipDeckByButton();
  }, [flipSignal]);
  useEffect(() => {
    if (rejectedFlip) engineRef.current?.rejectFlip(rejectedFlip.cards, rejectedFlip.text);
  }, [rejectedFlip]);
  useEffect(() => {
    if (incomingFx) engineRef.current?.playFx(incomingFx);
  }, [incomingFx]);
  useEffect(() => {
    engineRef.current?.setOnDeckDrop(onDeckDrop);
  }, [onDeckDrop]);
  useEffect(() => {
    engineRef.current?.setOnDealCard(onDealCard);
  }, [onDealCard]);
  useEffect(() => {
    engineRef.current?.setOnDeckFanChange(onDeckFanChange);
  }, [onDeckFanChange]);
  useEffect(() => {
    if (collectSignal) engineRef.current?.playCollectAnim(collectSignal.order, collectSignal.counts);
  }, [collectSignal]);
  useEffect(() => {
    if (cardMovedSignal) engineRef.current?.playCardMoved(cardMovedSignal.moves);
  }, [cardMovedSignal]);
  useEffect(() => {
    engineRef.current?.setOnCardReorder(onCardReorder);
  }, [onCardReorder]);
  useEffect(() => {
    engineRef.current?.setOnShuffleChange(onShuffleChange);
  }, [onShuffleChange]);
  useEffect(() => {
    engineRef.current?.setOnFanChange(onFanChange);
  }, [onFanChange]);
  useEffect(() => {
    engineRef.current?.setOnFanCollapse(onFanCollapse);
  }, [onFanCollapse]);
  useEffect(() => {
    engineRef.current?.setOnFlipDeck(onFlipDeck);
  }, [onFlipDeck]);
  useEffect(() => {
    engineRef.current?.setOnFlipCards(onFlipCards);
  }, [onFlipCards]);
  useEffect(() => {
    engineRef.current?.setOnDeckFx(onDeckFx);
  }, [onDeckFx]);
  useEffect(() => {
    engineRef.current?.setOnDragChange(onDragChange);
  }, [onDragChange]);
  useEffect(() => {
    engineRef.current?.setAnimationProfile(resolveProfile(animation));
  }, [animation.level, animation.speed, animation.shadows]);

  return <div className="room-canvas" ref={wrapRef} />;
}
