import { describe, expect, it } from "vitest";
import { addRecent, forgetRecent, type RecentAccount } from "./recentAccounts";

const acc = (id: string, name = id): RecentAccount => ({ id, name, recoveryHash: name.toUpperCase() });

describe("addRecent", () => {
  it("кладёт свежий аккаунт в начало", () => {
    const out = addRecent([acc("a"), acc("b")], acc("c"));
    expect(out.map((a) => a.id)).toEqual(["c", "a", "b"]);
  });

  it("тот же id не двоится, а поднимается наверх (с новым именем)", () => {
    const out = addRecent([acc("a"), acc("b")], acc("b", "Боб"));
    expect(out.map((a) => a.id)).toEqual(["b", "a"]);
    expect(out[0]!.name).toBe("Боб");
  });

  it("список не растёт бесконечно — обрезается до лимита", () => {
    let list: RecentAccount[] = [];
    for (const id of ["a", "b", "c", "d", "e", "f"]) list = addRecent(list, acc(id));
    expect(list).toHaveLength(4);
    expect(list.map((a) => a.id)).toEqual(["f", "e", "d", "c"]);
  });

  it("хранит только id/name/recoveryHash — лишние поля не тащит", () => {
    const out = addRecent([], { id: "a", name: "A", recoveryHash: "AAA", extra: 1 } as unknown as RecentAccount);
    expect(out[0]).toEqual({ id: "a", name: "A", recoveryHash: "AAA" });
  });
});

describe("forgetRecent", () => {
  it("убирает аккаунт по id", () => {
    expect(forgetRecent([acc("a"), acc("b")], "a").map((a) => a.id)).toEqual(["b"]);
  });
});
