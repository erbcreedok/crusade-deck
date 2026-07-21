import { motion } from "framer-motion";
import { Card } from "./Card";

const MAX_SPREAD_WIDTH = 320;
const MAX_SPREAD_ANGLE = 50;
const MAX_CARD_SPACING = 30;

// Своя рука: веер лицом вверх, раздаётся с небольшой задержкой на карту
// (имитация раздачи). Шаг/угол веера сжимаются для больших рук, чтобы
// даже полная колода на руках не улетала за края экрана.
// Дальше (следующая итерация) — драг/собрать/скрыть.
export function Hand({ cards }: { cards: string[] }) {
  const mid = (cards.length - 1) / 2;
  const spacing = cards.length > 1 ? Math.min(MAX_CARD_SPACING, MAX_SPREAD_WIDTH / (cards.length - 1)) : 0;
  const rotateStep = cards.length > 1 ? Math.min(6, MAX_SPREAD_ANGLE / (cards.length - 1)) : 0;

  return (
    <div className="hand">
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
