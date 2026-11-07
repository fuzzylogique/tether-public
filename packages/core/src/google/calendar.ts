import { calendarApi } from "./client.js";

export async function listEvents(calendarId: string, timeMin: string, timeMax: string) {
  const res = await calendarApi().events.list({
    calendarId, timeMin, timeMax, singleEvents: true, orderBy: "startTime", maxResults: 50,
  });
  return (res.data.items ?? []).map((e) => ({
    id: e.id ?? "",
    title: e.summary ?? "(untitled)",
    start: e.start?.dateTime ?? e.start?.date ?? "",
    end: e.end?.dateTime ?? e.end?.date ?? "",
    location: e.location ?? undefined,
    attendees: (e.attendees ?? []).map((a) => a.email ?? "").filter(Boolean),
  }));
}

export async function createEvent(calendarId: string, ev: {
  title: string; start: string; end: string; location?: string; description?: string; attendees?: string[];
}) {
  const res = await calendarApi().events.insert({
    calendarId,
    sendUpdates: ev.attendees?.length ? "all" : "none",
    requestBody: {
      summary: ev.title,
      location: ev.location,
      description: ev.description,
      start: { dateTime: ev.start },
      end: { dateTime: ev.end },
      attendees: ev.attendees?.map((email) => ({ email })),
    },
  });
  return { id: res.data.id ?? "", htmlLink: res.data.htmlLink ?? "" };
}

export async function deleteEvent(calendarId: string, eventId: string) {
  await calendarApi().events.delete({ calendarId, eventId });
}
