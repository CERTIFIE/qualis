// Generates the static documentation site in docs/site, and in docs/site/app the same pages as data for the web UI,
// which shows the documentation inside its own layout (/docs).
//
// Guide pages come from docs/content/*.md; rule pages are generated from the
// rule metadata published by the plugins, so the documentation always matches
// the rules that actually run.
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Marked } from "marked";
import { loadPlugin } from "@qualis/core";
import createTypeScriptPlugin from "@qualis/plugin-typescript";
import createCSharpPlugin from "@qualis/plugin-csharp";
import createEslintPack from "@qualis/plugin-eslint";
import { SCHEMA_NAMES, schemaPath } from "@qualis/schema";

const DOCS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(DOCS, "site");
const APP = path.join(OUT, "app");
const CONTENT = path.join(DOCS, "content");
const VERSION = JSON.parse(await readFile(path.join(DOCS, "package.json"), "utf8")).version;

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

/** The Roslyn rule pack runs as a .NET process: read its manifest through the host. */
async function roslynManifest() {
  const handle = await loadPlugin("@qualis/plugin-roslyn", { baseDir: DOCS, log: { log: () => undefined } });
  try {
    if (handle.manifest.rules.length === 0) {
      console.warn("Roslyn rule pack unavailable (.NET 10 or the helper build is missing): its rules are not documented.");
      return undefined;
    }
    return handle.manifest;
  } finally {
    await handle.dispose();
  }
}

const plugins = [createTypeScriptPlugin(), await createCSharpPlugin(), createEslintPack(), await roslynManifest()].filter(Boolean);
const allRules = plugins.flatMap((p) => p.rules.map((rule) => ({ ...rule, plugin: p })));
const ruleUrl = (rule) => `rules/${rule.plugin.id}/${rule.id.split(":")[1]}.html`;

const SCOPE_LABEL = { main: "Production code", test: "Test code", all: "Production and test code" };
const TYPE_LABEL = {
  vulnerability: "Vulnerability",
  "security-hotspot": "Security hotspot",
  bug: "Bug",
  "code-smell": "Code smell",
};
const TYPE_GROUP = {
  vulnerability: "Security: vulnerabilities",
  "security-hotspot": "Security: hotspots to review",
  bug: "Reliability: bugs",
  "code-smell": "Maintainability: code smells",
};
const TYPE_ORDER = ["vulnerability", "security-hotspot", "bug", "code-smell"];
const SEVERITY_ORDER = ["blocker", "critical", "major", "minor", "info"];
const TYPE_COLOR = {
  vulnerability: "text-danger border-danger/50",
  "security-hotspot": "text-warning border-warning/50",
  bug: "text-accent border-accent/50",
  "code-smell": "",
};

