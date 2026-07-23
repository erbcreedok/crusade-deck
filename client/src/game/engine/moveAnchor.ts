import type { RoomLayout } from "../layout";
import type { SeatBox } from "../seatLayout";
import type { FlightPoint } from "../cardFlight";

// Куда «прилетает»/«улетает» карта по метке места из card_moved. Чистая функция раскладки:
// движок только берёт точку и запускает полёт (см. RoomEngine.playCardMoved).
//
// Метки: "deck" — колода; "discard" — сброс; "play"/"play:N" — игральная зона; sessionId —
// рука ЭТОГО игрока (selfId) или место соседа. Неизвестная метка — центр стола, а НЕ
// колода: карта из ниоткуда не должна тревожить стопку колоды.

export interface MoveAnchorCtx {
  layout: RoomLayout;
  /** sessionId владельца клиента — его метка означает «своя рука». */
  selfId: string | null;
  /** Боксы мест за столом — по ним находится место соседа. */
  seats: readonly SeatBox[];
}

export function cardMoveAnchor(pile: string, ctx: MoveAnchorCtx): FlightPoint {
  const { layout, selfId, seats } = ctx;
  if (pile === "deck") return { x: layout.deckAnchor.x, y: layout.deckAnchor.y, rot: 0 };
  if (pile === "discard") {
    const slot = layout.discardSlot;
    if (slot) return { x: slot.cx, y: slot.cy, rot: 0 };
    return { x: layout.centerZone.cx, y: layout.centerZone.cy, rot: 0 };
  }
  if (pile === "play" || pile.startsWith("play:")) {
    return { x: layout.boardFanAnchor.x, y: layout.boardFanAnchor.y, rot: 0 };
  }
  if (selfId && pile === selfId) return { x: layout.handAnchor.x, y: layout.handAnchor.y, rot: 0 };
  const box = seats.find((b) => b.id === pile);
  if (box) return { x: box.rect.cx, y: box.rect.cy, rot: 0 };
  return { x: layout.centerZone.cx, y: layout.centerZone.cy, rot: 0 };
}
