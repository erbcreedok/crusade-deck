// «Сумбур» на время сетевого запроса: карты хаотично меняются местами, пока не пришёл
// новый порядок (тогда оседают в него через анимацию растасовки). Только у инициатора.

/** Как часто карты перепрыгивают по слотам, сек. */
export const SCRAMBLE_STEP_SEC = 0.16;
/** Страховка от «вечного» сумбура, если новый порядок так и не пришёл, сек. */
export const SCRAMBLE_MAX_SEC = 1.4;
/** На сколько высот карты приподнимается стопка во время сумбура. */
export const SCRAMBLE_RISE = 0.3;
/** Разброс угла карты в сумбуре, рад. */
export const SCRAMBLE_ROT = 0.15;

/** Случайная перестановка индексов 0..n-1 (Фишер–Йетс). rnd — для детерминизма в тестах. */
export function randomPermutation(n: number, rnd: () => number = Math.random): number[] {
  const perm = [...Array(Math.max(0, n)).keys()];
  for (let i = perm.length - 1; i > 0; i--) {
    const k = Math.floor(rnd() * (i + 1));
    [perm[i], perm[k]] = [perm[k]!, perm[i]!];
  }
  return perm;
}

/** Случайный крен карты в сумбуре: ±SCRAMBLE_ROT. */
export function scrambleRot(rnd: () => number = Math.random): number {
  return (rnd() * 2 - 1) * SCRAMBLE_ROT;
}
