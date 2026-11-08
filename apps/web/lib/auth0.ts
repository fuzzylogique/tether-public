import { Auth0Client } from "@auth0/nextjs-auth0/server";

export const authConfigured = !!(process.env.AUTH0_DOMAIN && process.env.AUTH0_CLIENT_ID && process.env.AUTH0_CLIENT_SECRET && process.env.AUTH0_SECRET);

/** Auth0 Universal Login. Roles arrive on the session via an Auth0 Action that adds `https://tether/roles` to the ID token. */
export const auth0 = authConfigured ? new Auth0Client() : undefined;

export async function currentUser() {
  if (!auth0) return { sub: "dev", name: "Dev user", email: "dev@localhost", emailVerified: true, roles: ["lead"], picture: undefined as string | undefined };
  const session = await auth0.getSession();
  if (!session) return undefined;
  const u = session.user as Record<string, unknown>;
  return {
    sub: String(u.sub ?? ""),
    name: String(u.name ?? u.email ?? "user"),
    email: String(u.email ?? ""),
    // Workspace access matches on email, so an address someone typed at sign-up without verifying it must not count.
    emailVerified: u.email_verified === true,
    picture: u.picture ? String(u.picture) : undefined,
    roles: (u["https://tether/roles"] as string[] | undefined) ?? ["organizer"],
  };
}
