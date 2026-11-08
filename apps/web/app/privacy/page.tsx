import { PageTitle } from "@/components/ui";

export const metadata = { title: "Privacy · Tether" };

export default function Privacy() {
  return (
    <div className="max-w-2xl space-y-6">
      <PageTitle>Privacy Policy</PageTitle>
      <div className="panel p-5 text-sm" style={{ borderColor: "var(--accent)" }}>
        <p className="label" style={{ color: "var(--accent)" }}>Placeholder</p>
        <p className="mt-2">This page needs a real privacy policy before launch. Tether reads Discord messages, Gmail, Google Calendar and Google Sheets on the organizers&apos; behalf and stores records in Postgres, so the policy should say what is collected, why, where it is stored, and how long it is kept.</p>
      </div>
    </div>
  );
}
