import type { ReactNode } from "react";
import { DocsSidebar } from "@/components/docs";
import { BookOff } from "@/components/icons";
import { Empty } from "@/components/ui";
import { docsNav } from "@/lib/docs";

/** The documentation inside the app: its sidebar next to the page (and the page's index). */
export default async function DocsLayout({ children }: { children: ReactNode }) {
  const nav = await docsNav();
  if (!nav) {
    return (
      <div className="wrap pt-10">
        <div className="card">
          <Empty icon={BookOff} title="The documentation is not built">
            Run <code>pnpm docs:build</code> in the Qualis repository, then reload this page.
          </Empty>
        </div>
      </div>
    );
  }
  return (
    <div className="wrap docs">
      <DocsSidebar nav={nav} />
      <div className="docs-main">{children}</div>
    </div>
  );
}
