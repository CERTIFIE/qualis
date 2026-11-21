"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { BookOpen, ChartDots, ChevronDown, ListCheck, Rocket, type Icon } from "@/components/icons";
import type { DocsNav, DocsPage } from "@/lib/docs";

/** Icons of the sidebar groups, by their Tabler name in the generated navigation. */
const GROUP_ICONS: Record<string, Icon> = { rocket: Rocket, "chart-dots": ChartDots, "list-check": ListCheck, "book-2": BookOpen };

/** The item of the sidebar a path belongs to: itself, or the page above it (a rule belongs to its plugin's list). */
function isActive(href: string, pathname: string): boolean {
  if (href === pathname || (href === "/docs" && pathname === "/docs/index")) return true;
  return href !== "/docs" && href !== "/docs/rules/index" && pathname.startsWith(`${href}/`);
}

/**
 * Moves an indicator onto the active element of a list: it slides to the new item instead of jumping.
 * `selector` finds the active element inside `list`; `deps` re-measure it.
 */
function useIndicator(list: React.RefObject<HTMLElement | null>, selector: string, deps: unknown[]) {
  const [box, setBox] = useState<{ top: number; height: number } | null>(null);
  useLayoutEffect(() => {
    const el = list.current?.querySelector<HTMLElement>(selector);
    setBox(el ? { top: el.offsetTop, height: el.offsetHeight } : null);
  }, deps);
  return box;
}

export function DocsSidebar({ nav }: { nav: DocsNav }) {
  const pathname = usePathname();
  const list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const box = useIndicator(list, '[aria-current="page"]', [pathname]);
  useEffect(() => setOpen(false), [pathname]);
  return (
    <aside className="dside" data-open={open || undefined}>
      <button type="button" className="dside-toggle" aria-expanded={open} aria-controls="docs-nav" onClick={() => setOpen((v) => !v)}>
        Documentation menu
        <ChevronDown aria-hidden />
      </button>
      <div className="dside-fold">
        <div className="dside-in" id="docs-nav" ref={list}>
          {box && <span className="dside-ind" style={{ transform: `translateY(${box.top}px)`, height: box.height }} aria-hidden />}
          <div className="label dside-ver">Version {nav.version}</div>
          {nav.groups.map((g) => {
            const GroupIcon = GROUP_ICONS[g.icon] ?? BookOpen;
            return (
              <div key={g.title} className="dside-grp">
                <div className="dside-gt">
                  <GroupIcon aria-hidden />
                  {g.title}
                </div>
                {g.items.map((item) => (
                  <Link key={item.href} href={item.href} className="dside-a" aria-current={isActive(item.href, pathname) ? "page" : undefined}>
                    {item.title}
                  </Link>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
}

/** "On this page": follows the section in view. */
export function DocsToc({ toc }: { toc: DocsPage["toc"] }) {
  const [active, setActive] = useState(toc[0]?.id);
  const list = useRef<HTMLDivElement>(null);
  const box = useIndicator(list, ".active", [active]);
  useEffect(() => {
    const headings = toc.map((t) => document.getElementById(t.id)).filter((h): h is HTMLElement => h !== null);
    if (!headings.length) return;
    // The last heading above the upper third of the window is the section being read.
    const update = () => {
      const line = window.innerHeight / 3;
      let current = headings[0]!.id;
      for (const h of headings) if (h.getBoundingClientRect().top <= line) current = h.id;
      setActive(current);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, [toc]);
  return (
    <nav className="dtoc" aria-label="On this page">
      <div className="label dtoc-t">On this page</div>
      <div className="dtoc-in" ref={list}>
        {box && <span className="dtoc-ind" style={{ transform: `translateY(${box.top}px)`, height: box.height }} aria-hidden />}
        {toc.map((t) => (
          <a key={t.id} href={`#${t.id}`} className={`${t.depth === 3 ? "sub " : ""}${t.id === active ? "active" : ""}`}>
            {t.text}
          </a>
        ))}
      </div>
    </nav>
  );
}

/**
 * The rendered Markdown of a page, with the behaviour the static site gives it: code tabs, copy buttons, the filters
 * of the rule catalog, and links to other /docs pages that navigate inside the app.
 */
export function DocsBody({ html }: { html: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const copy = target.closest<HTMLButtonElement>("[data-copy-code]");
      if (copy) {
        const block = copy.closest(".doc-code");
        const pre = block?.querySelector<HTMLElement>("pre:not([hidden])");
        if (pre) {
          void navigator.clipboard?.writeText(pre.innerText).then(() => {
            const label = copy.querySelector(".copy-label");
            if (!label) return;
            label.textContent = "Copied";
            setTimeout(() => (label.textContent = "Copy"), 1500);
          });
        }
        return;
      }
      const tab = target.closest<HTMLButtonElement>(".tab-btn");
      if (tab) {
        const block = tab.closest("[data-tabs]");
        for (const b of block?.querySelectorAll<HTMLButtonElement>(".tab-btn") ?? []) b.setAttribute("aria-selected", String(b === tab));
        for (const p of block?.querySelectorAll<HTMLElement>("[data-panel]") ?? []) p.hidden = p.dataset.panel !== tab.dataset.tab;
        return;
      }
      const link = target.closest<HTMLAnchorElement>("a[href^='/']");
      if (link && !e.metaKey && !e.ctrlKey && !e.shiftKey && e.button === 0) {
        e.preventDefault();
        router.push(link.getAttribute("href")!);
      }
    };
    // Rule catalog (All rules): text, language, type and severity filters.
    const filters = [...root.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-filter]")];
    const rows = [...root.querySelectorAll<HTMLElement>("[data-rule]")];
    const count = root.querySelector("#rule-count");
    const filter = () => {
      const value = (name: string) => filters.find((f) => f.dataset.filter === name)?.value.trim().toLowerCase() ?? "";
      const words = value("text").split(/\s+/).filter(Boolean);
      const [plugin, type, severity] = [value("plugin"), value("type"), value("severity")];
      let shown = 0;
      for (const row of rows) {
        const ok =
          words.every((w) => row.dataset.search?.includes(w)) &&
          (!plugin || row.dataset.plugin === plugin) &&
          (!type || row.dataset.type === type) &&
          (!severity || row.dataset.severity === severity);
        row.hidden = !ok;
        if (ok) shown++;
      }
      if (count) count.textContent = String(shown);
    };
    root.addEventListener("click", onClick);
    for (const f of filters) f.addEventListener("input", filter);
    return () => {
      root.removeEventListener("click", onClick);
      for (const f of filters) f.removeEventListener("input", filter);
    };
  }, [html, router]);
  return <div ref={ref} className="doc-prose" dangerouslySetInnerHTML={{ __html: html }} />;
}
