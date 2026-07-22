import { Graphics, Text } from "pixi.js";
import { dropZoneRegions, type DropTarget, type DropZone } from "../dropZones";
import type { RoomLayout } from "../layout";
import type { DraggedKind } from "../zoneLabels";
import { noticeFontSize, zoneChrome, zoneLabelFontSize } from "./zoneChrome";

// Рисование дроп-зон. Что рисовать — решает zoneChrome.ts; здесь только Pixi.

export interface ZonePaintDeps {
  g: Graphics;
  labels: Partial<Record<DropZone, Text>>;
  layout: RoomLayout;
  dragging: boolean;
  hoverZone: DropTarget | null;
  dragged: DraggedKind;
  dealMode: boolean;
  myReady: boolean;
}

export function paintZones(d: ZonePaintDeps): void {
  d.g.clear();
  const regions = dropZoneRegions(d.layout);
  (Object.keys(regions) as DropZone[]).forEach((zone) => {
    const { rect } = regions[zone];
    const label = d.labels[zone];
    if (rect.w <= 0 || rect.h <= 0) {
      if (label) label.visible = false;
      return;
    }
    const c = zoneChrome({
      zone,
      dragging: d.dragging,
      active: d.dragging && d.hoverZone?.zone === zone,
      dragged: d.dragged,
      dealMode: d.dealMode,
      myReady: d.myReady,
    });
    const x = rect.cx - rect.w / 2;
    const y = rect.cy - rect.h / 2;

    if (c.fill) d.g.roundRect(x, y, rect.w, rect.h, rect.r).fill(c.fill);
    d.g.roundRect(x, y, rect.w, rect.h, rect.r).stroke(c.stroke);

    if (label) {
      label.text = c.label.text;
      label.x = rect.cx;
      label.y = rect.cy;
      label.visible = true;
      label.tint = c.label.tint;
      label.alpha = c.label.alpha;
    }
  });
}

/** Размер шрифта подписей/«низяяя» от размера карты (обновляется на ресайзе). */
export function styleZoneLabels(
  labels: Partial<Record<DropZone, Text>>,
  layout: RoomLayout,
  noticeText: Text | null,
): void {
  const regions = dropZoneRegions(layout);
  for (const zone of Object.keys(labels) as DropZone[]) {
    const t = labels[zone];
    if (!t) continue;
    t.style.fontSize = zoneLabelFontSize(zone, regions[zone].rect.w, layout.cardH);
  }
  if (noticeText) noticeText.style.fontSize = noticeFontSize(layout.cardH);
}
