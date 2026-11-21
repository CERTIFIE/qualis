import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { HeaderNav, HeaderSearch, SiteHeader } from "@/components/client";
import { DialogsProvider } from "@/components/dialogs";
import { Logo } from "@/components/ui";
import "./globals.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "Qualis", template: "%s · Qualis" },
  description: "Code quality of your projects: quality gate, ratings, issues, coverage, duplications and complexity, read from the analyses of qualis analyze.",
  icons: { icon: "/logo.svg" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <DialogsProvider>
          <SiteHeader>
            <div className="hdr-in">
              <Link href="/" className="brand" aria-label="Qualis home">
                <Logo />
                <b>Qualis</b>
              </Link>
              <Suspense>
                <HeaderNav />
              </Suspense>
              <div className="hdr-right">
                <Suspense>
                  <HeaderSearch />
                </Suspense>
              </div>
            </div>
          </SiteHeader>
          <main className="min-h-[calc(100vh-56px-100px)] pb-20">{children}</main>
          <footer className="ft-main">
            <div className="wrap">
              <span className="fbrand">
                <Logo />
                Qualis
              </span>
              <span>Open report format · any tool can read the same report.json</span>
            </div>
          </footer>
        </DialogsProvider>
      </body>
    </html>
  );
}
