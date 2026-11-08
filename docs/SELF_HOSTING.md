# Run Tether with your own keys

Tether is self-hosted: you run it on your laptop or a server, and every key below is yours. Nothing is shared with the team that built it. One deployment serves one Discord server, one Google account and one Instagram account.

## What you need

| Service | Needed for | Cost to try it |
|---|---|---|
| Discord application | The bot | Free |
| Gemini API key | Planning and agents | Free tier |
| Tiger Cloud service | The database | See Tiger's current plans |
| Google OAuth client | Sheets, Gmail, Calendar | Free; optional, step 7 |
| Instagram token and object storage | Publishing posts, keeping receipts | Optional, step 8 |
| Auth0 tenant | Dashboard login | Free; optional locally, required on a public URL |

You also need Node 22 or newer and pnpm (`npm i -g pnpm`).

## 1. Get the code

```bash
git clone <this repository> tether
```

```bash
cd tether && pnpm install && cp .env.example .env
```

All the keys below go in `.env`, which git ignores. Never commit it. Clear the example `INSTAGRAM_USER_ID` value; it belongs to our account.

## 2. Create the Discord bot

1. At https://discord.com/developers/applications, choose **New Application**. Copy the **Application ID** to `DISCORD_CLIENT_ID`.
2. Under **Bot**, reset the token and copy it to `DISCORD_TOKEN`. On the same page, turn on **Message Content Intent**.
3. In Discord, turn on **Settings → Advanced → Developer Mode**, right-click your server, and copy its ID to `DISCORD_DEV_GUILD_ID`.

Use a server you control. The bot is invited as Administrator because it creates channels and roles.

## 3. Add a Gemini key

Create a key at https://aistudio.google.com/apikey and put it in `GEMINI_API_KEY`.

On the free tier, the `.env.example` default of `gemini-3.6-flash` allows 20 requests a day per key, and one multi-step plan uses 6 to 10. To try Tether on a single free key, use the model our demo ran on:

```
GEMINI_MODEL_PLANNER=gemini-3.1-flash-lite
GEMINI_MODEL_AGENT=gemini-3.1-flash-lite
```

To stay on the larger model, add keys from other Google projects to `GEMINI_API_KEYS`, comma-separated. Tether rotates to the next key when one runs out. Image generation needs a paid key.

## 4. Create the database

Create a service at https://www.tigerdata.com and put its connection string in `DATABASE_URL`. Use Tiger Cloud rather than plain Postgres: Tether needs the `timescaledb`, `vector`, `vectorscale` and `pg_textsearch` extensions.

## 5. Check the keys and set up

```bash
pnpm env:check
```

This tests each credential with a real call and prints the bot's invite link. Open the link and add the bot to your server. A line marked `–` is an optional service you haven't set up. Fix any line marked `✘`, then run:

```bash
pnpm db:push
```

```bash
pnpm discord:register
```

## 6. Start Tether

Run each of these in its own terminal:

```bash
pnpm dev:inngest
```

```bash
pnpm dev:server
```

```bash
pnpm dev:web
```

Then in your Discord server:

1. Run `/tether setup name:<your event>`, and pick your ops and sponsorship channels if you already have them.
2. Run `/tether channels` to create the team channels and roles.
3. Give yourself the new **Lead** role. High-risk actions, such as publishing a post, wait for a Lead.
4. Run `/help start`, or try `/plan` followed by what you need done.

The dashboard is at http://localhost:3000. Run `/workspace date` to set your event date.

**Want sample data to play with?** Run `pnpm db:seed` for a fake hackathon with a budget, sponsors, tasks and an FAQ. Only do this in a throwaway server: the seed replaces that workspace's budget, expenses, sponsors, tasks, policies and documents. `pnpm demo:reset` also clears run history.

## 7. Connect Google (optional)

The agents need this for anything that touches a Sheet, an inbox or a calendar.

1. In https://console.cloud.google.com, create a project and enable the **Google Sheets**, **Gmail**, **Google Calendar** and **Google Drive** APIs.
2. Configure the OAuth consent screen as External, in Testing, and add the organizer's Google account as a test user.
3. Create an OAuth client of type **Desktop app**. Copy its ID and secret to `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
4. Sign in as the organizer. This writes `GOOGLE_REFRESH_TOKEN` to `.env` for you:

   ```bash
   pnpm google:auth
   ```

5. After `/tether setup` has run, create the event sheet and bind it, along with the primary calendar:

   ```bash
   pnpm sheet:create
   ```

6. Restart `pnpm dev:server` so it loads the new token.

## 8. Instagram and storage (optional)

Publishing to Instagram needs a professional account and images at public URLs, so set up both.

- **Storage:** create a Vultr Object Storage bucket and fill in the `S3_*` values. This also keeps durable copies of receipts and photos, because Discord attachment links expire.
- **Instagram:** generate a long-lived token for your account in the Meta developer console. Put it in `INSTAGRAM_ACCESS_TOKEN` and the account ID in `INSTAGRAM_USER_ID`. The token lasts 60 days. To check it:

  ```bash
  pnpm instagram:check
  ```

## 9. Reminders and inbound email (optional)

Overdue-task nudges and the sponsor inbox watcher run only when `TETHER_RUN_CRONS=1`. Set it on exactly one process, or people get nudged twice.

## Running it for real

Don't put the dashboard on a public URL without Auth0. Without it, the dashboard has no login and everyone who reaches it is treated as a lead.

1. Follow [AUTH0.md](AUTH0.md) to set up login.
2. Create free Inngest cloud keys, fill in `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY`, and remove `INNGEST_DEV`.
3. Deploy with `infra/vultr-create.sh` and `infra/deploy.sh`. The [README](../README.md) has the commands.

## If something goes wrong

| What you see | What to do |
|---|---|
| Slash commands don't appear | Check `DISCORD_DEV_GUILD_ID`, then run `pnpm discord:register` again |
| The bot ignores messages | Turn on Message Content Intent, and make sure only one `dev:server` uses the token |
| `org not seeded` | Run `/tether setup` in Discord first |
| Tether stays on "thinking" or reports a quota error | You've hit Gemini's daily limit: add keys or switch to the lite model |
| A button says it needs a Lead | Give yourself the Lead role from `/tether channels` |
