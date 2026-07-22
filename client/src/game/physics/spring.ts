import type { SpringConfig } from "../anim/config";

export interface SpringState {
  pos: number;
  vel: number;
}

// Демпфированная пружина, полу-неявный Эйлер (сначала скорость, потом позиция) —
// устойчивее явного при крупных dt. Это ядро всей «физики фила» карт: движок гоняет
// её по каналам x/y/rot/scale каждый кадр. Pixi ничего не анимирует сам.
export function stepSpring(
  state: SpringState,
  target: number,
  cfg: SpringConfig,
  dt: number,
  snap = false,
): SpringState {
  // Анимации выключены → телепорт в цель, без движения.
  if (snap) return { pos: target, vel: 0 };
  // Нулевой/отрицательный шаг → ничего не считаем (защита от NaN и «скачков назад»).
  if (dt <= 0) return { pos: state.pos, vel: state.vel };

  const { stiffness, damping } = cfg;
  const force = -stiffness * (state.pos - target) - damping * state.vel;
  const vel = state.vel + force * dt;
  const pos = state.pos + vel * dt;
  return { pos, vel };
}

// Осела ли пружина: близко к цели и почти не движется.
export function isSettled(
  state: SpringState,
  target: number,
  posEps = 0.05,
  velEps = 0.05,
): boolean {
  return Math.abs(state.pos - target) <= posEps && Math.abs(state.vel) <= velEps;
}
