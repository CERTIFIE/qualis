import type { TextRange } from "@qualis/schema";

/**
 * Converts UTF-16 offsets of a text into 1-based line/column positions.
 * Recognised line terminators: `\r\n`, `\n`, `\r`.
 */
export class LineIndex {
  private readonly starts: number[] = [0];

  constructor(readonly text: string) {
    for (let i = 0; i < text.length; i++) {
      const ch = text.charCodeAt(i);
      if (ch === 13 /* \r */) {
        if (text.charCodeAt(i + 1) === 10) i++;
        this.starts.push(i + 1);
      } else if (ch === 10 /* \n */) {
        this.starts.push(i + 1);
      }
    }
  }

  /** Number of physical lines; a trailing line terminator does not start a new line. */
  get lineCount(): number {
    if (this.text.length === 0) return 0;
    const last = this.starts[this.starts.length - 1]!;
    return last === this.text.length ? this.starts.length - 1 : this.starts.length;
  }

  /** 1-based line of an offset. */
  lineOf(offset: number): number {
    let lo = 0;
    let hi = this.starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.starts[mid]! <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  }

  /** 1-based line and column of an offset. */
  position(offset: number): { line: number; column: number } {
    const line = this.lineOf(offset);
    return { line, column: offset - this.starts[line - 1]! + 1 };
  }

  /** Text range between two offsets (end exclusive). */
  range(start: number, end: number): TextRange {
    const s = this.position(start);
    const e = this.position(Math.max(start, end));
    return { startLine: s.line, startColumn: s.column, endLine: e.line, endColumn: e.column };
  }

  /** Text of a 1-based line without its terminator. */
  lineText(line: number): string {
    const start = this.starts[line - 1];
    if (start === undefined) return "";
    const next = this.starts[line] ?? this.text.length;
    return this.text.slice(start, next).replace(/\r?\n$|\r$/, "");
  }
}

/** Removes a leading UTF-8 byte order mark. */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
