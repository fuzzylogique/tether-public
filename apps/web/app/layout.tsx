import "./globals.css";
import type { Metadata } from "next";
import Link from "next/link";
import { Fraunces, IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import { Nav } from "@/components/nav";

const display = Fraunces({ subsets: ["latin"], variable: "--font-display", weight: ["500", "600"] });
const body = IBM_Plex_Sans({ subsets: ["latin"], variable: "--font-body", weight: ["400", "500", "600"] });
const mono = IBM_Plex_Mono({ subsets: ["latin"], variable: "--font-mono", weight: ["400", "500"] });

export const metadata: Metadata = { title: "Tether", description: "Agentic event operations" };
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body className="min-h-screen flex flex-col">
        <Nav />
        <main className="max-w-6xl w-full mx-auto px-4 sm:px-6 py-8 flex-1">{children}</main>
        <footer className="border-t rule">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex justify-between label">
            <span>Tether</span>
            <span className="flex gap-5">
              <Link href="/terms" className="hover:text-[var(--ink)]">Terms</Link>
              <Link href="/privacy" className="hover:text-[var(--ink)]">Privacy</Link>
            </span>
          </div>
        </footer>
      </body>
    </html>
  );
}
