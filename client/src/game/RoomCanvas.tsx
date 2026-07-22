import { useEffect, useRef } from "react";
import { RoomEngine } from "./RoomEngine";
import { resolveProfile, type AnimationSettings } from "./anim/animationSettings";
import type { DeckZone } from "./deckZone";
import type { SeatView } from "./seats";
import type { CardBackId } from "./cardBack";
import type { DeckFxMessage, DeckFxIncoming } from "./deckFxClient";

interface Props {
  deck: string[]; // порядок колоды ["10♠",…] — для лицевых текстур
  seats: SeatView[]; // чужие игроки за столом (посадка «П»), каждый — своя дроп-зона
  deckHolder: string | null; // чьё место держит колоду (при deckZone === "seat")
  onDeckDropToSeat: (playerId: string) => void; // колоду бросили на место игрока
  selectedDecks: readonly string[]; // выделенные колоды — вокруг них рамка фокуса
  onDeckTap: (deckId: string) => void; // тап по колоде — выделить её
  onEmptyTap: () => void; // тап мимо всего — снять выделение
  topInset: number; // высота топбара комнаты: места садятся под ним, а не под бейджами
  bottomInset: number; // высота панели действий: игровые зоны заканчиваются над ней
  deckZone: DeckZone;
  deckSlot: number; // слот сейфа (0..2), если колода лежит в сейфе
  deckDraggable: boolean;
  fourColor: boolean;
  cardBack: CardBackId; // скин рубашки (меню → Графика)
  facing: Record<string, boolean>; // сторона каждой карты из состояния сервера
  shuffleSignal: number; // растёт при нажатии «Растасовать» — запускает тасовку в движке
  flipSignal: number; // растёт при нажатии «Перевернуть колоду»
  incomingFx: DeckFxIncoming | null; // чужой эффект с сервера — проиграть как есть
  rejectedFlip: { cards: string[]; text: string; seq: number } | null; // сервер не подтвердил переворот
  onDeckDrop: (zone: "center" | "hand" | "safe", slot: number) => void;
  onCardReorder: (card: string, to: number) => void; // карту перетащили внутри веера
  onShuffleChange: (order: string[]) => void; // любая тасовка сообщила новый порядок колоды
  onFanChange: (fanned: boolean) => void; // веер раскрылся/собрался (от этого зависят кнопки)
  onFlipDeck: () => void; // жест перевернул колоду целиком
  onFlipCards: (cards: string[]) => void; // жест перевернул отдельные карты
  onDeckFx: (fx: DeckFxMessage) => void; // эффект для остальных игроков (украшение)
  onDragChange: (active: boolean) => void;
  animation: AnimationSettings;
}

