import { SlashCommandBuilder } from "discord.js";
import { workspaceCommands } from "./workspace.js";

export const commands = [
  new SlashCommandBuilder().setName("budget").setDescription("Finances")
    .addSubcommand((s) => s.setName("summary").setDescription("Allocated vs spent").addStringOption((o) => o.setName("category").setDescription("Category").setAutocomplete(true)))
    .addSubcommand((s) => s.setName("log").setDescription("Log an expense")
      .addNumberOption((o) => o.setName("amount").setDescription("Amount").setRequired(true))
      .addStringOption((o) => o.setName("category").setDescription("Category").setRequired(true).setAutocomplete(true))
      .addStringOption((o) => o.setName("vendor").setDescription("Vendor"))
      .addStringOption((o) => o.setName("description").setDescription("What for")))
    .addSubcommand((s) => s.setName("receipt").setDescription("Log an expense from a receipt photo")
      .addAttachmentOption((o) => o.setName("image").setDescription("Receipt image").setRequired(true))
      .addStringOption((o) => o.setName("note").setDescription("Anything the agent should know"))),

  new SlashCommandBuilder().setName("sponsor").setDescription("Sponsorship pipeline")
    .addSubcommand((s) => s.setName("list").setDescription("Pipeline").addStringOption((o) => o.setName("stage").setDescription("Stage").addChoices(
      ...["lead", "contacted", "replied", "negotiating", "confirmed", "declined"].map((v) => ({ name: v, value: v })))))
    .addSubcommand((s) => s.setName("followup").setDescription("Draft follow-ups for stale sponsors").addIntegerOption((o) => o.setName("days").setDescription("Silent for N days (default 5)")))
    .addSubcommand((s) => s.setName("ask").setDescription("Ask the outreach agent").addStringOption((o) => o.setName("request").setDescription("Request").setRequired(true))),

  new SlashCommandBuilder().setName("task").setDescription("Coordination")
    .addSubcommand((s) => s.setName("list").setDescription("Tasks").addBooleanOption((o) => o.setName("overdue").setDescription("Only overdue")))
    .addSubcommand((s) => s.setName("add").setDescription("Add a task")
      .addStringOption((o) => o.setName("title").setDescription("Title").setRequired(true))
      .addUserOption((o) => o.setName("owner").setDescription("Owner"))
      .addStringOption((o) => o.setName("due").setDescription("Due, e.g. 'Saturday 9am' or ISO"))),

  new SlashCommandBuilder().setName("cal").setDescription("Calendar")
    .addSubcommand((s) => s.setName("today").setDescription("Today's events"))
    .addSubcommand((s) => s.setName("add").setDescription("Create an event via the calendar agent").addStringOption((o) => o.setName("request").setDescription("e.g. Judge briefing Sat 9-9:30am in Room 204").setRequired(true))),

  new SlashCommandBuilder().setName("post").setDescription("Socials")
    .addSubcommand((s) => s.setName("draft").setDescription("Draft a post with image")
      .addStringOption((o) => o.setName("brief").setDescription("What the post is about").setRequired(true))
      .addStringOption((o) => o.setName("platform").setDescription("Platform").addChoices(
        { name: "instagram", value: "instagram" }, { name: "linkedin", value: "linkedin" }, { name: "twitter", value: "twitter" }, { name: "discord", value: "discord" })))
    .addSubcommand((s) => s.setName("recap").setDescription("Recap post from the photos in #photos")
      .addStringOption((o) => o.setName("brief").setDescription("What to recap, e.g. 'Day 1: opening ceremony and late-night hacking'"))
      .addIntegerOption((o) => o.setName("photos").setDescription("How many photos (1-8, default 4)").setMinValue(1).setMaxValue(8))
      .addStringOption((o) => o.setName("platform").setDescription("Platform").addChoices(
        { name: "instagram", value: "instagram" }, { name: "linkedin", value: "linkedin" }, { name: "twitter", value: "twitter" }, { name: "discord", value: "discord" }))),

  new SlashCommandBuilder().setName("plan").setDescription("Multi-step request: Tether proposes a plan you approve")
    .addStringOption((o) => o.setName("request").setDescription("What needs to happen (optional when reading the chat)"))
    .addIntegerOption((o) => o.setName("from_chat").setDescription("Also read the last N messages in this channel and plan from the discussion").setMinValue(5).setMaxValue(100)),

  new SlashCommandBuilder().setName("digest").setDescription("Summarize the organizer inbox: what needs a reply, what is FYI")
    .addIntegerOption((o) => o.setName("hours").setDescription("Window in hours (default 24)").setMinValue(1).setMaxValue(336))
    .addStringOption((o) => o.setName("query").setDescription("Extra Gmail search terms, e.g. from:shopify.com")),

  new SlashCommandBuilder().setName("workflow").setDescription("Standing workflows (prebuilt multi-step plans)")
    .addSubcommand((s) => s.setName("list").setDescription("What workflows exist and what fires them"))
    .addSubcommand((s) => s.setName("run").setDescription("Fire a workflow now")
      .addStringOption((o) => o.setName("name").setDescription("Workflow").setRequired(true).setAutocomplete(true))
      .addStringOption((o) => o.setName("sponsor").setDescription("Sponsor / company name"))
      .addNumberOption((o) => o.setName("amount").setDescription("Amount in dollars"))
      .addStringOption((o) => o.setName("tier").setDescription("Tier, e.g. Gold"))
      .addStringOption((o) => o.setName("contact").setDescription("Contact name"))
      .addStringOption((o) => o.setName("email").setDescription("Contact email"))
      .addStringOption((o) => o.setName("notes").setDescription("Anything else"))),

  new SlashCommandBuilder().setName("agent").setDescription("Open a thread with one specialized agent")
    .addStringOption((o) => o.setName("name").setDescription("Agent").setRequired(true).setAutocomplete(true))
    .addStringOption((o) => o.setName("request").setDescription("First message").setRequired(true)),

  new SlashCommandBuilder().setName("tether").setDescription("Setup and admin")
    .addSubcommand((s) => s.setName("setup").setDescription("Configure this server")
      .addStringOption((o) => o.setName("name").setDescription("Org/event name"))
      .addStringOption((o) => o.setName("sheet_id").setDescription("Google Sheet id"))
      .addStringOption((o) => o.setName("calendar_id").setDescription("Google Calendar id"))
      .addChannelOption((o) => o.setName("ops").setDescription("Ops channel (escalations)"))
      .addChannelOption((o) => o.setName("announcements").setDescription("Announcements channel"))
      .addChannelOption((o) => o.setName("sponsorship").setDescription("Sponsorship channel"))
      .addChannelOption((o) => o.setName("photos").setDescription("Channel where the team drops event photos")))
    .addSubcommand((s) => s.setName("bind").setDescription("Bind a channel to an agent (Tier 1)")
      .addChannelOption((o) => o.setName("channel").setDescription("Channel").setRequired(true))
      .addStringOption((o) => o.setName("agent").setDescription("Agent").setRequired(true).setAutocomplete(true)))
    .addSubcommand((s) => s.setName("channels").setDescription("Create team channels (ops, tasks, calendar, finance, sponsorship, socials, photos)")
      .addBooleanOption((o) => o.setName("roles").setDescription("Also create team roles (Lead, Finance, Sponsorship, Socials, Logistics); default on"))
      .addBooleanOption((o) => o.setName("bind").setDescription("Route plain messages in each team channel to its agent; default off")))
    .addSubcommand((s) => s.setName("links").setDescription("Shared calendar, sheet, and Drive links"))
    .addSubcommand((s) => s.setName("policies").setDescription("Show org policies"))
    .addSubcommand((s) => s.setName("status").setDescription("Recent runs")),
].map((c) => c.toJSON()).concat(workspaceCommands);
