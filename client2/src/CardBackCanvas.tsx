import { useEffect, useRef } from "react";
import { CardBackPicker } from "./game/cardBackPicker";
import type { CardBackId } from "./game/cardBack";

// Хост живого канваса выбора рубашки: монтирует движок один раз, дальше только сообщает
// ему текущий выбор и актуальный колбэк (он меняет идентичность на каждый рендер).
export function CardBackCanvas({
  ids,
  selected,
  onSelect,
}: {
  ids: readonly CardBackId[];
  selected: CardBackId;
  onSelect: (id: CardBackId) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<CardBackPicker | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const engine = new CardBackPicker();
    engineRef.current = engine;
    const width = host.clientWidth || 300;
    void engine.mount(host, width, [...ids], selected, onSelect);
    return () => {
      engine.destroy();
      engineRef.current = null;
    };
    // Монтируем один раз: пересборка сцены на каждый рендер сбрасывала бы физику и WebGL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => engineRef.current?.setSelected(selected), [selected]);
  useEffect(() => engineRef.current?.setOnSelect(onSelect), [onSelect]);

  return <div className="back-canvas" ref={hostRef} />;
}
