import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { Lobby } from "./Lobby";

vi.mock("./colyseus", () => ({
  fetchPublicRooms: vi.fn().mockResolvedValue([]),
  fetchLastRoom: vi.fn(),
  joinRoom: vi.fn(),
  joinByInviteCode: vi.fn(),
  joinRoomById: vi.fn(),
  createTestRoom: vi.fn(),
}));

import { fetchLastRoom, joinRoomById, createTestRoom } from "./colyseus";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Lobby — вернуться в последнюю комнату", () => {
  it("показывает кнопку возврата и перезаходит по roomId при клике", async () => {
    vi.mocked(fetchLastRoom).mockResolvedValue({ roomId: "room-1", inviteCode: "987456", deckType: "36" });
    const stubRoom = {} as never;
    vi.mocked(joinRoomById).mockResolvedValue(stubRoom);
    const onJoined = vi.fn();

    render(<Lobby accountId="acc-1" onRename={vi.fn()} onJoined={onJoined} />);

    const btn = await screen.findByText(/Вернуться в 987456/);
    fireEvent.click(btn);

    await waitFor(() =>
      expect(joinRoomById).toHaveBeenCalledWith("room-1", { accountId: "acc-1", name: "Player" }),
    );
    await waitFor(() => expect(onJoined).toHaveBeenCalledWith(stubRoom));
  });

  it("не показывает кнопку, если последней комнаты нет", async () => {
    vi.mocked(fetchLastRoom).mockResolvedValue(null);
    render(<Lobby accountId="acc-1" onRename={vi.fn()} onJoined={vi.fn()} />);

    await waitFor(() => expect(fetchLastRoom).toHaveBeenCalled());
    expect(screen.queryByText(/Вернуться/)).toBeNull();
  });
});

describe("Lobby — тестовая комната с ботами", () => {
  it("создаёт test_room выбранной колодой и отдаёт её наверх", async () => {
    vi.mocked(fetchLastRoom).mockResolvedValue(null);
    const stubRoom = {} as never;
    vi.mocked(createTestRoom).mockResolvedValue(stubRoom);
    const onJoined = vi.fn();

    render(<Lobby accountId="acc-1" onRename={vi.fn()} onJoined={onJoined} />);
    fireEvent.click(screen.getByText(/52 карты/)); // проверяем заодно, что колода не зашита
    fireEvent.click(screen.getByText(/Тестовая комната/));

    await waitFor(() =>
      expect(createTestRoom).toHaveBeenCalledWith({ accountId: "acc-1", name: "Player", deckType: "52" }),
    );
    await waitFor(() => expect(onJoined).toHaveBeenCalledWith(stubRoom));
  });

  it("показывает ошибку, если комната не создалась", async () => {
    vi.mocked(fetchLastRoom).mockResolvedValue(null);
    vi.mocked(createTestRoom).mockRejectedValue(new Error("сервер недоступен"));

    render(<Lobby accountId="acc-1" onRename={vi.fn()} onJoined={vi.fn()} />);
    fireEvent.click(screen.getByText(/Тестовая комната/));

    expect(await screen.findByText(/сервер недоступен/)).toBeTruthy();
  });
});
