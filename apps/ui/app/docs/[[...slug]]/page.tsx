import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DocsBody, DocsToc } from "@/components/docs";
import { ChevronLeft, ChevronRight } from "@/components/icons";
import { docsPage } from "@/lib/docs";

type Params = { params: Promise<{ slug?: string[] }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const page = await docsPage((await params).slug);
  return page ? { title: page.title, description: page.description } : { title: "Documentation" };
}

export default async function DocsRoute({ params }: Params) {
  const page = await docsPage((await params).slug);
  if (!page) notFound();
  return (
    // Keyed by page: each page enters with the same short fade (globals.css, .docs-page).
    <div key={page.slug} className={`docs-page${page.wide ? " wide" : ""}${page.toc.length ? "" : " no-toc"}`}>
      <article className="docs-article">
        <div className="label">{page.group}</div>
        <h1 className="docs-title">{page.title}</h1>
        {page.description && <p className="docs-lead">{page.description}</p>}
        <DocsBody html={page.html} />
        {(page.prev || page.next) && (
          <nav className="docs-pager" aria-label="Pagination">
            {page.prev ? (
              <Link href={page.prev.href}>
                <span className="label">
                  <ChevronLeft aria-hidden />
                  Previous
                </span>
                {page.prev.title}
              </Link>
            ) : (
              <span />
            )}
            {page.next ? (
              <Link href={page.next.href} className="next">
                <span className="label">
                  Next
                  <ChevronRight aria-hidden />
                </span>
                {page.next.title}
              </Link>
            ) : (
              <span />
            )}
          </nav>
        )}
      </article>
      {page.toc.length > 0 && <DocsToc toc={page.toc} />}
    </div>
  );
}
