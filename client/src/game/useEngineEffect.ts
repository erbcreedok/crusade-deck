import { useEffect, type RefObject } from "react";
import type { RoomEngine } from "./RoomEngine";

/**
 * «Пропс → сеттер движка»: выполнить действие над движком, когда изменились deps.
 *
 * Движок живёт вне React, поэтому каждый проп доезжает до него отдельным эффектом. Раньше
 * это были три десятка одинаковых блоков по три строки; хук сжимает каждый до одной, и
 * список связей читается таблицей.
 *
 * Движок появляется асинхронно (await Application.init), поэтому эффект, сработавший до
 * монтирования, просто ничего не делает — всё состояние зальётся разом в applyAllToEngine.
 */
export function useEngineEffect(
  ref: RefObject<RoomEngine | null>,
  apply: (engine: RoomEngine) => void,
  deps: unknown[],
): void {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const engine = ref.current;
    if (engine) apply(engine);
  }, deps);
}
