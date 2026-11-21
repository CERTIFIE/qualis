"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Copy, Search } from "@/components/icons";
import { searchDocs, type DocsHit } from "@/lib/docs-search";

/**
 * The page header: a full-width bar at the top of the page, a floating glass pill once the page scrolls (globals.css
 * animates the change). Hysteresis (on past 24px, off above 8px) keeps it from flickering around the threshold.
 */
export function SiteHeader({ children }: { children: ReactNode }) {
  const [floating, setFloating] = useState(false);
  useEffect(() => {
    let on = false;
    let frame = 0;
    const update = () => {
      frame = 0;
      const next = on ? window.scrollY > 8 : window.scrollY > 24;
      if (next !== on) {
        on = next;
        setFloating(next);
      }
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
  return (
    <header className="hdr" data-floating={floating || undefined}>
      {children}
    </header>
  );
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        });
      }}
    >
      <Copy aria-hidden strokeWidth={1.75} />
      {done ? "Copied" : label}
    </button>
  );
}

/** Project slug of the current URL (/p/<slug>/…), if any. */
function useProjectSlug(): string | null {
  const pathname = usePathname();
  const m = /^\/p\/([^/]+)/.exec(pathname);
  return m ? decodeURIComponent(m[1]!) : null;
}

export function HeaderNav() {
  const pathname = usePathname();
  const slug = useProjectSlug();
  const onRules = /^\/p\/[^/]+\/rules/.test(pathname);
  const onDocs = pathname === "/docs" || pathname.startsWith("/docs/");
  const nav = useRef<HTMLElement>(null);
  // The underline of the current tab slides to the next one instead of jumping.
  const [bar, setBar] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const el = nav.current?.querySelector<HTMLElement>('[aria-current="page"]');
    setBar(el ? { left: el.offsetLeft, width: el.offsetWidth } : null);
  }, [pathname, slug]);
  return (
    <nav className="nav" aria-label="Main" ref={nav}>
      <Link href="/" aria-current={!onRules && !onDocs ? "page" : undefined}>
        Projects
      </Link>
      {slug && (
        <Link href={`/p/${encodeURIComponent(slug)}/rules`} aria-current={onRules ? "page" : undefined}>
          Rules
        </Link>
      )}
      <Link href="/docs" aria-current={onDocs ? "page" : undefined}>
        Docs
      </Link>
      {bar && <span className="nav-bar" style={{ transform: `translateX(${bar.left}px)`, width: bar.width }} aria-hidden />}
    </nav>
  );
}

/**
 * Header search: files of the current project, projects on the home page, the documentation (pages and rules, with
 * suggestions while typing) on /docs pages. ⌘K / Ctrl+K and / focus it.
 */
