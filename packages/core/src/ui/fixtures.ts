/**
 * Fixture cards for `pnpm discord:preview` and the chart snapshot test. Values mirror
 * src/db/seed.ts so the preview looks like the demo org.
 */
import { TETHER } from "./tokens.js";
import { kv, sep, text, type Card } from "./card.js";

export const DEFAULT_AVATAR = "https://cdn.discordapp.com/embed/avatars/0.png";

export type Fixture = { name: string; card: Card };

export function primitivesCard(): Card {
  return {
    accent: TETHER,
    title: "Tether design system",
    subtitle: "every Components V2 primitive the cards are built from",
    blocks: [
      text("Text display with **markdown**, `code`, a <t:1794070800:R> timestamp and an app emoji :tether_done:."),
      sep(),
      { kind: "section", md: ["**Section with a thumbnail**", "Up to three text displays and exactly one accessory."], thumb: { url: DEFAULT_AVATAR, alt: "default avatar" } },
      { kind: "section", md: ["**Section with a button**", "-# accessories can be buttons too"], button: { kind: "button", id: "preview:noop", label: "Button", style: "secondary" } },
      sep(false, true),
      kv([["Label", "value"], ["Amount", "$1,850"], ["Empty", ""]]),
    ],
    actions: [[
      { kind: "button", id: "preview:primary", label: "Primary", style: "primary" },
      { kind: "button", id: "preview:success", label: "Success", style: "success", emoji: ":tether_done:" },
      { kind: "button", id: "preview:danger", label: "Danger", style: "danger" },
      { kind: "link", url: "https://hacktrent.ca", label: "Link" },
    ]],
    footer: "fixture · primitives",
  };
}

export function fixtures(): Fixture[] {
  return [{ name: "primitives", card: primitivesCard() }];
}
