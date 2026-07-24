import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchLastRoom } from "./colyseus";

function mockFetch(body: unknown, ok = true) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok, json: async () => body }));
}

afterEach(() => vi.unstubAllGlobals());

describe("fetchLastRoom", () => {
  it("returns the last room info on success", async () => {
    mockFetch({ roomId: "room-1", inviteCode: "987456", deckType: "36" });
    expect(await fetchLastRoom("acc-1")).toEqual({ roomId: "room-1", inviteCode: "987456", deckType: "36" });
  });

  it("returns null when the server has no last room (404)", async () => {
    mockFetch({ error: "not_found" }, false);
    expect(await fetchLastRoom("acc-1")).toBeNull();
  });
});