export function HeaderSearch() {
  const router = useRouter();
  const pathname = usePathname();
  const slug = useProjectSlug();
  const onDocs = pathname === "/docs" || pathname.startsWith("/docs/");
  const ref = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState<DocsHit[] | null>(null);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = /input|textarea|select/i.test((document.activeElement as HTMLElement | null)?.tagName ?? "");
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    setOpen(false);
    setQuery("");
  }, [pathname]);
  const loadIndex = () => {
    if (!onDocs || index) return;
    fetch("/api/docs/search")
      .then((r) => (r.ok ? (r.json() as Promise<DocsHit[]>) : []))
      .then(setIndex)
      .catch(() => setIndex([]));
  };
  const hits = onDocs && index ? searchDocs(index, query) : [];
  const go = (url: string) => {
    setOpen(false);
    router.push(url);
  };
  const label = onDocs ? "Search docs" : slug ? "Search files" : "Search projects";
  return (
    <form
      className="search"
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        const q = query.trim();
        if (onDocs) {
          if (hits[active]) go(hits[active].url);
          return;
        }
        router.push(slug ? `/p/${encodeURIComponent(slug)}/code?view=files&q=${encodeURIComponent(q)}` : `/?q=${encodeURIComponent(q)}`);
      }}
    >
      <Search aria-hidden strokeWidth={1.75} />
      <input
        ref={ref}
        type="search"
        placeholder={label}
        aria-label={label}
        autoComplete="off"
        value={query}
        role={onDocs ? "combobox" : undefined}
        aria-expanded={onDocs ? open && hits.length > 0 : undefined}
        aria-controls={onDocs ? "docs-hits" : undefined}
        onFocus={() => {
          loadIndex();
          setOpen(true);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (!onDocs || !hits.length) return;
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => (a + (e.key === "ArrowDown" ? 1 : hits.length - 1)) % hits.length);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      <kbd>⌘K</kbd>
      {onDocs && open && hits.length > 0 && (
        <ul className="search-pop" id="docs-hits" role="listbox">
          {hits.map((h, i) => (
            <li key={h.url} role="option" aria-selected={i === active}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setActive(i)} onClick={() => go(h.url)}>
                <span className="label">{h.section}</span>
                <span className="t">{h.title}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}

/** Text input bound to a search parameter (debounced, replaces the URL). */
export function ParamInput({ name, placeholder, className, reset = [] }: { name: string; placeholder: string; className?: string; reset?: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [value, setValue] = useState(params.get(name) ?? "");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => setValue(params.get(name) ?? ""), [params, name]);
  return (
    <input
      className={className}
      type="search"
      value={value}
      placeholder={placeholder}
      aria-label={placeholder}
      onChange={(e) => {
        const v = e.target.value;
        setValue(v);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          const next = new URLSearchParams(params.toString());
          if (v) next.set(name, v);
          else next.delete(name);
          for (const r of reset) next.delete(r);
          const qs = next.toString();
          router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
        }, 200);
      }}
    />
  );
}

/** Select of the analysis to show (history), as ?a=<id>. */
export function AnalysisSelect({ options, current }: { options: Array<{ id: string; label: string }>; current: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return (
    <label className="hidden gap-1 sm:grid">
      <span className="label text-[10px]">Analysis</span>
      <select
        value={current}
        className="h-9 w-full rounded-md border border-line bg-bg px-2.5 text-[13px] text-fg"
        onChange={(e) => {
          const next = new URLSearchParams(params.toString());
          if (e.target.value === options[0]?.id) next.delete("a");
          else next.set("a", e.target.value);
          const qs = next.toString();
          router.push(qs ? `${pathname}?${qs}` : pathname);
        }}
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Wraps the source table and toggles coverage, duplication and issue marks without a round trip. */
export function CodeFrame({ toolbar, legend, children, notes }: { toolbar: { issues: number; duplications: number }; legend: ReactNode; children: ReactNode; notes?: ReactNode }) {
  const [cov, setCov] = useState(true);
  const [dup, setDup] = useState(true);
  const [iss, setIss] = useState(true);
  return (
    <div className="card">
      <div className="code-tools">
        <div className="flex flex-wrap gap-1.5">
          <label className="chk">
            <input type="checkbox" checked={cov} onChange={(e) => setCov(e.target.checked)} />
            Coverage
          </label>
          <label className="chk">
            <input type="checkbox" checked={dup} onChange={(e) => setDup(e.target.checked)} />
            Duplications{toolbar.duplications ? "" : <span className="muted"> (none)</span>}
          </label>
          <label className="chk">
            <input type="checkbox" checked={iss} onChange={(e) => setIss(e.target.checked)} />
            Issues <span className="muted tabular">{toolbar.issues}</span>
          </label>
        </div>
        {legend}
      </div>
      {notes}
      <div className={`code ${cov ? "show-cov" : "hide-cov"} ${dup ? "" : "hide-dup"} ${iss ? "" : "hide-iss"}`}>{children}</div>
    </div>
  );
}

/** Scrolls the highlighted line into view once, when the page opens on a line or an issue. */
export function ScrollToLine({ line }: { line: number }) {
  useEffect(() => {
    const el = document.getElementById(`L${line}`);
    if (!el) return;
    const r = el.getBoundingClientRect();
    window.scrollTo({ top: window.scrollY + r.top - window.innerHeight / 3 });
  }, [line]);
  return null;
}

export function DrawerToggle({ count }: { count: number }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    document.getElementById("facets")?.classList.toggle("open", open);
  }, [open]);
  return (
    <button type="button" className="btn drawer-btn" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-controls="facets">
      Filters{count ? <span className="count">{count}</span> : null}
    </button>
  );
}
