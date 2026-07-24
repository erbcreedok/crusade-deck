import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { PixelBackground } from "./PixelBackground";

describe("PixelBackground", () => {
  it("по умолчанию — фон главного меню (зелёное сукно)", () => {
    const { container } = render(<PixelBackground enabled />);
    expect(container.querySelector(".pixel-bg-clubs")).toBeTruthy();
    expect(container.querySelector(".pixel-bg--game")).toBeNull();
  });

  it("в комнате — отдельный, более контрастный фон", () => {
    const { container } = render(<PixelBackground enabled variant="game" />);
    // фон комнаты помечен своим модификатором на всех слоях
    const layers = container.querySelectorAll(".pixel-bg-layer");
    expect(layers.length).toBeGreaterThan(0);
    layers.forEach((el) => expect(el.classList.contains("pixel-bg--game")).toBe(true));
  });

  it("выключённая анимация гасит движение в обоих вариантах", () => {
    for (const variant of ["menu", "game"] as const) {
      const { container } = render(<PixelBackground enabled={false} variant={variant} />);
      const layers = container.querySelectorAll(".pixel-bg-layer");
      layers.forEach((el) => expect(el.classList.contains("motion-paused")).toBe(true));
    }
  });
});
