// Можно ли не-дилеру «открыть» колоду тапом. Нет — клиент бьёт отбоем и пишет «низяяя».

export function forbidDeckOpenTap(dealMode: boolean, canDeal: boolean, deckFanned: boolean): boolean {
  return dealMode && !canDeal && !deckFanned;
}
