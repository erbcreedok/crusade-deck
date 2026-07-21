import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Card } from "./Card";

describe("Card", () => {
  it("renders a red suit card with the red class", () => {
    const { container } = render(<Card card="10♥" />);
    expect(container.querySelector(".playing-card")).toHaveClass("playing-card-red");
    expect(container.querySelector(".playing-card-corner")?.textContent).toContain("10");
    expect(container.querySelector(".playing-card-corner")?.textContent).toContain("♥");
  });

  it("renders a black suit card with the black class", () => {
    const { container } = render(<Card card="A♠" />);
    expect(container.querySelector(".playing-card")).toHaveClass("playing-card-black");
  });

  it("treats diamonds as red and clubs as black", () => {
    const { container: diamonds } = render(<Card card="7♦" />);
    expect(diamonds.querySelector(".playing-card")).toHaveClass("playing-card-red");

    const { container: clubs } = render(<Card card="7♣" />);
    expect(clubs.querySelector(".playing-card")).toHaveClass("playing-card-black");
  });

  it("splits a multi-character rank like '10' from its suit", () => {
    const { container } = render(<Card card="10♠" />);
    expect(container.querySelector(".playing-card-corner")?.textContent).toContain("10");
    expect(container.querySelector(".playing-card-suit-big")?.textContent).toBe("♠");
  });
});
