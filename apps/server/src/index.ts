import "./env.js";

import { Hono } from "hono";
import { serve as serveNode } from "@hono/node-server";
import { serve as serveInngest } from "inngest/hono";
import { createTetherFunctions, env, inngest } from "@tether/core";
import { startDiscord } from "./discord/client.js";
import { DiscordNotifier } from "./discord/notifier.js";

const client = await startDiscord();
const notifier = new DiscordNotifier(client);
const functions = createTetherFunctions({ notifier });

const app = new Hono();
app.get("/health", (c) => c.json({ ok: true, discord: client.isReady(), functions: functions.length }));
app.on(["GET", "POST", "PUT"], "/api/inngest", serveInngest({ client: inngest, functions }));

serveNode({ fetch: app.fetch, port: env().SERVER_PORT }, (info) => {
  console.log(`tether server on http://localhost:${info.port}  (inngest at /api/inngest)`);
});
