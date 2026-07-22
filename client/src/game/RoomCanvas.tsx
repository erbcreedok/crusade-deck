import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { RoomEngine } from "./RoomEngine";
import { resolveProfile, type AnimationSettings } from "./anim/animationSettings";
import type { DeckZone } from "./deckZone";
import type { DropZone } from "./dropZones";

export interface RoomCanvasHandle {
  shuffle: () => void;
}

interface Props {
  deckCount: number;
  deckZone: DeckZone;
  deckDraggable: boolean;
  onDeckDoubleClick: () => void;
  onDeckDrop: (zone: DropZone) => void;
  animation: AnimationSettings;
}

// Тонкий React-хост над движком: монтирует ОДИН <canvas> ровно один раз и отдаёт
// управление императивному RoomEngine. React больше не трогает содержимое канваса —
// только прокидывает пропсы (deckCount/animation) в движок и вызывает shuffle() через ref.
export const RoomCanvas = forwardRef<RoomCanvasHandle, Props>(function RoomCanvas(
  { deckCount, deckZone, deckDraggable, onDeckDoubleClick, onDeckDrop, animation },
  ref,
) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<RoomEngine | null>(null);

  useImperativeHandle(ref, () => ({ shuffle: () => engineRef.current?.shuffle() }), []);

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
    engineRef.current?.setDeckCount(deckCount);
  }, [deckCount]);
  useEffect(() => {
    engineRef.current?.setDeckZone(deckZone);
  }, [deckZone]);
  useEffect(() => {
    engineRef.current?.setDeckDraggable(deckDraggable);
  }, [deckDraggable]);
  useEffect(() => {
    engineRef.current?.setOnDeckDoubleClick(onDeckDoubleClick);
  }, [onDeckDoubleClick]);
  useEffect(() => {
    engineRef.current?.setOnDeckDrop(onDeckDrop);
  }, [onDeckDrop]);
  useEffect(() => {
    engineRef.current?.setAnimationProfile(resolveProfile(animation));
  }, [animation.level, animation.speed]);

  return <div className="room-canvas" ref={wrapRef} />;
});