/** Sources of metrics, formats and models (rules carry their own references). */
const METHOD_SOURCES = [
  { publisher: "NIST", id: "SP 500-235", title: "Structured Testing: A Testing Methodology Using the Cyclomatic Complexity Metric", url: "https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication500-235.pdf", topic: "Cyclomatic complexity" },
  { publisher: "IEEE", title: "T. J. McCabe, A Complexity Measure (1976)", url: "https://doi.org/10.1109/TSE.1976.233837", topic: "Cyclomatic complexity" },
  { publisher: "Carnegie Mellon SEI", id: "CMU/SEI-97-HB-001", title: "C4 Software Technology Reference Guide (cyclomatic complexity, pp. 145-147; Halstead, p. 209)", url: "https://www.sei.cmu.edu/documents/1625/1997_002_001_16523.pdf", topic: "Complexity bands, Halstead" },
  { publisher: "IBM", title: "Halstead Complexity Report (IBM ADDI documentation)", url: "https://www.ibm.com/docs/en/addi/6.1.4?topic=reports-halstead-complexity-report", topic: "Halstead time and bugs" },
  { publisher: "Microsoft Learn", title: "Code metrics - Maintainability index range and meaning", url: "https://learn.microsoft.com/en-us/visualstudio/code-quality/code-metrics-maintainability-index-range-and-meaning", topic: "Maintainability index" },
  { publisher: "Microsoft Learn", title: "How code metrics help identify risks", url: "https://learn.microsoft.com/en-us/visualstudio/code-quality/code-metrics-values", topic: "Code metrics" },
  { publisher: "SonarSource", title: "G. A. Campbell, Cognitive Complexity (white paper)", url: "https://www.sonarsource.com/resources/cognitive-complexity/", topic: "Cognitive complexity" },
  { publisher: "ACM", title: "G. A. Campbell, Cognitive complexity: an overview and evaluation (TechDebt '18)", url: "https://doi.org/10.1145/3194164.3194186", topic: "Cognitive complexity" },
  { publisher: "Queen's University", id: "TR 2007-541", title: "C. K. Roy, J. R. Cordy, A Survey on Software Clone Detection Research", url: "https://research.cs.queensu.ca/TechReports/Reports/2007-541.pdf", topic: "Duplications" },
  { publisher: "IEEE", title: "J.-L. Letouzey, I. Ilkiewicz, Managing Technical Debt with the SQALE Method (IEEE Software, 2012)", url: "https://doi.org/10.1109/MS.2012.129", topic: "Technical debt" },
  { publisher: "ISO", id: "ISO/IEC 25010:2023", title: "Product quality model", url: "https://www.iso.org/standard/78176.html", topic: "Quality characteristics" },
  { publisher: "OMG", id: "ASCQM 1.1 / ISO/IEC 5055", title: "Automated Source Code Quality Measures", url: "https://www.omg.org/spec/ASCQM/1.1/PDF", topic: "Thresholds" },
  { publisher: "OASIS", title: "Static Analysis Results Interchange Format (SARIF) 2.1.0", url: "https://docs.oasis-open.org/sarif/sarif/v2.1.0/sarif-v2.1.0.html", topic: "SARIF output" },
  { publisher: "linux-test-project", title: "geninfo: LCOV tracefile format", url: "https://github.com/linux-test-project/lcov/blob/master/docs/man/geninfo.rst", topic: "Coverage import" },
  { publisher: "Cobertura", title: "coverage-04.dtd", url: "https://github.com/cobertura/cobertura/blob/master/cobertura/src/site/htdocs/xml/coverage-04.dtd", topic: "Coverage import" },
  { publisher: "OpenCover", title: "OpenCover (XML coverage format)", url: "https://github.com/OpenCover/opencover", topic: "Coverage import" },
  { publisher: "coverlet", title: "coverlet VSTest integration: output formats (cobertura, opencover, lcov)", url: "https://github.com/coverlet-coverage/coverlet/blob/master/Documentation/VSTestIntegration.md", topic: "Coverage import" },
  { publisher: "Microsoft", title: "VSTest: reporting test results (TRX)", url: "https://github.com/microsoft/vstest/blob/main/docs/report.md", topic: "Test import" },
  { publisher: "JSON Schema", title: "JSON Schema 2020-12", url: "https://json-schema.org/draft/2020-12/schema", topic: "Report format" },
  { publisher: "JSON-RPC", title: "JSON-RPC 2.0 Specification", url: "https://www.jsonrpc.org/specification", topic: "Plugin protocol" },
];

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

const NAV = [
  { title: "Get started", icon: "rocket", items: [["index", "Introduction"], ["installation", "Installation"], ["usage", "Usage"], ["configuration", "Configuration"], ["ci", "CI integration"], ["cli", "Command line"], ["web-ui", "Web UI"]] },
  { title: "Concepts", icon: "chart-dots", items: [["metrics", "Metrics"], ["ratings", "Ratings and technical debt"], ["quality-gate", "Quality gate"], ["new-code", "New code"], ["coverage-and-tests", "Coverage and tests"], ["external-issues", "External issues"], ["duplications", "Duplications"]] },
  { title: "Rules", icon: "list-check", items: [["rules/index", "All rules"], ...plugins.map((p) => [`rules/${p.id}`, p.name])] },
  { title: "Reference", icon: "book-2", items: [["report-format", "Report format"], ["plugins", "Writing a plugin"], ["sources", "Sources"]] },
];
const TOP_NAV = [["index", "Docs", ["Get started", "Concepts"]], ["rules/index", "Rules", ["Rules"]], ["report-format", "Report", []], ["plugins", "Plugins", []]];
const ORDER = NAV.flatMap((g) => g.items.map(([slug, title]) => ({ slug, title, group: g.title })));
const groupOf = (slug) => (slug.startsWith("rules/") ? "Rules" : (ORDER.find((o) => o.slug === slug)?.group ?? "Docs"));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const slugify = (s) =>
  s
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/&[a-z]+;/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const icons = {};
for (const file of await readdir(path.join(DOCS, "src/icons"))) {
  const svg = await readFile(path.join(DOCS, "src/icons", file), "utf8");
  icons[file.replace(/\.svg$/, "")] = svg
    .replace(/\s*class="[^"]*"/, "")
    .replace(/<path stroke="none" d="M0 0h24v24H0z" fill="none"\s*\/>/, "")
    .replace(/\s+/g, " ")
    .replace(/width="24" height="24"/, "")
    .trim();
}
const icon = (name, cls = "icon") => (icons[name] ?? "").replace("<svg", `<svg class="${cls}" aria-hidden="true"`);

