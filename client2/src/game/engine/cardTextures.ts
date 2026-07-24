import { Application, Container, Graphics, Text, Texture } from "pixi.js";
import { isCourt, parseCard, suitColor } from "../card";
import { cardBackSkin, latticeCenters, mosaicTiles, type CardBackId } from "../cardBack";
import { pipLayout } from "../pipLayout";
import { COLORS, PIXEL_FONT, SHADOW_COLOR, TEX_H, TEX_W } from "./constants";

// Вид лица числовых карт (меню → Графика):
//  - "symbol": один крупный значок масти по центру (как было);
//  - "pips": значков масти столько, сколько номинал, классической покерной раскладкой.
// Картинки (J/Q/K) и туз в обоих видах рисуются одинаково, поэтому вид на них не влияет.
export type FaceStyle = "symbol" | "pips";

// Фабрики текстур карт: лицо, рубашка, тень. Каждая рисует во временный Graphics/Container
// и один раз запекается в текстуру — дальше это просто спрайты, рисовать заново незачем.
// (Серый «бумажный» торец у самой карты убран; толщину стопки колоды/мест по-прежнему
// рисует движок отдельно, см. CARD_EDGE в RoomEngine/seatPaint.)

/** Мягкий бежевый цвет края карты — лёгкая «тень» толщины (и на лице, и на рубашке). */
const CARD_SHADE = 0xd8c8a0;

/**
 * Слабый бежевый край ЛЕВОЙ и НИЖНЕЙ стороны карты — как лёгкая тень: свет падает сверху
 * справа, значит собственная толщина карты притеняет её снизу-слева. Одна «L» с
 * закруглённым нижним-левым углом, полупрозрачная — чтобы читалась как тень, а не рамка.
 */
function drawCardShade(g: Graphics): void {
  const r = 16;
  const w = 3;
  const x = 2 + w / 2;
  const yb = TEX_H - 2 - w / 2;
  g.moveTo(x, 2 + r)
    .lineTo(x, TEX_H - 2 - r)
    .arcTo(x, yb, 2 + r, yb, r - w / 2)
    .lineTo(TEX_W - 2 - r, yb)
    .stroke({ width: w, color: CARD_SHADE, alpha: 0.55 });
}

/**
 * Лицевая текстура: кремовый фон, ранг+масть по углам и крупный символ по центру
 * (для J/Q/K — буква-заглушка, картинки добавим позже), цвет по масти (четырёхцв./классика).
 */
export function makeCardFaceTexture(
  app: Application,
  card: string,
  fourColor: boolean,
  style: FaceStyle = "symbol",
): Texture {
  const { rank, suit } = parseCard(card);
  const color = suitColor(suit, fourColor);
  const root = new Container();

  const bg = new Graphics();
  bg.roundRect(2, 2, TEX_W - 4, TEX_H - 4, 16).fill({ color: COLORS.cardFace });
  root.addChild(bg);

  // Угол: ранг крупно, масть под ним заметно мельче — иначе угловая масть читается как ещё
  // один пипс. Два отдельных текста, а не один `ранг\nмасть`, ради разного кегля.
  const makeCorner = (): Container => {
    const c = new Container();
    const r = new Text({ text: rank, style: { fontFamily: PIXEL_FONT, fontSize: 40, fill: color } });
    r.anchor.set(0.5);
    r.position.set(0, -12);
    const s = new Text({ text: suit, style: { fontFamily: PIXEL_FONT, fontSize: 26, fill: color } });
    s.anchor.set(0.5);
    s.position.set(0, 15);
    c.addChild(r, s);
    return c;
  };
  const tl = makeCorner();
  tl.position.set(28, 42);
  root.addChild(tl);
  const br = makeCorner();
  br.position.set(TEX_W - 28, TEX_H - 42);
  br.rotation = Math.PI;
  root.addChild(br);

  // Пипсы — только для числовых карт в режиме "pips". Для картинок и туза pipLayout
  // возвращает пусто, и они рисуются крупным центром (единый путь ниже).
  const pips = style === "pips" ? pipLayout(rank) : [];
  if (pips.length > 0) {
    for (const p of pips) {
      const pip = new Text({ text: suit, style: { fontFamily: PIXEL_FONT, fontSize: 46, fill: color } });
      pip.anchor.set(0.5);
      pip.position.set(p.x * TEX_W, p.y * TEX_H);
      if (p.flip) pip.rotation = Math.PI;
      root.addChild(pip);
    }
  } else {
    const court = isCourt(rank);
    const center = new Text({
      text: court ? rank : suit,
      style: { fontFamily: PIXEL_FONT, fontSize: court ? 96 : 120, fill: color },
    });
    center.anchor.set(0.5);
    center.position.set(TEX_W / 2, TEX_H / 2 + 6);
    root.addChild(center);
  }

  const shade = new Graphics();
  drawCardShade(shade);
  root.addChild(shade);

  const tex = app.renderer.generateTexture({ target: root, resolution: 2 });
  root.destroy({ children: true });
  return tex;
}

