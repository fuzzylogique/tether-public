import { PageTitle } from "@/components/ui";

export const metadata = { title: "Terms · Tether" };

export default function Terms() {
  return (
    <div className="max-w-2xl space-y-6">
      <PageTitle>Terms of Service</PageTitle>
      <div className="panel p-5 text-sm" style={{ borderColor: "var(--accent)" }}>
        <p className="label" style={{ color: "var(--accent)" }}>Placeholder</p>
        <p className="mt-2">This page needs real terms before Tether is offered to anyone outside the organizing team. Replace this text with terms reviewed by someone qualified to write them.</p>
      </div>
    </div>
  );
}