function frontmatter(source) {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(source);
  if (!match) return { data: {}, body: source };
  const data = Object.fromEntries(
    match[1].split("\n").map((line) => {
      const i = line.indexOf(":");
      return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
    }),
  );
  return { data, body: source.slice(match[0].length) };
}

/** Markdown → HTML with heading anchors, code blocks (tabs, copy), callouts and tables. */
function renderMarkdown(markdown) {
  const toc = [];
  const marked = new Marked({ gfm: true });
  marked.use({
    renderer: {
      heading({ tokens, depth }) {
        const html = this.parser.parseInline(tokens);
        if (depth === 1) return `<h1>${html}</h1>`;
        const id = slugify(html);
        if (depth <= 3) toc.push({ id, depth, text: html.replace(/<[^>]+>/g, "") });
        return `<h${depth} id="${id}">${html}<a class="anchor" href="#${id}" aria-label="Link to this section">#</a></h${depth}>`;
      },
      code({ text, lang }) {
        const [language = "", ...rest] = (lang ?? "").split(/\s+/);
        const title = /title="([^"]+)"/.exec(rest.join(" "))?.[1] ?? language;
        return codeBlock([{ label: title, code: text }]);
      },
      table(token) {
        const header = token.header.map((cell) => `<th>${this.parser.parseInline(cell.tokens)}</th>`).join("");
        const rows = token.rows.map((row) => `<tr>${row.map((cell) => `<td>${this.parser.parseInline(cell.tokens)}</td>`).join("")}</tr>`).join("");
        return `<div class="table-wrap"><table><thead><tr>${header}</tr></thead><tbody>${rows}</tbody></table></div>`;
      },
    },
  });
  // Consecutive fences with `tab=NAME` become one tabbed block.
  const tokens = marked.lexer(markdown);
  const merged = [];
  for (const token of tokens) {
    const tab = token.type === "code" ? /tab=(\S+)/.exec(token.lang ?? "")?.[1] : undefined;
    const previous = merged[merged.length - 1];
    if (tab) {
      if (previous?.type === "tabs") previous.items.push({ label: tab, code: token.text });
      else merged.push({ type: "tabs", items: [{ label: tab, code: token.text }] });
    } else if (token.type === "space" && previous?.type === "tabs") {
      continue;
    } else {
      merged.push(token);
    }
  }
  const prepared = merged.map((t) => {
    if (t.type !== "tabs") return t;
    const html = codeBlock(t.items);
    return { type: "html", raw: html, text: html, block: true, pre: false };
  });
  prepared.links = tokens.links;
  let html = marked.parser(prepared);
  // Callouts: > [!NOTE] / [!TIP] / [!WARNING]
  html = html.replace(/<blockquote>\s*<p>\[!(NOTE|TIP|WARNING)\]\s*([\s\S]*?)<\/blockquote>/g, (_, kind, inner) => {
    const kinds = { NOTE: ["note", "info-circle"], TIP: ["tip", "bulb"], WARNING: ["warning", "alert-triangle"] };
    const [cls, ic] = kinds[kind];
    return `<div class="callout callout-${cls}">${icon(ic, "icon mt-1 text-faint")}<div class="space-y-2"><p>${inner}</div></div>`;
  });
  return { html, toc };
}

function codeBlock(items) {
  const copyButton = `<button type="button" class="copy-btn" data-copy-code aria-label="Copy code">${icon("copy", "size-3.5")}<span class="copy-label">Copy</span></button>`;
  if (items.length === 1) {
    const [item] = items;
    const tone = item.label === "Noncompliant" ? " text-danger" : item.label === "Compliant" ? " text-success" : "";
    return `<div class="code not-prose">${item.label ? `<div class="code-head"><span class="code-title${tone}">${esc(item.label)}</span>${copyButton}</div>` : `<div class="code-head"><span class="code-title">&nbsp;</span>${copyButton}</div>`}<pre><code>${esc(item.code)}</code></pre></div>`;
  }
  const buttons = items
    .map((item, i) => `<button type="button" class="tab-btn" role="tab" data-tab="${esc(item.label)}" aria-selected="${i === 0}">${esc(item.label)}</button>`)
    .join("");
  const panels = items.map((item, i) => `<pre data-panel="${esc(item.label)}"${i === 0 ? "" : " hidden"}><code>${esc(item.code)}</code></pre>`).join("");
  return `<div class="code not-prose" data-tabs><div class="code-head" role="tablist">${buttons}${copyButton}</div>${panels}</div>`;
}

