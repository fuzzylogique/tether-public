import { SlashCommandBuilder } from "discord.js";

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
        { name: "instagram", value: "instagram" }, { name: "linkedin", value: "linkedin" }, { name: "twitter", value: "twitter" }, { name: "discord", value: "discord" }))),

  new SlashCommandBuilder().setName("plan").setDescription("Multi-step request: Tether proposes a plan you approve")
    .addStringOption((o) => o.setName("request").setDescription("What needs to happen").setRequired(true)),

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
      .addChannelOption((o) => o.setName("sponsorship").setDescription("Sponsorship channel")))
    .addSubcommand((s) => s.setName("bind").setDescription("Bind a channel to an agent (Tier 1)")
      .addChannelOption((o) => o.setName("channel").setDescription("Channel").setRequired(true))
      .addStringOption((o) => o.setName("agent").setDescription("Agent").setRequired(true).setAutocomplete(true)))
    .addSubcommand((s) => s.setName("policies").setDescription("Show org policies"))
    .addSubcommand((s) => s.setName("status").setDescription("Recent runs")),
].map((c) => c.toJSON());
