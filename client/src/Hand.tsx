import { useLayoutEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Card } from "./Card";

const CARD_WIDTH = 64;
const MAX_SPREAD_ANGLE = 50;
const MAX_CARD_SPACING = 30;
// Запас на то, что развёрнутые крайние карты выступают за пределы своей
// точки привязки шире, чем сама точка (rotate вокруг transform-origin: bottom
// center). Раньше ширина веера считалась от фиксированной константы, не
// зависящей от реального экрана, — на телефоне это резало карты по краям.
const ROTATION_MARGIN = 60;

// Своя рука: веер лицом вверх, раздаётся с небольшой задержкой на карту
// (имитация раздачи). Шаг/угол веера подстраиваются под реальную ширину
// контейнера (а не magic-number), чтобы даже полная рука не вылезала за
// границы экрана на любом устройстве.
// Дальше (следующая итерация) — драг/собрать/скрыть.
export function Hand({ cards }: { cards: string[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(320);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setContainerWidth(el.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const mid = (cards.length - 1) / 2;
  const spreadBudget = Math.max(containerWidth - CARD_WIDTH - ROTATION_MARGIN, 60);
  const spacing = cards.length > 1 ? Math.min(MAX_CARD_SPACING, spreadBudget / (cards.length - 1)) : 0;
  const rotateStep = cards.length > 1 ? Math.min(6, MAX_SPREAD_ANGLE / (cards.length - 1)) : 0;

  return (
    <div className="hand" ref={containerRef}>
      {cards.map((card, i) => {
        const offset = i - mid;
        const x = offset * spacing;
        const rotate = offset * rotateStep;
        return (
          <motion.div
            key={card}
            className="hand-card-slot"
            style={{ zIndex: i }}
            initial={{ x, rotate, y: -60, opacity: 0, scale: 0.6 }}
            animate={{ x, rotate, y: 0, opacity: 1, scale: 1 }}
            transition={{ type: "spring", stiffness: 260, damping: 22, delay: i * 0.04 }}
          >
            <Card card={card} />
          </motion.div>
        );
      })}
    </div>
  );
}