// ---------------------------------------------------------------------------
// Page shell
// ---------------------------------------------------------------------------

function layout({ slug, title, description, body, toc = [], markdown = "", wide = false }) {
  const depth = slug.split("/").length - 1;
  const base = "../".repeat(depth);
  const href = (target) => `${base}${target}.html`;
  const group = groupOf(slug);
  const position = ORDER.findIndex((o) => o.slug === slug);
  const prev = position > 0 ? ORDER[position - 1] : undefined;
  const next = position >= 0 && position < ORDER.length - 1 ? ORDER[position + 1] : undefined;

  const sidebar = NAV.map(
    (g) => `<div class="mb-5">
      <div class="flex items-center gap-2 px-2 py-1 text-[13px] font-medium">${icon(g.icon, "icon text-muted")}${esc(g.title)}</div>
      ${g.items
        .map(([s, t]) => `<a class="nav-link" href="${href(s)}"${s === slug || (s !== "rules/index" && slug.startsWith(`${s}/`)) ? ' aria-current="page"' : ""}>${esc(t)}</a>`)
        .join("")}
    </div>`,
  ).join("");

  const topNav = TOP_NAV.map(([s, t, groups]) => {
    const active = s === slug || groups.includes(group) || (s === "report-format" && slug === s) || (s === "plugins" && slug === s);
    return `<a href="${href(s)}" class="label py-1 ${active ? "border-b border-fg text-fg" : "text-faint hover:text-fg"}">${t}</a>`;
  }).join("");

  const tocHtml = toc.filter((t) => t.depth >= 2).length
    ? `<div class="label mb-3 text-faint">On this page</div>${toc
        .filter((t) => t.depth >= 2)
        .map((t) => `<a class="toc-link ${t.depth === 3 ? "pl-3" : ""}" href="#${t.id}">${esc(t.text)}</a>`)
        .join("")}`
    : "";

  const pager =
    prev || next
      ? `<nav class="mt-14 grid grid-cols-2 gap-px border border-line bg-line" aria-label="Pagination">
        ${prev ? `<a href="${href(prev.slug)}" class="bg-bg px-4 py-3 hover:bg-soft"><div class="label text-faint">Previous</div><div class="text-[14px]">${esc(prev.title)}</div></a>` : `<span class="bg-bg"></span>`}
        ${next ? `<a href="${href(next.slug)}" class="bg-bg px-4 py-3 text-right hover:bg-soft"><div class="label text-faint">Next</div><div class="text-[14px]">${esc(next.title)}</div></a>` : `<span class="bg-bg"></span>`}
      </nav>`
      : "";

  return `<!doctype html>
<html lang="en" class="dark" data-base="${base}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · Qualis</title>
<meta name="description" content="${esc(description ?? "")}">
<link rel="icon" href="${base}assets/logo.svg" type="image/svg+xml">
<link rel="stylesheet" href="${base}assets/styles.css">
<script>try{if(localStorage.getItem("qualis-theme")==="light")document.documentElement.classList.remove("dark")}catch(e){}</script>
</head>
<body class="min-h-screen font-sans">
<a href="#content" class="sr-only focus:not-sr-only focus:absolute focus:p-2">Skip to content</a>
<header class="sticky top-0 z-30 border-b border-line bg-bg/90 backdrop-blur">
  <div class="mx-auto flex h-14 max-w-[1400px] items-center gap-6 px-4 lg:px-6">
    <button type="button" class="text-muted lg:hidden" data-nav-toggle aria-controls="sidebar" aria-expanded="false" aria-label="Menu">${icon("menu-2", "size-5")}</button>
    <a href="${href("index")}" class="flex items-center gap-2" aria-label="Qualis home">${icon("shield-check", "size-6 text-accent")}<span class="font-mono text-[14px] font-medium uppercase tracking-[0.12em]">Qualis</span></a>
    <nav class="hidden items-center gap-5 md:flex" aria-label="Main">${topNav}</nav>
    <div class="ml-auto flex items-center gap-3">
      <button type="button" data-search-open class="flex w-9 items-center gap-2 border border-line px-2.5 py-1.5 text-[13px] text-faint hover:border-line-strong sm:w-56" aria-label="Search">${icon("search", "icon")}<span class="hidden sm:inline">Search</span><span class="label ml-auto hidden sm:inline">⌘K</span></button>
      <button type="button" data-theme-toggle class="p-1.5 text-muted hover:text-fg" aria-label="Toggle theme">
        <span class="hidden dark:inline">${icon("sun", "size-[18px]")}</span><span class="dark:hidden">${icon("moon", "size-[18px]")}</span>
      </button>
    </div>
  </div>
</header>
<div class="mx-auto flex max-w-[1400px]">
  <aside id="sidebar" class="hidden w-full shrink-0 border-r border-line px-3 py-6 lg:sticky lg:top-14 lg:block lg:h-[calc(100vh-3.5rem)] lg:w-64 lg:overflow-y-auto">
    <div class="label mb-4 px-2 text-faint">Version ${VERSION}</div>
    ${sidebar}
  </aside>
  <main id="content" class="min-w-0 flex-1 px-4 py-8 sm:px-8 lg:px-12">
    <div class="mx-auto ${wide ? "max-w-5xl" : "max-w-3xl"}">
      <div class="mb-3 flex items-center gap-2">
        <span class="label text-faint">${esc(group)}</span>
        ${markdown ? `<button type="button" class="badge ml-auto hover:text-fg" data-copy-markdown>${icon("copy", "size-3")}<span class="copy-label">Copy MD</span></button>` : ""}
      </div>
      <h1 class="text-[28px] font-medium tracking-tight sm:text-[32px]">${esc(title)}</h1>
      ${description ? `<p class="mt-2 text-[16px] text-muted">${esc(description)}</p>` : ""}
      <div class="prose mt-8">${body}</div>
      ${pager}
      <footer class="mt-12 border-t border-line pt-6 text-[12.5px] text-faint">Qualis ${VERSION} · Apache-2.0 · Icons by Tabler (MIT)</footer>
    </div>
  </main>
  <aside class="hidden w-56 shrink-0 py-8 pr-6 xl:block"><div class="sticky top-22">${tocHtml}</div></aside>
</div>
<div id="search" class="fixed inset-0 z-50 hidden items-start justify-center bg-black/50 px-4 pt-[12vh]" role="dialog" aria-modal="true" aria-label="Search">
  <div class="w-full max-w-xl border border-line-strong bg-bg">
    <div class="flex items-center gap-2 border-b border-line px-4">${icon("search", "icon text-faint")}<input id="search-input" class="h-12 w-full bg-transparent text-[15px] outline-none placeholder:text-faint" placeholder="Search pages and rules" autocomplete="off" spellcheck="false"><span class="label text-faint">Esc</span></div>
    <div id="search-results" class="max-h-[60vh] overflow-y-auto py-1"></div>
  </div>
</div>
${markdown ? `<script type="text/markdown" id="page-markdown">${markdown.replace(/<\/script/gi, "<\\/script")}</script>` : ""}
<script src="${base}assets/search-index.js"></script>
<script src="${base}assets/app.js"></script>
</body>
</html>
`;
}

