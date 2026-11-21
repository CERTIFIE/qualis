// Search of the documentation index (/api/docs/search) for the header search on /docs pages. Pure: shared with tests.

export interface DocsHit {
  section: string;
  title: string;
  url: string;
  text: string;
}

/** Pages and rules whose title or text contain every word, those matching in the title first; at most 8. */
export function searchDocs(index: DocsHit[], query: string): DocsHit[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return index
    .map((h) => {
      const title = h.title.toLowerCase();
      const all = `${title} ${h.text.toLowerCase()}`;
      if (!words.every((w) => all.includes(w))) return null;
      return { h, score: words.filter((w) => title.includes(w)).length * 2 + (title.startsWith(words[0]!) ? 1 : 0) };
    })
    .filter((x): x is { h: DocsHit; score: number } => x !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map((x) => x.h);
}
