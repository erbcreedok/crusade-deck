import { useEffect, useRef, useState } from "react";

// Топбар и панель действий — это HTML ПОВЕРХ канваса, движок про них не знает. Меряем их
// и отдаём как отступы: иначе места игроков сядут под бейджи, а карты уедут под кнопки.

/** Зазор между HTML-панелью и игровой областью, px. */
const GAP = 8;

export interface Insets {
  /** Ref, который надо повесить на элемент топбара. */
  topbarRef: React.RefObject<HTMLDivElement>;
  topInset: number;
  bottomInset: number;
}

export function useInsets(): Insets {
  const topbarRef = useRef<HTMLDivElement>(null);
  const [topInset, setTopInset] = useState(0);
  const [bottomInset, setBottomInset] = useState(0);

  // Высота шапки константна (--topbar-h), но её положение зависит от safe-area, поэтому
  // берём НИЖНЮЮ границу: сколько сверху занято, столько и отдаём.
  useEffect(() => {
    const el = topbarRef.current;
    if (!el) return;
    return observe(el, () => setTopInset(el.getBoundingClientRect().bottom + GAP));
  }, []);

  // Панель действий: высота константна (--action-btn-h в theme.css), но к ней добавляется
  // safe-area на iOS — меряем фактическую.
  useEffect(() => {
    const el = document.querySelector(".action-bar");
    if (!el) return;
    return observe(el, () => setBottomInset(el.getBoundingClientRect().height + GAP));
  }, []);

  return { topbarRef, topInset, bottomInset };
}

/** Применить сейчас и следить за размером; возвращает отписку для useEffect. */
function observe(el: Element, apply: () => void): () => void {
  apply();
  const ro = new ResizeObserver(apply);
  ro.observe(el);
  return () => ro.disconnect();
}