// ---------------------------------------------------------------------------
// Generated markdown blocks
// ---------------------------------------------------------------------------

const ruleLink = (rule, from) => `[\`${rule.id}\`](${"../".repeat(from.split("/").length - 1)}${ruleUrl(rule)})`;

function ruleTable(rules, from) {
  const rows = rules
    .sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) || a.id.localeCompare(b.id, "en"))
    .map((r) => `| ${ruleLink(r, from)} | ${r.name} | ${r.severity} | ${r.enabledByDefault ? "yes" : "no"} |`);
  return `| Rule | Name | Severity | Default |\n|---|---|---|---|\n${rows.join("\n")}`;
}

function pluginRulesMarkdown(plugin) {
  const from = `rules/${plugin.id}`;
  const rules = allRules.filter((r) => r.plugin === plugin);
  const languages = plugin.languages.map((l) => `${l.name} (${l.extensions.map((e) => `\`${e}\``).join(", ")})`).join(", ");
  const kind = plugin.kind === "rule-pack" ? "Rule pack" : "Language plugin";
  const enabled = rules.filter((r) => r.enabledByDefault).length;
  let md = `${plugin.description}\n\n${kind} \`${plugin.id}\`, version ${plugin.version}. Languages: ${languages}. ${rules.length} rules, ${enabled} enabled by default.\n`;
  for (const type of TYPE_ORDER) {
    const group = rules.filter((r) => r.type === type);
    if (group.length) md += `\n## ${TYPE_GROUP[type]}\n\n${ruleTable(group, from)}\n`;
  }
  return md;
}

