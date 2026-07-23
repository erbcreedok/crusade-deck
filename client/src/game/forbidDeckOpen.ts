// Можно ли не-дилеру «открыть» колоду тапом. Нет — клиент бьёт отбоем и пишет «низяяя».
// Исключение — режим свободы: колода там общая, и отчитывать за тап не за что (открыть
// её тапом всё равно нельзя, веером по-прежнему распоряжается дилер — просто молча).

export function forbidDeckOpenTap(
  dealMode: boolean,
  canDeal: boolean,
  deckFanned: boolean,
  freeMode = false,
): boolean {
  return dealMode && !canDeal && !deckFanned && !freeMode;
}