/** Рубашка по выбранному скину (см. cardBack.ts — там палитра и геометрия узора). */
export function makeCardBackTexture(app: Application, backId: CardBackId): Texture {
  const skin = cardBackSkin(backId);
  const g = new Graphics();
  g.roundRect(2, 2, TEX_W - 4, TEX_H - 4, 16).fill({ color: skin.bg });

  if (skin.pattern === "lattice") {
    // «Квадраторомб»: шахматка из ромбов и квадратов, как на классической рубашке.
    const r = 13;
    for (const p of latticeCenters(TEX_W, TEX_H, 4, 6, 22)) {
      const color = skin.ink[p.odd ? 1 : 0];
      if (p.odd) {
        g.rect(p.x - r * 0.72, p.y - r * 0.72, r * 1.44, r * 1.44).fill({ color });
      } else {
        g.poly([p.x, p.y - r, p.x + r, p.y, p.x, p.y + r, p.x - r, p.y]).fill({ color });
      }
    }
  } else if (skin.pattern === "dots") {
    // «Пузыри»: шахматка кружков-колец, два оттенка чернил, серединка в цвет фона —
    // получается объём (кольцо), а не плоская точка.
    const rad = 14;
    for (const p of latticeCenters(TEX_W, TEX_H, 4, 6, 26)) {
      g.circle(p.x, p.y, rad).fill({ color: skin.ink[p.odd ? 1 : 0] });
      g.circle(p.x, p.y, rad * 0.44).fill({ color: skin.bg });
    }
  } else {
    // Мозаика: плитки встык, три оттенка синего по детерминированному узору.
    for (const t of mosaicTiles(TEX_W, TEX_H, 5, 7, 20)) {
      g.rect(t.x + 1, t.y + 1, t.w - 2, t.h - 2).fill({ color: skin.ink[t.shade] });
    }
  }

  if (skin.edge === "none") {
    // Скин без белой каймы: узор до края в цветной обводке (как рамка на прочих картах).
    g.roundRect(2, 2, TEX_W - 4, TEX_H - 4, 16).stroke({ width: 5, color: skin.border });
  } else {
    // Белая кайма по краю (дефолт): толстая обводка у самого края рисуется ПОВЕРХ узора —
    // чем бы ни была залита рубашка, её края всегда белые («как у настоящих карт»).
    const BORDER = 12;
    g.roundRect(2 + BORDER / 2, 2 + BORDER / 2, TEX_W - 4 - BORDER, TEX_H - 4 - BORDER, 13).stroke({
      width: BORDER,
      color: 0xffffff,
    });
    // Тонкая цветная рамка на стыке белой каймы и узора — очерчивает поле рубашки.
    g.roundRect(2 + BORDER, 2 + BORDER, TEX_W - 4 - 2 * BORDER, TEX_H - 4 - 2 * BORDER, 9).stroke({
      width: 2,
      color: skin.border,
    });
  }
  drawCardShade(g); // тот же бежевый край слева-снизу, что и на лице — единая толщина
  const tex = app.renderer.generateTexture({ target: g, resolution: 2 });
  g.destroy();
  return tex;
}

/**
 * Тень карты — сплошной силуэт: пиксельному столу идёт ТВЁРДАЯ тень, а не растушёвка.
 *
 * Она НЕПРОЗРАЧНАЯ, и это принципиально: полупрозрачные тени, наезжая друг на друга,
 * складывают альфу и темнеют вдвое — под плотным веером получалась грязная полоса вместо
 * тени. Непрозрачные сливаются сами собой: две наложенные выглядят ровно как одна.
 * Поэтому цвет — не чёрный, а тёмный в тон сукна: он и есть «плотность» тени.
 */
export function makeShadowTexture(app: Application): Texture {
  const g = new Graphics();
  g.roundRect(2, 2, TEX_W - 4, TEX_H - 4, 14).fill({ color: SHADOW_COLOR });
  const tex = app.renderer.generateTexture({ target: g, resolution: 2 });
  g.destroy();
  return tex;
}