function sourcesMarkdown() {
  const byUrl = new Map();
  for (const rule of allRules) {
    for (const ref of rule.references) {
      const key = ref.url;
      const entry = byUrl.get(key) ?? { ...ref, rules: [] };
      entry.rules.push(rule);
      byUrl.set(key, entry);
    }
  }
  const publishers = [...new Set([...byUrl.values()].map((r) => r.publisher))].sort();
  let md = `## Sources of the rules\n\n${byUrl.size} distinct pages are cited by the ${allRules.length} rules.\n`;
  for (const publisher of publishers) {
    md += `\n### ${publisher}\n\n| Source | Cited by |\n|---|---|\n`;
    for (const ref of [...byUrl.values()].filter((r) => r.publisher === publisher).sort((a, b) => (a.id ?? a.title).localeCompare(b.id ?? b.title, "en", { numeric: true }))) {
      md += `| [${ref.id ? `${ref.id}: ` : ""}${ref.title}](${ref.url}) | ${ref.rules.map((r) => ruleLink(r, "sources")).join(" ")} |\n`;
    }
  }
  md += `\n## Sources of the metrics and formats\n\n| Topic | Source |\n|---|---|\n`;
  for (const s of METHOD_SOURCES) md += `| ${s.topic} | [${s.id ? `${s.id}: ` : ""}${s.title}](${s.url}) (${s.publisher}) |\n`;
  return md;
}

function ruleMarkdown(rule) {
  const from = ruleUrl(rule).replace(/\.html$/, "");
  const up = "../".repeat(from.split("/").length - 1);
  const [, key] = rule.id.split(":");
  let md = "";
  md += `<div class="not-prose flex flex-wrap gap-1.5"><span class="badge text-fg">${esc(rule.id)}</span><span class="badge ${TYPE_COLOR[rule.type]}">${TYPE_LABEL[rule.type]}</span><span class="badge">${rule.severity}</span><span class="badge">${rule.effortMinutes} min</span><span class="badge">${rule.enabledByDefault ? "On by default" : "Off by default"}</span><span class="badge">${SCOPE_LABEL[rule.scope ?? (rule.type === "bug" ? "all" : "main")]}</span>${rule.tags.filter((t) => /^cwe-/.test(t)).map((t) => `<span class="badge">${t.toUpperCase()}</span>`).join("")}</div>\n\n`;
  md += `## What it detects\n\n${rule.description}\n\n## Why it matters\n\n${rule.rationale}\n\n`;
  if (rule.noncompliantExample || rule.compliantExample) {
    md += `## Examples\n\n`;
    const lang = rule.plugin.id === "csharp" ? "csharp" : "ts";
    if (rule.noncompliantExample) md += `\`\`\`${lang} title="Noncompliant"\n${rule.noncompliantExample}\n\`\`\`\n\n`;
    if (rule.compliantExample) md += `\`\`\`${lang} title="Compliant"\n${rule.compliantExample}\n\`\`\`\n\n`;
    md += `Both examples are executed by the test suite: the first must raise this rule, the second must not.\n\n`;
  }
  if (rule.params?.length) {
    md += `## Parameters\n\n| Name | Type | Default | Description |\n|---|---|---|---|\n`;
    for (const p of rule.params) md += `| \`${p.name}\` | ${p.type} | \`${p.default}\` | ${p.description} |\n`;
    md += "\n";
  }
  if (rule.exceptions) md += `## Exceptions and limitations\n\n${rule.exceptions}\n\n`;
  const example = rule.params?.length ? `{ "params": { "${rule.params[0].name}": ${JSON.stringify(rule.params[0].default)} } }` : `"off"`;
  md += `## Configuration\n\n\`\`\`json title="qualis.config.json"\n{\n  "rules": {\n    "${rule.id}": ${example}\n  }\n}\n\`\`\`\n\nSee [Configuration](${up}configuration.html#rules) for severities, file exclusions and suppression comments.\n\n`;
  md += `## Sources\n\n| Publisher | Source |\n|---|---|\n`;
  for (const ref of rule.references) md += `| ${ref.publisher} | [${ref.id ? `${ref.id}: ` : ""}${ref.title}](${ref.url}) |\n`;
  if (rule.supersedes?.length) md += `\nWhen enabled, this rule replaces ${rule.supersedes.map((id) => { const target = allRules.find((r) => r.id === id); return target ? ruleLink(target, from) : `\`${id}\``; }).join(", ")} (see [rule packs](${up}plugins.html#language-plugins-and-rule-packs)).\n`;
  md += `\nImplemented by the ${rule.plugin.name} plugin (\`${rule.plugin.id}\` ${rule.plugin.version}), rule key \`${key}\`.\n`;
  return md;
}

function catalogHtml() {
  const rows = [...allRules]
    .sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) || SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) || a.id.localeCompare(b.id, "en"))
    .map(
      (r) => `<a href="../${ruleUrl(r)}" data-rule data-plugin="${r.plugin.id}" data-type="${r.type}" data-severity="${r.severity}" data-search="${esc(`${r.id} ${r.name} ${r.tags.join(" ")}`.toLowerCase())}" class="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 border-t border-line px-3 py-2.5 hover:bg-soft sm:grid-cols-[minmax(0,1fr)_9.5rem_5rem]">
        <span class="min-w-0 leading-snug"><span class="block break-all font-mono text-[12.5px] text-fg">${esc(r.id)}</span><span class="block text-[13.5px] text-muted">${esc(r.name)}</span></span>
        <span class="self-center"><span class="badge ${TYPE_COLOR[r.type]}">${TYPE_LABEL[r.type]}</span></span>
        <span class="hidden self-center text-[13px] text-muted sm:block">${r.severity}</span>
      </a>`,
    )
    .join("");
  const select = (name, label, options) =>
    `<label class="flex flex-col gap-1"><span class="label text-faint">${label}</span><select data-filter="${name}" class="h-9 border border-line bg-bg px-2 text-[13px] text-fg"><option value="">All</option>${options.map(([v, t]) => `<option value="${v}">${esc(t)}</option>`).join("")}</select></label>`;
  return `<div class="not-prose">
  <div class="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
    <label class="flex flex-col gap-1"><span class="label text-faint">Search</span><input data-filter="text" class="h-9 border border-line bg-bg px-3 text-[13px] text-fg outline-none placeholder:text-faint focus:border-line-strong" placeholder="sql, cwe-89, complexity…"></label>
    ${select("plugin", "Language", plugins.map((p) => [p.id, p.name]))}
    ${select("type", "Type", TYPE_ORDER.map((t) => [t, TYPE_LABEL[t]]))}
    ${select("severity", "Severity", SEVERITY_ORDER.map((s) => [s, s]))}
  </div>
  <p class="mt-4 text-[13px] text-faint"><span id="rule-count">${allRules.length}</span> of ${allRules.length} rules</p>
  <div id="rule-catalog" class="mt-2 border-b border-line">${rows}</div>
</div>`;
}

