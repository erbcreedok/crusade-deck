import { motion } from "framer-motion";

export function DeckStack({ count }: { count: number }) {
  const layers = [0, 1, 2, 3, 4];
  return (
    <motion.div
      className="deck-stack"
      initial={{ opacity: 0, y: -16, scale: 0.85 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 220, damping: 22 }}
    >
      {layers.map((i) => (
        <div
          key={i}
          className="card-back"
          style={{
            transform: `translate(${i * 1.5}px, ${-i * 1.5}px) rotate(${(i - 2) * 1.1}deg)`,
            zIndex: i,
          }}
        />
      ))}
      <div className="deck-count">{count}</div>
    </motion.div>
  );
}