// Тонкий React-хост над движком: монтирует ОДИН <canvas> ровно один раз и отдаёт
// управление императивному RoomEngine. React больше не трогает содержимое канваса —
// только прокидывает пропсы в движок. Растасовка теперь автоматическая: движок сам
// анимирует реордер, когда приходит новый порядок колоды (setDeck).
export function RoomCanvas({
  deck,
  seats,
  deckHolder,
  onDeckDropToSeat,
  selectedDecks,
  onDeckTap,
  onEmptyTap,
  topInset,
  bottomInset,
  deckZone,
  deckSlot,
  deckDraggable,
  fourColor,
  cardBack,
  facing,
  shuffleSignal,
  flipSignal,
  incomingFx,
  rejectedFlip,
  onDeckDrop,
  onCardReorder,
  onShuffleChange,
  onFanChange,
  onFlipDeck,
  onFlipCards,
  onDeckFx,
  onDragChange,
  animation,
}: Props) {
  const deckKey = deck.join(",");
  const wrapRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<RoomEngine | null>(null);

  // Свежий движок ничего не знает о комнате, а React переприменяет пропсы только когда
  // они МЕНЯЮТСЯ. Пересоздали движок (первый вход, ремоунт, HMR) — и всё, что уже стояло
  // в неизменном виде (зона колоды, держатель, места, скины), в него никогда не попадёт.
  // Поэтому держим актуальные пропсы в ref и разом заливаем их сразу после mount.
  const latest = useRef({
    deck, seats, deckHolder, deckZone, deckSlot, deckDraggable, selectedDecks, fourColor, cardBack,
    facing, topInset, bottomInset, animation,
    // Колбэки тоже: пересозданный движок (ремоунт, HMR) иначе остаётся немым —
    // тап по колоде никуда не сообщает, и выделение «не работает».
    onDeckTap, onEmptyTap,
    onDeckDrop, onDeckDropToSeat, onCardReorder, onShuffleChange, onFanChange, onFlipDeck,
    onFlipCards, onDeckFx, onDragChange,
  });
  latest.current = {
    deck, seats, deckHolder, deckZone, deckSlot, deckDraggable, selectedDecks, fourColor, cardBack,
    facing, topInset, bottomInset, animation,
    onDeckTap, onEmptyTap,
    onDeckDrop, onDeckDropToSeat, onCardReorder, onShuffleChange, onFanChange, onFlipDeck,
    onFlipCards, onDeckFx, onDragChange,
  };

  // Создать движок один раз. Движок сам создаёт свежий <canvas> внутри wrap.
  // Cleanup гарантирует безопасный teardown (см. RoomEngine.destroy).
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;

    const engine = new RoomEngine();
    engineRef.current = engine;
    const rect = wrap.getBoundingClientRect();
    void engine.mount(wrap, rect.width, rect.height).then(() => {
      if (engineRef.current !== engine) return; // успели размонтировать, пока поднимался Pixi
      const p = latest.current;
      engine.setTopInset(p.topInset);
      engine.setBottomInset(p.bottomInset);
      engine.setSeats(p.seats);
      engine.setAnimationProfile(resolveProfile(p.animation));
      engine.setFourColor(p.fourColor);
      engine.setCardBack(p.cardBack);
      engine.setDeckDraggable(p.deckDraggable);
      engine.setAuthoritative(p.deckDraggable);
      engine.setDeck(p.deck);
      engine.setCardFacing(p.facing);
      engine.setDeckHolder(p.deckHolder);
      engine.setDeckZone(p.deckZone, p.deckSlot);
      engine.setSelectedDecks(p.selectedDecks);
      engine.setOnDeckTap(p.onDeckTap);
      engine.setOnEmptyTap(p.onEmptyTap);
      engine.setOnDeckDrop(p.onDeckDrop);
      engine.setOnDeckDropToSeat(p.onDeckDropToSeat);
      engine.setOnCardReorder(p.onCardReorder);
      engine.setOnShuffleChange(p.onShuffleChange);
      engine.setOnFanChange(p.onFanChange);
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

  // Синхронизация состояния комнаты → движок (императивно, без ре-рендера канваса).
  useEffect(() => {
    engineRef.current?.setDeck(deck);
    // deckKey — стабильная сигнатура содержимого (массив пересоздаётся каждый sync).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deckKey]);
  useEffect(() => {
    engineRef.current?.setDeckZone(deckZone, deckSlot);
  }, [deckZone, deckSlot]);
  // Посадка меняется редко (вход/выход, готовность, раздача) — сигнатурой гасим лишние
  // пересчёты: каждый sync пересоздаёт массив, а перерисовка мест не бесплатна.
  const seatsKey = seats.map((s) => `${s.id}:${s.name}:${s.handCount}:${+s.isReady}:${+s.isDealer}:${+s.connected}`).join("|");
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
    // Дилер в лобби — источник правды: применяет изменения мгновенно и не переигрывает
    // собственное эхо с сервера.
    engineRef.current?.setAuthoritative(deckDraggable);
  }, [deckDraggable]);
  useEffect(() => {
    engineRef.current?.setFourColor(fourColor);
  }, [fourColor]);
  useEffect(() => {
    engineRef.current?.setCardBack(cardBack);
  }, [cardBack]);
  useEffect(() => {
    engineRef.current?.setCardFacing(facing);
  }, [facing]);
  // Кнопка «Растасовать»: порядок считает и анимирует движок, сеть узнаёт через
  // onShuffleChange — как и у жестов.
  useEffect(() => {
    if (shuffleSignal > 0) engineRef.current?.shuffleAll();
  }, [shuffleSignal]);

  useEffect(() => {
    if (flipSignal > 0) engineRef.current?.flipDeckByButton();
  }, [flipSignal]);

  // Отказ сервера: вернуть карты и объяснить причину.
  useEffect(() => {
    if (rejectedFlip) engineRef.current?.rejectFlip(rejectedFlip.cards, rejectedFlip.text);
  }, [rejectedFlip]);

  // Чужой эффект: только показать. Состояние карт придёт схемой и всегда главнее.
  useEffect(() => {
    if (incomingFx) engineRef.current?.playFx(incomingFx);
  }, [incomingFx]);
  useEffect(() => {
    engineRef.current?.setOnDeckDrop(onDeckDrop);
  }, [onDeckDrop]);

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
