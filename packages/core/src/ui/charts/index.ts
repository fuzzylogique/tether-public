import type { ChartSpec } from "./types.js";
import { donut } from "./donut.js";
import { bars } from "./bars.js";
import { funnel } from "./funnel.js";
import { timeline } from "./timeline.js";
import { stepGraph } from "./stepGraph.js";
import { stacked } from "./stacked.js";
import { sparkline } from "./sparkline.js";
import { badge } from "./badge.js";

export type RenderedChart = { svg: string; width: number; height: number };

/** ChartSpec → SVG string at 2× pixel size. Pure; the adapter rasterises it to PNG. */
export function renderChart(spec: ChartSpec): RenderedChart {
  switch (spec.type) {
    case "donut": return donut(spec);
    case "bars": return bars(spec);
    case "funnel": return funnel(spec);
    case "timeline": return timeline(spec);
    case "stepGraph": return stepGraph(spec);
    case "stacked": return stacked(spec);
    case "sparkline": return sparkline(spec);
    case "badge": return badge(spec);
  }
}
