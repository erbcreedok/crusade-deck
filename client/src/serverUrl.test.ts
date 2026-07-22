import { describe, it, expect } from "vitest";
import { resolveWsUrl, resolveHttpUrl } from "./serverUrl";

describe("resolveWsUrl", () => {
  it("на https-странице даёт wss:// того же хоста", () => {
    expect(resolveWsUrl({}, { protocol: "https:", host: "crusade.example.com" })).toBe(
      "wss://crusade.example.com"
    );
  });

  it("на http-странице даёт ws:// того же хоста", () => {
    expect(resolveWsUrl({}, { protocol: "http:", host: "localhost:5173" })).toBe(
      "ws://localhost:5173"
    );
  });

  it("сохраняет нестандартный порт", () => {
    expect(resolveWsUrl({}, { protocol: "https:", host: "example.com:8443" })).toBe(
      "wss://example.com:8443"
    );
  });

  it("VITE_SERVER_URL перебивает автоопределение", () => {
    expect(
      resolveWsUrl({ VITE_SERVER_URL: "ws://10.0.0.5:2567" }, { protocol: "https:", host: "example.com" })
    ).toBe("ws://10.0.0.5:2567");
  });

  it("пустая VITE_SERVER_URL не считается за override", () => {
    expect(resolveWsUrl({ VITE_SERVER_URL: "" }, { protocol: "https:", host: "example.com" })).toBe(
      "wss://example.com"
    );
  });
});

describe("resolveHttpUrl", () => {
  it("по умолчанию пустая строка — запросы идут относительно текущего origin", () => {
    expect(resolveHttpUrl({})).toBe("");
  });

  it("VITE_HTTP_URL перебивает и отдаётся без хвостового слэша", () => {
    expect(resolveHttpUrl({ VITE_HTTP_URL: "http://localhost:2567/" })).toBe("http://localhost:2567");
  });

  it("пустая VITE_HTTP_URL не ломает относительный режим", () => {
    expect(resolveHttpUrl({ VITE_HTTP_URL: "" })).toBe("");
  });
});
