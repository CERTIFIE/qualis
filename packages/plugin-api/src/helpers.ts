import type { HalsteadCounts } from "@qualis/schema";

/** Accumulates Halstead operator/operand occurrences. */
export class HalsteadCounter {
  private readonly operators = new Map<string, number>();
  private readonly operands = new Map<string, number>();

  operator(image: string): void {
    this.operators.set(image, (this.operators.get(image) ?? 0) + 1);
  }

  operand(image: string): void {
    this.operands.set(image, (this.operands.get(image) ?? 0) + 1);
  }

  counts(): HalsteadCounts {
    let totalOperators = 0;
    let totalOperands = 0;
    for (const n of this.operators.values()) totalOperators += n;
    for (const n of this.operands.values()) totalOperands += n;
    return {
      distinctOperators: this.operators.size,
      distinctOperands: this.operands.size,
      totalOperators,
      totalOperands,
    };
  }
}

/** A comment of the analysed file, with its text (delimiters included). */
export interface CommentInfo {
  startLine: number;
  endLine: number;
  text: string;
}

const DIRECTIVE = /qualis-ignore-(file|line|next-line)\b([^\n]*)/g;
const RULE_ID = /[a-z][a-z0-9-]*:[a-z0-9][a-z0-9-]*/g;

/**
 * Suppression directives written in comments:
 *
 *   qualis-ignore-line [ruleId, ...] [-- reason]       issues on the comment's line
 *   qualis-ignore-next-line [ruleId, ...] [-- reason]  issues on the following line
 *   qualis-ignore-file [ruleId, ...] [-- reason]       issues in the whole file
 *
 * Without rule ids the directive applies to every rule.
 */
export class Suppressions {
  private readonly byLine = new Map<number, Set<string> | "all">();
  private file: Set<string> | "all" | undefined;

  static parse(comments: CommentInfo[]): Suppressions {
    const s = new Suppressions();
    for (const comment of comments) {
      for (const match of comment.text.matchAll(DIRECTIVE)) {
        const kind = match[1]!;
        const rest = (match[2] ?? "").split("--")[0]!;
        const ids = rest.match(RULE_ID);
        const scope: Set<string> | "all" = ids && ids.length > 0 ? new Set(ids) : "all";
        if (kind === "file") s.file = merge(s.file, scope);
        else {
          const line = kind === "line" ? comment.startLine : comment.endLine + 1;
          s.byLine.set(line, merge(s.byLine.get(line), scope));
        }
      }
    }
    return s;
  }

  isSuppressed(ruleId: string, line: number): boolean {
    const matches = (scope: Set<string> | "all" | undefined) => scope === "all" || (scope?.has(ruleId) ?? false);
    return matches(this.file) || matches(this.byLine.get(line));
  }
}

function merge(a: Set<string> | "all" | undefined, b: Set<string> | "all"): Set<string> | "all" {
  if (a === "all" || b === "all") return "all";
  return new Set([...(a ?? []), ...b]);
}

/** True when a comment line carries text (letters or digits), not just delimiters or decoration. */
export function isMeaningfulCommentText(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text);
}

/** Task markers recognised by the "suspicious comment" rules. */
export const TASK_MARKER = /\b(TODO|FIXME|XXX|HACK)\b/;
