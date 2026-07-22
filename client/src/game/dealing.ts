// Порядок автораздачи и сбора карт. Чистая логика; таймер и анимация — снаружи.

/** 2 карты в секунду. */
export const AUTO_DEAL_INTERVAL_MS = 500;

// От соседа дилера (слева / следующий по кругу), дилер последний.
export function dealOrder(seatIds: readonly string[], dealerId: string): string[] {
  if (seatIds.length === 0) return [];
  const ids = [...seatIds];
  const di = ids.indexOf(dealerId);
  if (di < 0) return ids;
  const start = (di + 1) % ids.length;
  const order: string[] = [];
  for (let k = 0; k < ids.length; k++) {
    order.push(ids[(start + k) % ids.length]!);
  }
  return order;
}

// По две карты игроку, затем следующему по кругу. Повторять, пока не наберётся `total`.
// Нечётный остаток — одна карта последнему в очереди.
export function autoDealPlan(order: readonly string[], total: number): string[] {
  if (order.length === 0 || total <= 0) return [];
  const plan: string[] = [];
  let oi = 0;
  while (plan.length < total) {
    const id = order[oi % order.length]!;
    plan.push(id);
    if (plan.length >= total) break;
    plan.push(id);
    oi += 1;
  }
  return plan;
}

// Порядок сбора карт живёт на СЕРВЕРЕ (handRules.collectOrder): он же его и рассылает
// в hands_collected/deck_reset, клиент только проигрывает присланный порядок.
