import { Application, Container, Graphics, Text, Texture } from "pixi.js";
import { isCourt, parseCard, suitColor } from "../card";
import { cardBackSkin, latticeCenters, mosaicTiles, type CardBackId } from "../cardBack";
import { CARD_EDGE, COLORS, PIXEL_FONT, SHADOW_COLOR, TEX_H, TEX_W } from "./constants";

// Фабрики текстур карт: лицо, рубашка, тень. Каждая рисует во временный Graphics/Container
// и один раз запекается в текстуру — дальше это просто спрайты, рисовать заново незачем.

/**
 * «Бумажная» кромка карты: низ — серый, бока — темнее серым. В стопке карты сдвинуты
 * вниз-влево, поэтому видно именно нижний и левый срезы соседней карты — они и создают
 * ощущение толщины бумаги при свете сверху справа.
 */
export function drawCardEdges(g: Graphics): void {
  const e = CARD_EDGE;
  const r = 16;
  // бока (весь контур) — тёмно-серый
  g.roundRect(2, 2, TEX_W - 4, TEX_H - 4, r).stroke({ width: e.width, color: e.side });
  // низ — светлее: прямая по нижнему срезу, между скруглениями углов
  g.moveTo(2 + r, TEX_H - 2 - e.width / 2)
    .lineTo(TEX_W - 2 - r, TEX_H - 2 - e.width / 2)
    .stroke({ width: e.width, color: e.bottom });
}

/**
 * Лицевая текстура: кремовый фон, ранг+масть по углам и крупный символ по центру
 * (для J/Q/K — буква-заглушка, картинки добавим позже), цвет по масти (четырёхцв./классика).
 */
export function makeCardFaceTexture(app: Application, card: string, fourColor: boolean): Texture {
  const { rank, suit } = parseCard(card);
  const color = suitColor(suit, fourColor);
  const root = new Container();

  const bg = new Graphics();
  bg.roundRect(2, 2, TEX_W - 4, TEX_H - 4, 16).fill({ color: COLORS.cardFace });
  drawCardEdges(bg);
  root.addChild(bg);

  const cornerStyle = { fontFamily: PIXEL_FONT, fontSize: 40, fill: color, align: "center" as const, lineHeight: 34 };
  const tl = new Text({ text: `${rank}\n${suit}`, style: cornerStyle });
  tl.anchor.set(0.5);
  tl.position.set(28, 42);
  root.addChild(tl);
  const br = new Text({ text: `${rank}\n${suit}`, style: cornerStyle });
  br.anchor.set(0.5);
  br.position.set(TEX_W - 28, TEX_H - 42);
  br.rotation = Math.PI;
  root.addChild(br);

  const court = isCourt(rank);
  const center = new Text({
    text: court ? rank : suit,
    style: { fontFamily: PIXEL_FONT, fontSize: court ? 96 : 120, fill: color },
  });
  center.anchor.set(0.5);
  center.position.set(TEX_W / 2, TEX_H / 2 + 6);
  root.addChild(center);

  const tex = app.renderer.generateTexture({ target: root, resolution: 2 });
  root.destroy({ children: true });
  return tex;
}

/** Рубашка по выбранному скину (см. cardBack.ts — там палитра и геометрия узора). */
export function makeCardBackTexture(app: Application, backId: CardBackId): Texture {
  const skin = cardBackSkin(backId);
  const g = new Graphics();
  g.roundRect(2, 2, TEX_W - 4, TEX_H - 4, 16)
    .fill({ color: skin.bg })
    .stroke({ width: 5, color: skin.border });

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
  } else {
    // Мозаика: плитки встык, три оттенка синего по детерминированному узору.
    for (const t of mosaicTiles(TEX_W, TEX_H, 5, 7, 20)) {
      g.rect(t.x + 1, t.y + 1, t.w - 2, t.h - 2).fill({ color: skin.ink[t.shade] });
    }
  }

  g.roundRect(16, 16, TEX_W - 32, TEX_H - 32, 10).stroke({ width: 3, color: skin.inner });
  drawCardEdges(g);
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
