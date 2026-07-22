// Ease-out: быстро в начале, замедляется под конец. Используется как time-warp
// воспроизведения растасовки, чтобы даже на 2x/3x финал «оседал» мягко, а не обрывался.
export function easeOutQuad(u: number): number {
  const c = u < 0 ? 0 : u > 1 ? 1 : u;
  return 1 - (1 - c) * (1 - c);
}
