import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import { renderChart, type ChartSpec } from "@tether/core";

/**
 * SVG → PNG. The only file that imports a rasteriser (docs/DISCORD_UI.md §6): swapping
 * resvg for something else is a change here and nowhere else. Fonts are the vendored Inter
 * files, never system fonts, so output is identical on a Mac and in the Alpine image.
 */
const FONTS = ["Inter-Regular.ttf", "Inter-SemiBold.ttf"].map((f) => fileURLToPath(new URL(`../../../assets/fonts/${f}`, import.meta.url)));

export function svgToPng(svg: string): Buffer {
  const r = new Resvg(svg, {
    font: { loadSystemFonts: false, fontFiles: FONTS, defaultFontFamily: "Inter" },
    fitTo: { mode: "original" },
    shapeRendering: 2,
    textRendering: 1,
  });
  return r.render().asPng();
}

/** Chart spec → PNG, or `undefined` if rendering fails (the card then shows the alt text). */
export async function chartPng(spec: ChartSpec): Promise<Buffer | undefined> {
  try {
    return svgToPng(renderChart(spec).svg);
  } catch (e) {
    console.warn(`chart ${spec.type} failed to render`, e);
    return undefined;
  }
}
