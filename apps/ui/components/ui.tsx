import type { ReactNode } from "react";
import Link from "next/link";
import type { IssueType, Rating, Severity } from "@qualis/schema";
import {
  Ban,
  Bug,
  ChevronDown,
  ChevronsUp,
  ChevronUp,
  CircleCheck,
  CircleMinus,
  CircleX,
  Folder,
  Info,
  Lock,
  ShieldAlert,
  Wrench,
  type Icon,
} from "@/components/icons";
import { fInt } from "@/lib/format";
import { fileMark, SEVERITY_LABEL, TYPE_LABEL } from "@/lib/vocab";
import { smoothPath } from "./smooth";
import { TrendChart, type TrendFormat as ChartFormat } from "./TrendChart";

export { smoothPath };

export function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

/** Tabler "shield-check", the Qualis logo. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M11.46 20.846a12 12 0 0 1 -7.96 -14.846a12 12 0 0 0 8.5 -3a12 12 0 0 0 8.5 3a12 12 0 0 1 -.09 7.06" />
      <path d="M15 19l2 2l4 -4" />
    </svg>
  );
}

export const TYPE_ICON: Record<IssueType, Icon> = { bug: Bug, vulnerability: Lock, "security-hotspot": ShieldAlert, "code-smell": Wrench };
export const SEVERITY_ICON: Record<Severity, Icon> = { blocker: Ban, critical: ChevronsUp, major: ChevronUp, minor: ChevronDown, info: Info };

export function TypeBadge({ type }: { type: IssueType }) {
  return <span className={`tb tb-${type}`}>{TYPE_LABEL[type].badge}</span>;
}

export function TypeIcon({ type, className }: { type: IssueType; className?: string }) {
  const Icon = TYPE_ICON[type];
  return <Icon className={cx(`ty-${type}`, className)} aria-hidden strokeWidth={1.75} />;
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  const Icon = SEVERITY_ICON[severity];
  return (
    <span className={`sev sev-${severity}`}>
      <Icon aria-hidden strokeWidth={1.75} />
      {SEVERITY_LABEL[severity]}
    </span>
  );
}

export type Status = "passed" | "failed" | "no-data";

const STATUS: Record<Status, { cls: string; icon: Icon; label: string }> = {
  passed: { cls: "b-ok", icon: CircleCheck, label: "Passed" },
  failed: { cls: "b-fail", icon: CircleX, label: "Failed" },
  "no-data": { cls: "b-nd", icon: CircleMinus, label: "No data" },
};

/** Status always pairs a colour with an icon and a word. */
export function StatusBadge({ status, label }: { status: Status; label?: string }) {
  const s = STATUS[status];
  const Icon = s.icon;
  return (
    <span className={`badge ${s.cls}`}>
      <Icon aria-hidden strokeWidth={1.75} />
      {label ?? s.label}
    </span>
  );
}

export function Badge({ children, className, title }: { children: ReactNode; className?: string; title?: string }) {
  return (
    <span className={cx("badge", className)} title={title}>
      {children}
    </span>
  );
}

/** A header field: a label above its control, like the analysis select. */
export function HeaderField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="hd-field">
      <span className="label text-[10px]">{label}</span>
      {children}
    </div>
  );
}

export function GatePill({ status, href }: { status: "passed" | "failed" | null; href?: string }) {
  const cls = status === "passed" ? "ok" : status === "failed" ? "fail" : "none";
  const Icon = status === "passed" ? CircleCheck : status === "failed" ? CircleX : CircleMinus;
  const body = (
    <>
      <Icon aria-hidden strokeWidth={1.75} />
      {status === "passed" ? "Passed" : status === "failed" ? "Failed" : "No analysis"}
    </>
  );
  return (
    <HeaderField label="Quality gate">
      {href ? (
        <Link href={href} className={`gate ${cls}`}>
          {body}
        </Link>
      ) : (
        <span className={`gate ${cls}`}>{body}</span>
      )}
    </HeaderField>
  );
}

export function RatingBadge({ rating, size, label }: { rating: Rating | null | undefined; size?: "md" | "lg"; label?: string }) {
  if (!rating) return <span className={cx("rt rt-none", size)} role="img" aria-label={label ? `${label}: no rating` : "No rating"}>–</span>;
  return (
    <span className={cx(`rt rt-${rating}`, size)} role="img" aria-label={label ? `${label} rating ${rating}` : `Rating ${rating}`}>
      {rating}
    </span>
  );
}

/** Position on the A..E scale, a second encoding next to the letter. */
export function RatingScale({ rating }: { rating: Rating }) {
  const letters = ["A", "B", "C", "D", "E"] as const;
  return (
    <span aria-hidden>
      <span className="scale">
        {letters.map((l) => (
          <i key={l} className={l === rating ? "on" : undefined} style={l === rating ? { background: `var(--r-${l.toLowerCase()})` } : undefined} />
        ))}
      </span>
      <span className="scale-l">
        {letters.map((l) => (
          <span key={l}>{l}</span>
        ))}
      </span>
    </span>
  );
}

export function FileMark({ path }: { path: string }) {
  return (
    <span className="ft" aria-hidden>
      {fileMark(path)}
    </span>
  );
}

