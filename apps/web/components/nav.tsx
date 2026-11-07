import Link from "next/link";
import { currentUser, authConfigured } from "@/lib/auth0";

export async function Nav() {
  const user = await currentUser();
  const links = [["/", "Overview"], ["/approvals", "Approvals"], ["/runs", "Runs"], ["/agents", "Agents & policies"]];
  return (
    <header className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: "var(--border)" }}>
      <div className="flex items-center gap-8">
        <Link href="/" className="font-semibold tracking-tight text-lg">
          <span style={{ color: "var(--accent)" }}>●</span> Tether
        </Link>
        <nav className="flex gap-5 text-sm">
          {links.map(([href, label]) => <Link key={href} href={href} className="muted hover:text-white">{label}</Link>)}
        </nav>
      </div>
      <div className="flex items-center gap-3 text-sm">
        {user ? (
          <>
            <span className="pill">{user.roles.join(", ")}</span>
            <span>{user.name}</span>
            {authConfigured && <a href="/auth/logout" className="muted">Sign out</a>}
          </>
        ) : <a href="/auth/login">Sign in</a>}
      </div>
    </header>
  );
}