const PLACEHOLDERS = {
  "rule-count": () => String(allRules.length),
  "source-count": () => String(new Set(allRules.flatMap((r) => r.references.map((x) => x.url))).size),
  sources: sourcesMarkdown,
};

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

await rm(OUT, { recursive: true, force: true });
await mkdir(path.join(OUT, "assets"), { recursive: true });
await mkdir(APP, { recursive: true });
const search = [];

/** Classes the web UI already uses for its own components: in its pages they get a `doc-` prefix. */
const APP_CLASSES = new Set(["code", "code-head", "code-title", "badge"]);

/**
 * A page body for the web UI: relative `.html` links become absolute /docs paths (index is /docs), and the classes in
 * APP_CLASSES are prefixed.
 */
function appHtml(html, slug) {
  const classes = html.replace(/class="([^"]*)"/g, (_, list) => `class="${list.split(" ").map((c) => (APP_CLASSES.has(c) ? `doc-${c}` : c)).join(" ")}"`);
  return classes.replace(/href="(?![a-z]+:|\/|#)([^"#]*?)\.html(#[^"]*)?"/g, (_, target, hash = "") => {
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(slug), target));
    return `href="/docs${resolved === "index" ? "" : `/${resolved}`}${hash}"`;
  });
}
const appUrl = (url) => {
  const slug = url.replace(/\.html$/, "");
  return slug === "index" ? "/docs" : `/docs/${slug}`;
};

