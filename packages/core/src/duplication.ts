import { createHash } from "node:crypto";
import type { CpdToken, DuplicationGroup } from "@qualis/schema";

export interface CpdInput {
  path: string;
  tokens: CpdToken[];
}

export interface DuplicationResult {
  groups: DuplicationGroup[];
  /** Duplicated line numbers per file. */
  duplicatedLines: Map<string, Set<number>>;
}

const B1 = 31;
const B2 = 131;
const M = 2 ** 31 - 1;

function hashImage(image: string): number {
  let h = 0;
  for (let i = 0; i < image.length; i++) h = (Math.imul(h, 31) + image.charCodeAt(i)) | 0;
  return h >>> 0;
}

function modPow(base: number, exp: number): number {
  let result = 1;
  for (let i = 0; i < exp; i++) result = Number((BigInt(result) * BigInt(base)) % BigInt(M));
  return result;
}

function mulMod(a: number, b: number): number {
  // a, b < 2^31: split to stay within double precision.
  const hi = Math.floor(a / 65536);
  const lo = a % 65536;
  return ((hi * b % M) * 65536 + lo * b) % M;
}

/**
 * Hashes of every window of `size` consecutive tokens (Karp-Rabin rolling hash,
 * two independent bases to make collisions negligible).
 */
function windowHashes(tokens: number[], size: number): string[] {
  const out: string[] = [];
  if (tokens.length < size) return out;
  const p1 = modPow(B1, size - 1);
  const p2 = modPow(B2, size - 1);
  let h1 = 0;
  let h2 = 0;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]! % M;
    if (i >= size) {
      const old = tokens[i - size]! % M;
      h1 = (h1 - mulMod(old, p1) + M) % M;
      h2 = (h2 - mulMod(old, p2) + M) % M;
    }
    h1 = (mulMod(h1, B1) + t) % M;
    h2 = (mulMod(h2, B2) + t) % M;
    if (i >= size - 1) out.push(`${h1}:${h2}`);
  }
  return out;
}

interface Occurrence {
  file: number;
  index: number;
}

/**
 * Detects duplicated blocks (type-1 clones: identical token sequences, layout
 * and comments ignored) of at least `minTokens` tokens spanning at least
 * `minLines` lines, within and across files.
 */
export function detectDuplications(inputs: CpdInput[], minTokens: number, minLines: number): DuplicationResult {
  const files = inputs.filter((f) => f.tokens.length >= minTokens);
  const groupOf: number[][] = [];
  const groups: Occurrence[][] = [];
  const byHash = new Map<string, number>();

  files.forEach((file, f) => {
    const numeric = file.tokens.map((t) => hashImage(t.image));
    const hashes = windowHashes(numeric, minTokens);
    const ids = new Array<number>(hashes.length);
    hashes.forEach((h, i) => {
      let g = byHash.get(h);
      if (g === undefined) {
        g = groups.length;
        groups.push([]);
        byHash.set(h, g);
      }
      groups[g]!.push({ file: f, index: i });
      ids[i] = g;
    });
    groupOf.push(ids);
  });

  const sameTokens = (a: Occurrence, b: Occurrence, length: number) => {
    const ta = files[a.file]!.tokens;
    const tb = files[b.file]!.tokens;
    for (let k = 0; k < length; k++) if (ta[a.index + k]!.image !== tb[b.index + k]!.image) return false;
    return true;
  };

  // A window continues the previous one when every occurrence shifts by one
  // position into the same group.
  const continuesPrevious = (f: number, i: number): boolean => {
    if (i === 0) return false;
    const g = groupOf[f]![i]!;
    const prev = groupOf[f]![i - 1]!;
    const occ = groups[g]!;
    if (occ.length !== groups[prev]!.length) return false;
    return occ.every((o) => o.index > 0 && groupOf[o.file]![o.index - 1] === prev);
  };

  const result: DuplicationGroup[] = [];
  const duplicatedLines = new Map<string, Set<number>>();
  const seen = new Set<number>();

  for (let f = 0; f < files.length; f++) {
    const ids = groupOf[f]!;
    for (let i = 0; i < ids.length; i++) {
      const g = ids[i]!;
      if (seen.has(g) || groups[g]!.length < 2 || continuesPrevious(f, i)) continue;
      seen.add(g);
      // Extend the chain while all occurrences keep matching.
      let length = minTokens;
      let j = i;
      while (j + 1 < ids.length && continuesPrevious(f, j + 1)) {
        j++;
        length++;
      }
      const first = groups[g]![0]!;
      // Verify real token equality (guards against hash collisions) and drop
      // occurrences overlapping a previous one in the same file.
      const occurrences: Occurrence[] = [];
      for (const occ of groups[g]!) {
        if (!sameTokens(first, occ, length)) continue;
        const overlaps = occurrences.some((o) => o.file === occ.file && Math.abs(o.index - occ.index) < length);
        if (!overlaps) occurrences.push(occ);
      }
      if (occurrences.length < 2) continue;
      const spans = occurrences.map((o) => {
        const tokens = files[o.file]!.tokens;
        return {
          path: files[o.file]!.path,
          startLine: tokens[o.index]!.startLine,
          endLine: tokens[o.index + length - 1]!.endLine,
        };
      });
      if (spans.some((s) => s.endLine - s.startLine + 1 < minLines)) continue;
      // Mark chained groups as consumed.
      for (let k = i; k <= j; k++) seen.add(ids[k]!);
      const id = createHash("sha256")
        .update(spans.map((s) => `${s.path}:${s.startLine}-${s.endLine}`).join("|"))
        .digest("hex")
        .slice(0, 16);
      result.push({ id, tokens: length, occurrences: spans });
      for (const s of spans) {
        let lines = duplicatedLines.get(s.path);
        if (!lines) duplicatedLines.set(s.path, (lines = new Set()));
        for (let l = s.startLine; l <= s.endLine; l++) lines.add(l);
      }
    }
  }
  return { groups: result, duplicatedLines };
}
