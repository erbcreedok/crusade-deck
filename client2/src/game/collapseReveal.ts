import { easeOutQuad } from "./anim/easing";

// Появление стрелки «сложить»: снизу вверх + fade-in. u = 0..1 (0 — спрятана).

export function collapseRevealPose(
  u: number,
  targetY: number,
  slidePx: number,
): { y: number; alpha: number } {
  const t = Math.max(0, Math.min(1, u));
  const e = easeOutQuad(t);
  return {
    y: targetY + (1 - e) * Math.max(0, slidePx),
    alpha: e,
  };
}
