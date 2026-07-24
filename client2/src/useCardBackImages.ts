import { useEffect, useState } from "react";
import { CARD_BACKS, type CardBackId } from "./game/cardBack";
import { bakeCardBack } from "./game/cardBackBaker";

// Печёт все рубашки в картинки, как только меню открылось (enabled). Каждая появляется по
// готовности; заглушку показывает сам компонент превью. Пустой результат (нет WebGL в
// тестах) — не ошибка, а «превью ещё нет».
export function useCardBackImages(enabled: boolean): Partial<Record<CardBackId, string>> {
  const [urls, setUrls] = useState<Partial<Record<CardBackId, string>>>({});

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    for (const skin of CARD_BACKS) {
      bakeCardBack(skin.id).then((url) => {
        if (!alive || !url) return;
        setUrls((prev) => (prev[skin.id] ? prev : { ...prev, [skin.id]: url }));
      });
    }
    return () => {
      alive = false;
    };
  }, [enabled]);

  return urls;
}