export function DirMark() {
  return (
    <span className="ft ft-dir" aria-hidden>
      <Folder strokeWidth={1.75} />
    </span>
  );
}

export function Empty({ icon: Icon, title, children }: { icon: Icon; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-ic">
        <Icon aria-hidden strokeWidth={1.75} />
      </div>
      <b className="t">{title}</b>
      {children && <p>{children}</p>}
    </div>
  );
}

export function Note({ children, warn, icon: Icon = Info }: { children: ReactNode; warn?: boolean; icon?: Icon }) {
  return (
    <div className={cx("note", warn && "warn")}>
      <Icon aria-hidden strokeWidth={1.75} />
      <span>{children}</span>
    </div>
  );
}

/** A "?" next to a concept: opens its page of the documentation (/docs). */
export function DocLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="doc-q" aria-label={label} title={label}>
      ?
    </Link>
  );
}

export function CardHeader({
  title,
  subtitle,
  action,
  docs,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  /** The documentation of the card's concept, as a "?" after the title. */
  docs?: { href: string; label: string };
}) {
  return (
    <div className="card-hd">
      <div>
        <h2>
          {title}
          {docs && <DocLink {...docs} />}
        </h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Tile({
  icon: Icon,
  label,
  value,
  sub,
  href,
  delta,
  trend,
  trendFormat = "int",
  better = null,
  visual,
}: {
  icon: Icon;
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  href?: string;
  delta?: { text: string; tone: "good" | "bad" | "flat" } | null;
  /** History under the number, oldest first. */
  trend?: Array<{ date: string; value: number }> | undefined;
  trendFormat?: ChartFormat;
  /** Which direction of change is an improvement, for the colour of the change in the read-out. */
  better?: "lower" | "higher" | null;
  /** Another compact visual under the number (meters), instead of a trend. */
  visual?: ReactNode;
}) {
  const withTrend = (!!trend && trend.length > 0) || !!visual;
  const head = (
    <>
      <div className="tile-top">
        <Icon aria-hidden />
        <span className="tile-l">
          {href && withTrend ? (
            <Link href={href} className="tile-link">
              {label}
            </Link>
          ) : (
            label
          )}
        </span>
        {delta && <span className={`delta ${delta.tone}`}>{delta.text}</span>}
      </div>
      <div className="tile-v">{value}</div>
      {sub && <div className="tile-s">{sub}</div>}
    </>
  );
  if (withTrend) {
    return (
      <div className="tile has-spark">
        {head}
        {visual ?? <TrendChart points={trend!} format={trendFormat} label={label} better={better} />}
      </div>
    );
  }
  return href ? (
    <Link href={href} className="tile">
      {head}
    </Link>
  ) : (
    <div className="tile">{head}</div>
  );
}

export function Ring({ pct, size = 124, stroke = 8, color = "var(--accent)", center, label, small }: { pct: number | null; size?: number; stroke?: number; color?: string; center: ReactNode; label: string; small?: boolean }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = pct === null ? 0 : Math.max(0, Math.min(100, pct));
  return (
    <div className={cx("donut", small && "donut-sm")} style={{ width: size, height: size }} role="img" aria-label={label}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={stroke} />
        {p > 0 && <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeDasharray={`${Math.max(0.01, (c * p) / 100).toFixed(2)} ${c.toFixed(2)}`} />}
      </svg>
      <div className="c">
        <div>{center}</div>
      </div>
    </div>
  );
}

export interface StackRow {
  key: string;
  label: ReactNode;
  text: string;
  value: number;
  color: string;
}

/** Stacked bar plus legend; the legend carries identity (label and value), never colour alone. */
export function Stack({ rows, total, label }: { rows: StackRow[]; total: number; label: string }) {
  return (
    <>
      <div className="stack" role="img" aria-label={`${label}: ${rows.map((r) => `${r.text} ${r.value}`).join(", ")}`}>
        {rows
          .filter((r) => r.value > 0)
          .map((r) => (
            <i key={r.key} style={{ flex: `${r.value} 1 0`, background: r.color }} title={`${r.text}: ${fInt(r.value)}`} />
          ))}
      </div>
      <ul className="stack-legend">
        {rows.map((r) => (
          <li key={r.key} className={r.value ? undefined : "zero"}>
            <span className="sw" style={{ background: r.color }} />
            <span className="nm">{r.label}</span>
            <span className="v">{fInt(r.value)}</span>
            <span className="p">{total ? `${((r.value / total) * 100).toFixed(1)}%` : ""}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

/** Plain text with `inline code` in backticks, paragraphs separated by blank lines (report format convention). */
export function RichText({ text }: { text: string | undefined }) {
  if (!text) return null;
  return (
    <>
      {text.split(/\n\s*\n/).map((para, i) => (
        <p key={i}>
          <InlineCode text={para} />
        </p>
      ))}
    </>
  );
}

export function InlineCode({ text }: { text: string }) {
  return (
    <>
      {text.split(/(`[^`]+`)/).map((part, i) => (part.startsWith("`") && part.endsWith("`") && part.length > 1 ? <code key={i}>{part.slice(1, -1)}</code> : part))}
    </>
  );
}
