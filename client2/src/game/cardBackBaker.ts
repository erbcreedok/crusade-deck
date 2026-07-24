import { Application } from "pixi.js";
import type { CardBackId } from "./cardBack";
import { makeCardBackTexture } from "./engine/cardTextures";

// Единый источник картинки рубашки для HTML-превью (меню, грид выбора).
//
// Раньше превью рисовались CSS-градиентами — отдельным «художником», из-за чего одна и
// та же рубашка на столе (канвас Pixi) и в меню (CSS) выглядела по-разному. Здесь мы печём
// превью ТЕМ ЖЕ движком, что рисует стол (makeCardBackTexture), и отдаём data-URL — так грид
// и строка меню показывают пиксель-в-пиксель ровно ту же текстуру, что и колода.
//
// Один скрытый офскрин-рендерер на всё приложение (не в DOM). Результат кэшируется по id,
// поэтому повторное открытие меню мгновенно. WebGL нет (jsdom/тесты) → возвращаем null, и
// превью просто не появляется (компонент показывает заглушку в цвет фона рубашки).

let appPromise: Promise<Application | null> | null = null;
const cache = new Map<CardBackId, string>();

async function baker(): Promise<Application | null> {
  if (!appPromise) {
    appPromise = (async () => {
      try {
        const app = new Application();
        await app.init({ width: 4, height: 4, backgroundAlpha: 0, antialias: true, preference: "webgl" });
        return app;
      } catch {
        return null;
      }
    })();
  }
  return appPromise;
}

/** data-URL рубашки id (или null, если WebGL недоступен). Печётся один раз и кэшируется. */
export async function bakeCardBack(id: CardBackId): Promise<string | null> {
  const hit = cache.get(id);
  if (hit) return hit;
  const app = await baker();
  if (!app) return null;
  const tex = makeCardBackTexture(app, id);
  try {
    const url = await app.renderer.extract.base64(tex);
    cache.set(id, url);
    return url;
  } catch {
    return null;
  } finally {
    tex.destroy(true);
  }
}
