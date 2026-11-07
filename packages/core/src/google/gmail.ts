import { gmailApi } from "./client.js";

function encodeMessage(opts: { to: string; subject: string; body: string; cc?: string; threadId?: string; inReplyTo?: string }) {
  const headers = [
    `To: ${opts.to}`,
    opts.cc ? `Cc: ${opts.cc}` : undefined,
    `Subject: ${opts.subject}`,
    opts.inReplyTo ? `In-Reply-To: ${opts.inReplyTo}` : undefined,
    opts.inReplyTo ? `References: ${opts.inReplyTo}` : undefined,
    "Content-Type: text/plain; charset=utf-8",
    "MIME-Version: 1.0",
  ].filter(Boolean);
  const raw = `${headers.join("\r\n")}\r\n\r\n${opts.body}`;
  return Buffer.from(raw).toString("base64url");
}

export async function createDraft(opts: Parameters<typeof encodeMessage>[0]) {
  const res = await gmailApi().users.drafts.create({
    userId: "me",
    requestBody: { message: { raw: encodeMessage(opts), threadId: opts.threadId } },
  });
  return { draftId: res.data.id ?? "", messageId: res.data.message?.id ?? "" };
}

export async function sendEmail(opts: Parameters<typeof encodeMessage>[0]) {
  const res = await gmailApi().users.messages.send({
    userId: "me",
    requestBody: { raw: encodeMessage(opts), threadId: opts.threadId },
  });
  return { messageId: res.data.id ?? "", threadId: res.data.threadId ?? "" };
}

export type MailSummary = {
  id: string; threadId: string; from: string; to: string; subject: string; date: string; snippet: string; body: string;
};

function header(headers: { name?: string | null; value?: string | null }[] | undefined, name: string) {
  return headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
}

function decodeBody(payload: any): string {
  if (!payload) return "";
  if (payload.body?.data) return Buffer.from(payload.body.data, "base64url").toString("utf8");
  for (const p of payload.parts ?? []) {
    if (p.mimeType === "text/plain" && p.body?.data) return Buffer.from(p.body.data, "base64url").toString("utf8");
  }
  for (const p of payload.parts ?? []) {
    const inner = decodeBody(p);
    if (inner) return inner;
  }
  return "";
}

export async function searchMail(query: string, max = 10): Promise<MailSummary[]> {
  const api = gmailApi();
  const list = await api.users.messages.list({ userId: "me", q: query, maxResults: max });
  const out: MailSummary[] = [];
  for (const m of list.data.messages ?? []) {
    const full = await api.users.messages.get({ userId: "me", id: m.id!, format: "full" });
    const h = full.data.payload?.headers ?? [];
    out.push({
      id: full.data.id ?? "",
      threadId: full.data.threadId ?? "",
      from: header(h, "From"),
      to: header(h, "To"),
      subject: header(h, "Subject"),
      date: header(h, "Date"),
      snippet: full.data.snippet ?? "",
      body: decodeBody(full.data.payload).slice(0, 4000),
    });
  }
  return out;
}