async function emit(slug, page) {
  const file = path.join(OUT, `${slug}.html`);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, layout({ slug, ...page }));
  const position = ORDER.findIndex((o) => o.slug === slug);
  const neighbour = (o) => (o ? { title: o.title, href: appUrl(o.slug) } : null);
  const data = {
    slug,
    title: page.title,
    description: page.description ?? "",
    group: groupOf(slug),
    html: appHtml(page.body, slug),
    toc: (page.toc ?? []).filter((t) => t.depth >= 2),
    wide: Boolean(page.wide),
    prev: position > 0 ? neighbour(ORDER[position - 1]) : null,
    next: position >= 0 ? neighbour(ORDER[position + 1]) : null,
  };
  const json = path.join(APP, "pages", `${slug}.json`);
  await mkdir(path.dirname(json), { recursive: true });
  await writeFile(json, JSON.stringify(data));
}

// Guide pages.
for (const file of (await readdir(CONTENT)).filter((f) => f.endsWith(".md"))) {
  const slug = file.replace(/\.md$/, "");
  const { data, body } = frontmatter(await readFile(path.join(CONTENT, file), "utf8"));
  const markdown = body.replace(/\{\{([a-z-]+)\}\}/g, (_, name) => {
    if (!PLACEHOLDERS[name]) throw new Error(`${file}: unknown placeholder {{${name}}}`);
    return PLACEHOLDERS[name]();
  });
  const { html, toc } = renderMarkdown(markdown);
  await emit(slug, { title: data.title, description: data.description, body: html, toc, markdown: `# ${data.title}\n\n${markdown}` });
  search.push({ kind: "page", section: groupOf(slug), title: data.title, url: `${slug}.html`, text: `${data.description ?? ""} ${toc.map((t) => t.text).join(" · ")}` });
}

// Rule pages.
for (const rule of allRules) {
  const slug = ruleUrl(rule).replace(/\.html$/, "");
  const markdown = ruleMarkdown(rule);
  const { html, toc } = renderMarkdown(markdown);
  await emit(slug, { title: rule.name, description: `${TYPE_LABEL[rule.type]} rule of the ${rule.plugin.name} plugin.`, body: html, toc, markdown: `# ${rule.name}\n\n${markdown}` });
  search.push({ kind: "rule", section: "Rule", title: rule.name, url: `${slug}.html`, text: `${rule.id} ${rule.tags.join(" ")} ${rule.description}` });
}

// Rule lists per plugin and catalog.
for (const plugin of plugins) {
  const markdown = pluginRulesMarkdown(plugin);
  const { html, toc } = renderMarkdown(markdown);
  await emit(`rules/${plugin.id}`, { title: `${plugin.name} rules`, description: `Every rule of the ${plugin.name} plugin, grouped by quality characteristic.`, body: html, toc, markdown });
  search.push({ kind: "page", section: "Rules", title: `${plugin.name} rules`, url: `rules/${plugin.id}.html`, text: plugin.description });
}
await emit("rules/index", {
  title: "All rules",
  description: `${allRules.length} rules. Each one is derived from official documentation and lists its sources.`,
  body: catalogHtml(),
  wide: true,
});
search.push({ kind: "page", section: "Rules", title: "All rules", url: "rules/index.html", text: "catalog filter rules by language type severity" });

// Assets.
await writeFile(path.join(OUT, "assets/search-index.js"), `window.QUALIS_SEARCH=${JSON.stringify(search)};\n`);
await writeFile(path.join(APP, "search.json"), JSON.stringify(search.map((entry) => ({ ...entry, url: appUrl(entry.url) }))));
await writeFile(
  path.join(APP, "nav.json"),
  JSON.stringify({ version: VERSION, groups: NAV.map((g) => ({ title: g.title, icon: g.icon, items: g.items.map(([slug, title]) => ({ title, href: appUrl(slug) })) })) }),
);
await copyFile(path.join(DOCS, "src/app.js"), path.join(OUT, "assets/app.js"));
await writeFile(path.join(OUT, "assets/logo.svg"), icons["shield-check"].replace("<svg", '<svg style="color:#378ADD"'));
await mkdir(path.join(OUT, "schemas"), { recursive: true });
for (const name of SCHEMA_NAMES) await copyFile(schemaPath(name), path.join(OUT, "schemas", `${name}.schema.json`));

execFileSync(path.join(DOCS, "node_modules/.bin/tailwindcss"), ["-i", path.join(DOCS, "src/styles.css"), "-o", path.join(OUT, "assets/styles.css"), "--minify"], { stdio: "inherit" });

const pageCount = search.length;
console.log(`Documentation written to ${path.relative(process.cwd(), OUT) || "."} (${pageCount} pages, ${allRules.length} rules).`);
