// A small tokenizer for TypeScript, JavaScript and C#: keywords, strings, comments, numbers, types and calls.
// It only colours text; it does not need to be a parser.

export type TokenKind = "k" | "s" | "c" | "n" | "t" | "f" | null;
export type Segment = { text: string; kind: TokenKind };
export type RangeMark = { start: number; end: number; cls: string };
export type Piece = { text: string; kind: TokenKind; mark?: string };

const KEYWORDS = new Set(
  (
    "import export from const let var function return if else for while do switch case break continue new class extends implements interface " +
    "type enum async await try catch finally throw typeof instanceof in of as default public private protected readonly static void null " +
    "undefined true false this super yield satisfies keyof declare namespace using internal sealed override virtual abstract record struct " +
    "string int bool long double decimal object base is out ref params foreach lock get set init where"
  ).split(" "),
);

export function tokenize(lines: string[]): Segment[][] {
  let mode: "comment" | "template" | null = null;
  return lines.map((line) => {
    const segs: Segment[] = [];
    const push = (text: string, kind: TokenKind) => {
      if (text) segs.push({ text, kind });
    };
    let i = 0;
    while (i < line.length) {
      if (mode === "comment") {
        const end = line.indexOf("*/", i);
        if (end < 0) {
          push(line.slice(i), "c");
          i = line.length;
        } else {
          push(line.slice(i, end + 2), "c");
          i = end + 2;
          mode = null;
        }
        continue;
      }
      if (mode === "template") {
        let j = i;
        while (j < line.length && line[j] !== "`") j += line[j] === "\\" ? 2 : 1;
        if (j >= line.length) {
          push(line.slice(i), "s");
          i = line.length;
        } else {
          push(line.slice(i, j + 1), "s");
          i = j + 1;
          mode = null;
        }
        continue;
      }
      const ch = line[i]!;
      const rest = line.slice(i);
      if (rest.startsWith("//")) {
        push(rest, "c");
        break;
      }
      if (rest.startsWith("/*")) {
        push("/*", "c");
        i += 2;
        mode = "comment";
        continue;
      }
      if (ch === "`") {
        push("`", "s");
        i++;
        mode = "template";
        continue;
      }
      if (ch === '"' || ch === "'") {
        let j = i + 1;
        while (j < line.length && line[j] !== ch) j += line[j] === "\\" ? 2 : 1;
        push(line.slice(i, j + 1), "s");
        i = j + 1;
        continue;
      }
      const word = /^[A-Za-z_$][\w$]*/.exec(rest);
      if (word) {
        const w = word[0];
        push(w, KEYWORDS.has(w) ? "k" : /^[A-Z]/.test(w) ? "t" : line[i + w.length] === "(" ? "f" : null);
        i += w.length;
        continue;
      }
      const num = /^\d[\d_.xXa-fA-FnN]*/.exec(rest);
      if (num) {
        push(num[0], "n");
        i += num[0].length;
        continue;
      }
      let j = i + 1;
      while (j < line.length && !/[A-Za-z_$0-9"'`/]/.test(line[j]!)) j++;
      push(line.slice(i, j), null);
      i = j;
    }
    return segs;
  });
}

/** Splits the segments of a line at the issue ranges (0-based, end exclusive) so that each piece has one mark. */
export function markRanges(segs: Segment[], ranges: RangeMark[]): Piece[] {
  if (!ranges.length) return segs;
  const out: Piece[] = [];
  let pos = 0;
  for (const seg of segs) {
    const end = pos + seg.text.length;
    const cuts = new Set([pos, end]);
    for (const r of ranges) {
      if (r.start > pos && r.start < end) cuts.add(r.start);
      if (r.end > pos && r.end < end) cuts.add(r.end);
    }
    const sorted = [...cuts].sort((a, b) => a - b);
    for (let k = 0; k < sorted.length - 1; k++) {
      const a = sorted[k]!;
      const b = sorted[k + 1]!;
      const mark = ranges.find((r) => a >= r.start && b <= r.end);
      out.push({ text: seg.text.slice(a - pos, b - pos), kind: seg.kind, ...(mark ? { mark: mark.cls } : {}) });
    }
    pos = end;
  }
  return out;
}
