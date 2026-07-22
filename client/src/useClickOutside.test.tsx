import { describe, it, expect, vi, afterEach } from "vitest";
import { useRef } from "react";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { useClickOutside } from "./useClickOutside";

afterEach(cleanup);

function Fixture({ onOutside }: { onOutside: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, onOutside);
  return (
    <div>
      <div ref={ref} data-testid="inside">
        внутри
      </div>
      <div data-testid="outside">снаружи</div>
    </div>
  );
}

describe("useClickOutside", () => {
  it("вызывает onOutside при нажатии вне элемента", () => {
    const onOutside = vi.fn();
    const { getByTestId } = render(<Fixture onOutside={onOutside} />);
    fireEvent.mouseDown(getByTestId("outside"));
    expect(onOutside).toHaveBeenCalledTimes(1);
  });

  it("НЕ вызывает onOutside при нажатии внутри элемента", () => {
    const onOutside = vi.fn();
    const { getByTestId } = render(<Fixture onOutside={onOutside} />);
    fireEvent.mouseDown(getByTestId("inside"));
    expect(onOutside).not.toHaveBeenCalled();
  });

  it("реагирует и на touchstart (мобильный тап снаружи)", () => {
    const onOutside = vi.fn();
    const { getByTestId } = render(<Fixture onOutside={onOutside} />);
    fireEvent.touchStart(getByTestId("outside"));
    expect(onOutside).toHaveBeenCalledTimes(1);
  });

  it("снимает слушатели при размонтировании", () => {
    const onOutside = vi.fn();
    const { unmount } = render(<Fixture onOutside={onOutside} />);
    unmount();
    fireEvent.mouseDown(document.body);
    expect(onOutside).not.toHaveBeenCalled();
  });
});
