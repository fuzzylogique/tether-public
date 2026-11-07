/**
 * SVG snapshot test for every chart in the preview fixtures (docs/DISCORD_UI.md §11).
 *   pnpm --filter @tether/core test:charts                      compare against __snapshots__
 *   UPDATE_SNAPSHOTS=1 pnpm --filter @tether/core test:charts   rewrite them after an intended change
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fixtures } from "../fixtures.js";
import { emojiBadges } from "../brand.js";
import { renderChart } from "./index.js";
import type { ChartSpec } from "./types.js";

const dir = fileURLToPath(new URL("./__snapshots__/", import.meta.url));
const update = process.env.UPDATE_SNAPSHOTS === "1";

function specs(): [string, ChartSpec][] {
  const out: [string, ChartSpec][] = [];
  for (const f of fixtures()) {
    for (const b of f.card.blocks) {
      if (b.kind === "chart") out.push([`${f.name}--${b.name}`, b.spec]);
      if (b.kind === "gallery") for (const m of b.items) if ("chart" in m) out.push([`${f.name}--${m.name}`, m.chart]);
    }
  }
  for (const e of emojiBadges()) out.push([`emoji--${e.name.replace("tether_", "")}`, e.spec]);
  out.push(["sparkline", { type: "sparkline", title: "Agent activity", caption: "last 24h", points: [0, 1, 3, 2, 5, 8, 6, 4, 9, 12, 7, 5] }]);
  return out;
}

test("chart SVG snapshots", () => {
  mkdirSync(dir, { recursive: true });
  const seen = new Set<string>();
  for (const [name, spec] of specs()) {
    assert.ok(!seen.has(name), `duplicate snapshot name ${name}`);
    seen.add(name);
    const { svg, width, height } = renderChart(spec);
    assert.match(svg, /^<svg /, `${name} is not an svg document`);
    assert.ok(width > 0 && height > 0, `${name} has no size`);
    assert.doesNotMatch(svg, /NaN|undefined|Infinity/, `${name} contains a bad number`);
    const file = `${dir}${name}.svg`;
    if (update || !existsSync(file)) { writeFileSync(file, `${svg}\n`); continue; }
    assert.equal(`${svg}\n`, readFileSync(file, "utf8"), `${name} changed; rerun with UPDATE_SNAPSHOTS=1 if intended`);
  }
});
