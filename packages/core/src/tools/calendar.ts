import { z } from "zod";
import { eq } from "drizzle-orm";
import { defineTool } from "./types.js";
import { calendarEvents } from "../db/schema.js";
import { createEvent, deleteEvent, listEvents } from "../google/calendar.js";

export const listCalendar = defineTool({
  name: "list_events",
  description: "List calendar events in a time window (ISO timestamps).",
  input: z.object({ from: z.string(), to: z.string() }),
  effect: "read", risk: "low",
  summarize: (a) => `List events ${a.from} → ${a.to}`,
  async execute(args, ctx) {
    if (!ctx.org.calendarId) return { error: "no calendar configured" };
    return listEvents(ctx.org.calendarId, args.from, args.to);
  },
});

export const createCalendarEvent = defineTool({
  name: "create_event",
  description: "Create a calendar event and optionally invite attendees by email.",
  input: z.object({
    title: z.string(), start: z.string().describe("ISO datetime"), end: z.string().describe("ISO datetime"),
    location: z.string().optional(), description: z.string().optional(), attendees: z.array(z.string().email()).optional(),
  }),
  effect: "write", risk: "medium",
  editFields: [
    { key: "title", label: "Title", style: "short", required: true }, { key: "start", label: "Start (ISO)", style: "short", required: true },
    { key: "end", label: "End (ISO)", style: "short", required: true }, { key: "location", label: "Where", style: "short" },
    { key: "attendees", label: "Attendees (comma-separated emails)", style: "paragraph" },
  ],
  summarize: (a) => `Create event "${a.title}" at ${a.start}${a.attendees?.length ? ` with ${a.attendees.length} invitees` : ""}`,
  async execute(args, ctx) {
    if (!ctx.org.calendarId) return { error: "no calendar configured" };
    const ev = await createEvent(ctx.org.calendarId, args);
    await ctx.db.insert(calendarEvents).values({
      orgId: ctx.org.id, googleEventId: ev.id, title: args.title, startAt: new Date(args.start), endAt: new Date(args.end),
      location: args.location, attendees: args.attendees ?? [],
    }).onConflictDoNothing();
    return ev;
  },
  async undo(_args, result, ctx) {
    if (ctx.org.calendarId && result && "id" in result && result.id) {
      await deleteEvent(ctx.org.calendarId, result.id);
      await ctx.db.delete(calendarEvents).where(eq(calendarEvents.googleEventId, result.id));
    }
  },
});

export const findConflicts = defineTool({
  name: "find_conflicts",
  description: "Check whether a proposed time overlaps existing events.",
  input: z.object({ start: z.string(), end: z.string() }),
  effect: "read", risk: "low",
  summarize: (a) => `Check conflicts ${a.start} → ${a.end}`,
  async execute(args, ctx) {
    if (!ctx.org.calendarId) return { conflicts: [] };
    const evs = await listEvents(ctx.org.calendarId, args.start, args.end);
    return { conflicts: evs };
  },
});

export const calendarTools = [listCalendar, createCalendarEvent, findConflicts];
