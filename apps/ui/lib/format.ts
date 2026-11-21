// Number, duration and date formatting shared by every screen (English, en-US digits, en-GB dates).

const integer = new Intl.NumberFormat("en-US");
const compactFormat = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

export function fInt(n: number | null | undefined): string {
  return n === null || n === undefined ? "—" : integer.format(n);
}

export function fPct(n: number | null | undefined, digits = 1): string {
  return n === null || n === undefined ? "—" : `${n.toFixed(digits)}%`;
}

export function fCompact(n: number): string {
  return compactFormat.format(n);
}

/** Remediation effort in minutes, as `45min`, `3h` or `50h 7min`. */
export function fDebt(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return "—";
  if (minutes < 60) return `${minutes}min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}min` : `${h}h`;
}

export function fDate(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";
}

export function fDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

/** "5 min ago", "3 h ago", "2 days ago". */
export function fAgo(iso: string, now = Date.now()): string {
  const mins = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 1440) return `${Math.round(mins / 60)} h ago`;
  const days = Math.round(mins / 1440);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

export function fSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}
