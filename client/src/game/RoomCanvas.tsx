import { useEffect, useRef } from "react";
import { RoomEngine } from "./RoomEngine";
import { resolveProfile, type AnimationSettings } from "./anim/animationSettings";
import type { DeckZone } from "./deckZone";
import type { CardBackId } from "./cardBack";
import type { DeckFxMessage, DeckFxIncoming } from "./deckFxClient";

interface Props {
  deck: string[]; // порядок колоды ["10♠",…] — для лицевых текстур
  deckZone: DeckZone;
  deckDraggable: boolean;
  fourColor: boolean;
  cardBack: CardBackId; // скин рубашки (меню → Графика)
  facing: Record<string, boolean>; // сторона каждой карты из состояния сервера
  shuffleSignal: number; // растёт при нажатии «Растасовать» — запускает тасовку в движке
  flipSignal: number; // растёт при нажатии «Перевернуть колоду»
  incomingFx: DeckFxIncoming | null; // чужой эффект с сервера — проиграть как есть
  onDeckDoubleClick: () => void;
  onDeckDrop: (zone: "center" | "safe") => void;
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
  deckZone,
  deckDraggable,
  fourColor,
  cardBack,
  facing,
  shuffleSignal,
  flipSignal,
  incomingFx,
  onDeckDoubleClick,
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

  // Создать движок один раз. Движок сам создаёт свежий <canvas> внутри wrap.
  // Cleanup гарантирует безопасный teardown (см. RoomEngine.destroy).
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;

    const engine = new RoomEngine();
    engineRef.current = engine;
    const rect = wrap.getBoundingClientRect();
    void engine.mount(wrap, rect.width, rect.height);

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
    engineRef.current?.setDeckZone(deckZone);
  }, [deckZone]);
  useEffect(() => {
    engineRef.current?.setDeckDraggable(deckDraggable);
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

  // Чужой эффект: только показать. Состояние карт придёт схемой и всегда главнее.
  useEffect(() => {
    if (incomingFx) engineRef.current?.playFx(incomingFx);
  }, [incomingFx]);
  useEffect(() => {
    engineRef.current?.setOnDeckDoubleClick(onDeckDoubleClick);
  }, [onDeckDoubleClick]);
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
