import { useEffect, useState } from "react";
import { Room } from "colyseus.js";
import { joinRoom, joinByInviteCode, joinRoomById, fetchPublicRooms, PublicRoomInfo } from "./colyseus";

export function Lobby({
  accountId,
  initialName,
  onRename,
  onJoined,
}: {
  accountId?: string;
  initialName?: string;
  onRename: (name: string) => void;
  onJoined: (room: Room) => void;
}) {
  const [name, setName] = useState(initialName || "Player");
  const [deckType, setDeckType] = useState<"36" | "52">("36");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [publicRooms, setPublicRooms] = useState<PublicRoomInfo[]>([]);

  useEffect(() => {
    fetchPublicRooms().then(setPublicRooms);
  }, []);

  function saveNameIfChanged() {
    const trimmed = name.trim();
    if (trimmed && trimmed !== initialName) onRename(trimmed);
  }

  async function createRoom() {
    setError(null);
    try {
      const room = await joinRoom({ accountId, name, deckType, isPrivate: true });
      onJoined(room);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function joinByCode() {
    setError(null);
    try {
      const room = await joinByInviteCode(code, { accountId, name });
      onJoined(room);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function joinPublic(roomId: string) {
    setError(null);
    try {
      const room = await joinRoomById(roomId, { accountId, name });
      onJoined(room);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="pixel-screen">
      <div className="pixel-panel">
        <h2 className="pixel-title">♣ Лобби ♦</h2>

        <label className="pixel-label">Твоё имя</label>
        <input
          className="pixel-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={saveNameIfChanged}
          placeholder="Твоё имя"
        />

        <label className="pixel-label">Колода</label>
        <div className="suit-toggle-row">
          <div
            className={`suit-toggle ${deckType === "36" ? "active" : ""}`}
            onClick={() => setDeckType("36")}
          >
            36 карт
          </div>
          <div
            className={`suit-toggle ${deckType === "52" ? "active" : ""}`}
            onClick={() => setDeckType("52")}
          >
            52 карты
          </div>
        </div>

        <button className="pixel-btn pixel-btn-full" onClick={createRoom}>
          Создать комнату
        </button>

        <hr className="pixel-divider" />

        <label className="pixel-label">6-значный код</label>
        <input
          className="pixel-input"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="000000"
          maxLength={6}
        />
        <button className="pixel-btn pixel-btn-secondary pixel-btn-full" style={{ marginTop: 10 }} onClick={joinByCode}>
          Войти по коду
        </button>

        {publicRooms.length > 0 && (
          <>
            <hr className="pixel-divider" />
            <label className="pixel-label">Публичные комнаты</label>
            <ul className="public-room-list">
              {publicRooms.map((r) => (
                <li key={r.roomId} className="public-room-row">
                  <span>
                    {r.deckType} карт · {r.playerCount} игрок(ов)
                  </span>
                  <button className="pixel-btn" onClick={() => joinPublic(r.roomId)}>
                    Войти
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        {error && <p className="pixel-error">{error}</p>}
      </div>
    </div>
  );
}
