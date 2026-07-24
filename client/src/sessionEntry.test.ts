import { describe, expect, it } from "vitest";
import { buildTransferLink, planEntry } from "./sessionEntry";

const ORIGIN = "https://crusade-deck-client.fly.dev";

describe("planEntry", () => {
  it("код переноса из hash: считывается, нормализуется, вычищается в /", () => {
    const p = planEntry(`${ORIGIN}/#u=bo-va-ki`, false);
    expect(p.transferCode).toBe("BOVAKI");
    expect(p.invitePrefill).toBeNull();
    expect(p.newUrl).toBe("/"); // hash срезан
  });

  it("код переноса важнее приглашения: /room/X#u=КОД оставляет комнату, но срезает код", () => {
    const p = planEntry(`${ORIGIN}/room/1234#u=BOVAKI`, false);
    expect(p.transferCode).toBe("BOVAKI");
    // пришёл код переноса → уже не новичок, комнату из пути не трогаем
    expect(p.invitePrefill).toBeNull();
    expect(p.newUrl).toBe("/room/1234");
  });

  it("новичок по /room/КОД без аккаунта: комната срезается в /, код уходит в предзаполнение", () => {
    const p = planEntry(`${ORIGIN}/room/4821`, false);
    expect(p.transferCode).toBeNull();
    expect(p.invitePrefill).toBe("4821");
    expect(p.newUrl).toBe("/");
  });

  it("существующий юзер по /room/КОД: адрес не трогаем — авто-джойн как раньше", () => {
    const p = planEntry(`${ORIGIN}/room/4821`, true);
    expect(p.transferCode).toBeNull();
    expect(p.invitePrefill).toBeNull();
    expect(p.newUrl).toBeNull();
  });

  it("чистый корень без параметров: менять нечего", () => {
    const p = planEntry(`${ORIGIN}/`, true);
    expect(p).toEqual({ transferCode: null, invitePrefill: null, newUrl: null });
  });

  it("пустой/мусорный код в hash → null, но hash всё равно чистим", () => {
    const p = planEntry(`${ORIGIN}/#u=___`, false);
    expect(p.transferCode).toBeNull();
    expect(p.newUrl).toBe("/");
  });
});

describe("buildTransferLink", () => {
  it("код кладётся в hash, путь — корень", () => {
    expect(buildTransferLink("BOVAKI", ORIGIN)).toBe(`${ORIGIN}/#u=BOVAKI`);
  });

  it("собранную ссылку planEntry разбирает обратно в тот же код", () => {
    const link = buildTransferLink("KIROVA", ORIGIN);
    expect(planEntry(link, false).transferCode).toBe("KIROVA");
  });
});
