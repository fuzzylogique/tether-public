import Link from "next/link";
import { currentUser, authConfigured } from "@/lib/auth0";

export async function Nav() {
  const user = await currentUser();
  const links = [["/", "Overview"], ["/approvals", "Approvals"], ["/runs", "Runs"], ["/agents", "Agents & policies"]];
  return (
    <header className="border-b-2" style={{ borderColor: "var(--rule-strong)" }}>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-x-10 gap-y-3">
        <Link href="/" className="font-display text-2xl font-semibold">
          Tether<span style={{ color: "var(--accent)" }}>.</span>
        </Link>
        <nav className="order-last md:order-none w-full md:w-auto md:mr-auto flex gap-6 text-sm overflow-x-auto whitespace-nowrap">
          {links.map(([href, label]) => <Link key={href} href={href} className="nav-link">{label}</Link>)}
        </nav>
        <div className="flex items-center gap-4 text-sm">
          {user ? (
            <>
              <span className="label">{user.roles.join(", ")}</span>
              <span className="hidden sm:inline">{user.name}</span>
              {authConfigured && <a href="/auth/logout" className="muted link">Sign out</a>}
            </>
          ) : <a href="/auth/login" className="link">Sign in</a>}
        </div>
      </div>
    </header>
  );
}
