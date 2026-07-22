import { useEffect, useRef } from "react";
import { RoomEngine } from "./RoomEngine";
import { resolveProfile, type AnimationSettings } from "./anim/animationSettings";
import type { DeckZone } from "./deckZone";

interface Props {
  deck: string[]; // порядок колоды ["10♠",…] — для лицевых текстур
  deckZone: DeckZone;
  deckDraggable: boolean;
  fourColor: boolean;
  faceUp: boolean;
  shuffleSignal: number; // растёт при нажатии «Растасовать» — запускает «сумбур» до ответа
  onDeckDoubleClick: () => void;
  onDeckDrop: (zone: "center" | "safe") => void;
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
  faceUp,
  shuffleSignal,
  onDeckDoubleClick,
  onDeckDrop,
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
    engineRef.current?.setDeckFaceUp(faceUp);
  }, [faceUp]);
  useEffect(() => {
    if (shuffleSignal > 0) engineRef.current?.startScramble();
  }, [shuffleSignal]);
  useEffect(() => {
    engineRef.current?.setOnDeckDoubleClick(onDeckDoubleClick);
  }, [onDeckDoubleClick]);
  useEffect(() => {
    engineRef.current?.setOnDeckDrop(onDeckDrop);
  }, [onDeckDrop]);
  useEffect(() => {
    engineRef.current?.setOnDragChange(onDragChange);
  }, [onDragChange]);
  useEffect(() => {
    engineRef.current?.setAnimationProfile(resolveProfile(animation));
  }, [animation.level, animation.speed, animation.shadows]);

  return <div className="room-canvas" ref={wrapRef} />;
}
