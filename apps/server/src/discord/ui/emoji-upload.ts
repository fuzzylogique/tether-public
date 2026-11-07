/**
 * `pnpm discord:emoji` — renders the eleven `tether_*` glyphs with the chart pipeline and
 * uploads them as application emoji (no guild emoji slots used). Idempotent by name.
 *
 *   pnpm discord:emoji                   upload missing emoji
 *   pnpm discord:emoji -- --force        replace every tether_* emoji (after a glyph change)
 *   pnpm discord:emoji -- --profile      also set the bot avatar and banner (rate limited; run rarely)
 *
 * PNGs are also written to apps/server/.preview/emoji/ for a quick look.
 */
import "../../env.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Client, GatewayIntentBits } from "discord.js";
import { avatarSvg, bannerSvg, emojiBadges, renderChart } from "@tether/core";
import { svgToPng } from "./raster.js";

const args = new Set(process.argv.slice(2));
const token = process.env.DISCORD_TOKEN;
if (!token) throw new Error("DISCORD_TOKEN is required");

const outDir = join(new URL("../../..", import.meta.url).pathname, ".preview", "emoji");
mkdirSync(outDir, { recursive: true });

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
await client.login(token);
await new Promise<void>((r) => client.isReady() ? r() : client.once("clientReady", () => r()));
const app = await client.application!.fetch();
const existing = await app.emojis.fetch();

let created = 0, kept = 0;
for (const { name, spec } of emojiBadges()) {
  const png = svgToPng(renderChart(spec).svg);
  writeFileSync(join(outDir, `${name}.png`), png);
  const current = existing.find((e) => e.name === name);
  if (current && !args.has("--force")) { kept++; continue; }
  if (current) await current.delete();
  await app.emojis.create({ attachment: png, name });
  created++;
  console.log(`✓ ${name}`);
}
console.log(`${created} uploaded, ${kept} already present`);

if (args.has("--profile")) {
  const avatar = svgToPng(avatarSvg()), banner = svgToPng(bannerSvg());
  writeFileSync(join(outDir, "..", "avatar.png"), avatar);
  writeFileSync(join(outDir, "..", "banner.png"), banner);
  await client.user!.setAvatar(avatar).then(() => console.log("✓ avatar")).catch((e) => console.warn("avatar not set:", e.message));
  await client.user!.setBanner(banner).then(() => console.log("✓ banner")).catch((e) => console.warn("banner not set:", e.message));
}
await client.destroy();
process.exit(0);
