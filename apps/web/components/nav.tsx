import Link from "next/link";
import { currentUser, authConfigured } from "@/lib/auth0";
import { Ribbon, TetherMark } from "./marks";

export async function Nav() {
  const user = await currentUser();
  return (
    <header className="border-b" style={{ borderColor: "var(--rule)" }}>
      <Ribbon />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-6">
        <Link href="/" className="flex items-center gap-3">
          <TetherMark />
          <span className="font-display text-2xl font-semibold">Tether</span>
        </Link>
        <div className="flex items-center gap-4 text-sm">
          {user ? (
            <>
              <span className="hidden sm:inline">{user.name}</span>
              {authConfigured && <a href="/auth/logout" className="muted link">Sign out</a>}
            </>
          ) : <a href="/auth/login" className="link">Sign in</a>}
        </div>
      </div>
    </header>
  );
}
