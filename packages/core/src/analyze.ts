import { compareStrings, relativeTo, toPosix } from "./paths.js";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import {
  CHARACTERISTIC_BY_TYPE,
  REPORT_SCHEMA_VERSION,
  type ActiveRule,
  type Diagnostic,
  type IssueType,
  type FileAnalysis,
  type FileReport,
  type FunctionReport,
  type Issue,
  type NewCodeMeasures,
  type OverallMeasures,
  type PluginInfo,
  type PluginIssue,
  type Report,
  type RuleScope,
  type Severity,
} from "@qualis/schema";
import { LineIndex, stripBom, type Logger, type LogLevel, type PluginFile } from "@qualis/plugin-api";
import { loadConfig, type ResolvedConfig } from "./config.js";
import { coverageMeasures, fileCoverage, importCoverage, type CoverageData } from "./coverage.js";
import { findProjectErrorLogs, isProjectFile, newerThan, projectOwner } from "./dotnet.js";
import { importExternalIssues, maxLevel, type ExternalLevel, type ExternalReportInput, type ExternalRuleInfo } from "./external.js";
import { detectDuplications, type CpdInput } from "./duplication.js";
import { discoverFiles, matcher } from "./files.js";
import { checkConditions, evaluateGate } from "./gate.js";
import { changedLines, resolveNewCodeBaseline, vcsInfo, type NewCodeBaseline } from "./git.js";
import {
  countIssues,
  functionReport,
  functionStatistics,
  halsteadMeasures,
  hotspots,
  ratings,
  round,
} from "./metrics.js";
import { kindOf, loadPlugin, type PluginHandle } from "./plugins/host.js";
import { defaultScope, resolveRules } from "./rules.js";
import { toSarif } from "./sarif.js";
import { importTests, testMeasures } from "./tests.js";
import { CORE_VERSION } from "./version.js";

export type ProgressEvent =
  | { type: "plugins-loaded"; plugins: PluginInfo[] }
  | { type: "files-discovered"; total: number }
  | { type: "file-analyzed"; path: string; done: number; total: number }
  | { type: "phase"; name: "external issues" | "duplication" | "coverage" | "tests" | "measures" };

export interface AnalyzeOptions {
  /** Project root. */
  baseDir: string;
  /** Explicit configuration file; otherwise `qualis.config.json` is looked up in `baseDir`. */
  configFile?: string;
  /** Overrides applied on top of the configuration file. */
  overrides?: {
    newCodeReference?: string | null;
    coverageReports?: string[];
    testReports?: string[];
    externalIssueReports?: string[];
    includeSources?: boolean;
  };
  /** Extra directories to resolve plugin packages from (e.g. where the CLI is installed). */
  resolvePluginsFrom?: string[];
  /** Validate in-process plugin results against the schema (slower; process plugins are always validated). */
  strictPlugins?: boolean;
  log?: Logger;
  onProgress?: (event: ProgressEvent) => void;
}

const silentLogger: Logger = { log: () => undefined };

/** Stable issue fingerprint: rule, file, normalised line text and occurrence rank. */
function fingerprint(ruleId: string, file: string, lineText: string, rank: number): string {
  return createHash("sha256")
    .update(`${ruleId}\0${file}\0${lineText.trim().replace(/\s+/g, " ")}\0${rank}`)
    .digest("hex")
    .slice(0, 20);
}

interface AnalyzedFile {
  file: PluginFile;
  /** Test code (`tests.sources`): left out of the size, complexity, duplication and coverage measures. */
  test: boolean;
  plugin: string;
  content: string;
  lines: LineIndex;
  analysis: FileAnalysis;
  issues: Issue[];
  newLines: Set<number> | null;
  codeLines: Set<number>;
  functions: FunctionReport[];
}

async function globReports(patterns: string[], baseDir: string): Promise<string[]> {
  if (patterns.length === 0) return [];
  const found = await fg(patterns, { cwd: baseDir, absolute: true, dot: true, onlyFiles: true, ignore: ["**/node_modules/**"] });
  return [...new Set(found)].sort();
}

function intersectSize(a: Set<number>, b: Set<number>): number {
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n;
}

/** Runs a complete analysis and returns the report. */
export async function analyze(options: AnalyzeOptions): Promise<Report> {
  const started = new Date();
  const log = options.log ?? silentLogger;
  const progress = options.onProgress ?? (() => undefined);
  const config: ResolvedConfig = loadConfig(options.baseDir, options.configFile);
  const o = options.overrides ?? {};
  if (o.newCodeReference !== undefined) config.newCodeReference = o.newCodeReference;
  if (o.coverageReports) config.coverageReports = o.coverageReports;
  if (o.testReports) config.testReports = o.testReports;
  if (o.externalIssueReports) config.externalIssues.reports = o.externalIssueReports;
  if (o.includeSources !== undefined) config.output.includeSources = o.includeSources;
  checkConditions(config.qualityGate.conditions);

  const baseDir = config.baseDir;
  const diagnostics: Diagnostic[] = [];
  const diag = (level: Diagnostic["level"], source: string, message: string, file?: string) => {
    diagnostics.push({ level, source, message, ...(file !== undefined && { path: file }) });
    log.log(level === "warning" ? "warning" : level, file ? `${file}: ${message}` : message);
  };
  const pluginLog = (source: string): Logger => ({
    log: (level: LogLevel, message: string) => {
      if (level === "warning" || level === "error") diag(level, source, message);
      else log.log(level, `[${source}] ${message}`);
    },
  });

  // Version control and new code.
  const vcs = await vcsInfo(baseDir);
  let baseline: NewCodeBaseline | null = null;
  let changed: Map<string, number[] | "all"> | null = null;
  try {
    baseline = await resolveNewCodeBaseline(baseDir, config.newCodeReference);
    if (baseline) changed = await changedLines(baseDir, baseline.baseRevision);
  } catch (error) {
    if (config.newCodeReference !== "auto") throw error;
    diag("warning", "core", `New code detection disabled: ${(error as Error).message}`);
  }

  // Plugins.
  const plugins: PluginHandle[] = [];
  try {
    for (const reference of config.plugins) {
      const label = typeof reference === "string" ? reference : "module" in reference ? reference.module : reference.command;
      const plugin = await loadPlugin(reference, {
        baseDir,
        resolveFrom: options.resolvePluginsFrom ?? [],
        validateModuleResults: options.strictPlugins ?? false,
        log: pluginLog(label),
      });
      if (plugins.some((p) => p.manifest.id === plugin.manifest.id)) {
        await plugin.dispose();
        throw new Error(`Two plugins share the id "${plugin.manifest.id}"`);
      }
      plugins.push(plugin);
    }
    const pluginInfos: PluginInfo[] = plugins.map((p) => ({
      id: p.manifest.id,
      name: p.manifest.name,
      version: p.manifest.version,
      apiVersion: p.manifest.apiVersion,
      transport: p.transport,
      kind: kindOf(p.manifest),
      languages: p.manifest.languages.map((l) => l.id),
    }));
    progress({ type: "plugins-loaded", plugins: pluginInfos });

    const languagePlugins = plugins.filter((p) => kindOf(p.manifest) === "language");
    const rulePacks = plugins.filter((p) => kindOf(p.manifest) === "rule-pack");
    const byExtension = new Map<string, { plugin: PluginHandle; language: string }>();
    for (const plugin of languagePlugins) {
      for (const language of plugin.manifest.languages) {
        for (const ext of language.extensions) {
          const existing = byExtension.get(ext);
          if (existing) {
            diag("warning", "core", `Extension ${ext} is claimed by ${existing.plugin.manifest.id} and ${plugin.manifest.id}; using ${existing.plugin.manifest.id}`);
            continue;
          }
          byExtension.set(ext, { plugin, language: language.id });
        }
      }
    }

    const rules = resolveRules(plugins.map((p) => p.manifest), config.rules);
    for (const warning of rules.warnings) diag("warning", "core", warning);
    const ruleExcluded = new Map([...rules.excludes].map(([id, patterns]) => [id, matcher(patterns)]));
    const isTest = matcher(config.testSources);
    const inScope = (rule: ActiveRule, test: boolean) => rule.scope === "all" || (rule.scope === "test") === test;

    // Files.
    const discovered = await discoverFiles(baseDir, config);
    for (const s of discovered.skipped) diag("info", "core", `Skipped: ${s.reason}`, s.path);
    const assigned = new Map<PluginHandle, PluginFile[]>();
    for (const f of discovered.files) {
      const lower = f.path.toLowerCase();
      const ext = [...byExtension.keys()].filter((e) => lower.endsWith(e)).sort((a, b) => b.length - a.length)[0];
      if (!ext) continue;
      const target = byExtension.get(ext)!;
      const list = assigned.get(target.plugin) ?? [];
      list.push({ path: f.path, absolutePath: f.absolutePath, language: target.language });
      assigned.set(target.plugin, list);
    }
    const allFiles = [...assigned.values()].flat();
    const packFiles = new Map(
      rulePacks.map((pack) => {
        const languages = new Set(pack.manifest.languages.map((l) => l.id));
        return [pack, allFiles.filter((f) => languages.has(f.language))] as const;
      }),
    );
    const total = allFiles.length + [...packFiles.values()].reduce((s, l) => s + l.length, 0);
    progress({ type: "files-discovered", total });

    const enabledRulesOf = (pluginId: string) =>
      [...rules.active.values()].filter((r) => r.plugin === pluginId).map((r) => ({ id: r.id, params: r.paramValues }));
    const contents = new Map<string, Promise<string>>();
    const contentOf = (file: PluginFile) => {
      let content = contents.get(file.path);
      if (!content) contents.set(file.path, (content = readFile(file.absolutePath, "utf8").then(stripBom)));
      return content;
    };
    let done = 0;

    // Rule packs prepare first: a pack that cannot run (e.g. the project does not
    // build) must not disable the rules it supersedes.
    const preparedPacks = new Set<PluginHandle>();
    await Promise.all(
      [...packFiles].map(async ([pack, files]) => {
        if (files.length === 0) return;
        try {
          await pack.prepare(baseDir, files, enabledRulesOf(pack.manifest.id), pluginLog(pack.manifest.id));
          preparedPacks.add(pack);
        } catch (error) {
          diag("warning", pack.manifest.id, `prepare failed, its rules are skipped: ${(error as Error).message}`);
        }
      }),
    );
    const superseded = new Map<string, string>();
    for (const rule of rules.active.values()) {
      const pack = rulePacks.find((p) => p.manifest.id === rule.plugin);
      if (!pack || !preparedPacks.has(pack)) continue;
      for (const id of rule.supersedes ?? []) {
        // An explicit setting in the configuration keeps the rule.
        if (rules.active.has(id) && config.rules[id] === undefined) superseded.set(id, rule.id);
      }
    }
    for (const [id, by] of superseded) {
      rules.active.delete(id);
      diag("info", "core", `Rule ${id} is superseded by ${by}`);
    }
    for (const pack of rulePacks) {
      if (!preparedPacks.has(pack)) for (const r of [...rules.active.values()]) if (r.plugin === pack.manifest.id) rules.active.delete(r.id);
    }

    // Rule packs: issues per file.
    const packIssues = new Map<string, { plugin: string; issues: PluginIssue[] }[]>();
    const packWork = [...packFiles].filter(([pack]) => preparedPacks.has(pack)).map(async ([pack, files]) => {
      const pluginId = pack.manifest.id;
      const enabled = enabledRulesOf(pluginId);
      for (const file of files) {
        try {
          const result = await pack.analyzeFile({ file, content: await contentOf(file), rules: enabled });
          for (const d of result.diagnostics ?? []) diag(d.level, pluginId, d.message, file.path);
          const list = packIssues.get(file.path) ?? [];
          list.push({ plugin: pluginId, issues: result.issues });
          packIssues.set(file.path, list);
        } catch (error) {
          diag("error", pluginId, `analysis failed: ${(error as Error).message}`, file.path);
        }
        progress({ type: "file-analyzed", path: file.path, done: ++done, total });
      }
    });

    // Language plugins: one worker per plugin, files in order.
    const results: { file: PluginFile; plugin: string; content: string; analysis: FileAnalysis }[] = [];
    const languageWork = [...assigned].map(async ([plugin, files]) => {
      const pluginId = plugin.manifest.id;
      const enabled = enabledRulesOf(pluginId);
      try {
        await plugin.prepare(baseDir, files, enabled, pluginLog(pluginId));
      } catch (error) {
        diag("error", pluginId, `prepare failed: ${(error as Error).message}`);
        return;
      }
      for (const file of files) {
        try {
          const content = await contentOf(file);
          const analysis = (await plugin.analyzeFile({ file, content, rules: enabled })) as FileAnalysis;
          for (const d of analysis.diagnostics ?? []) diag(d.level, pluginId, d.message, file.path);
          results.push({ file, plugin: pluginId, content, analysis });
        } catch (error) {
          diag("error", pluginId, `analysis failed: ${(error as Error).message}`, file.path);
        }
        progress({ type: "file-analyzed", path: file.path, done: ++done, total });
      }
    });
    await Promise.all([...languageWork, ...packWork]);

    // External issues: reports of other linters and analyzers.
    progress({ type: "phase", name: "external issues" });
    const configuredReports = await globReports(config.externalIssues.reports, baseDir);
    if (config.externalIssues.reports.length > 0 && configuredReports.length === 0) {
      diag("warning", "core", `No external issue report matches ${config.externalIssues.reports.join(", ")}`);
    }
    // .NET build error logs: each project's SARIF only speaks for the files of that project.
    const projects = config.externalIssues.dotnetErrorLogs ? discovered.files.map((f) => f.path).filter(isProjectFile) : [];
    const errorLogs = projects.length > 0 ? await findProjectErrorLogs(baseDir, projects) : [];
    const ownerOf = projectOwner(projects);
    const errorLogFiles = new Set(errorLogs.map((l) => l.file));
    const externalInputs: ExternalReportInput[] = [
      ...configuredReports.filter((f) => !errorLogFiles.has(f)).map((file) => ({ file })),
      ...errorLogs.map((l) => ({ file: l.file, compilerOnly: true, accept: (p: string) => ownerOf(p) === l.project })),
    ];
    const externalFiles = externalInputs.map((i) => i.file);
    const reportName = (f: string) => relativeTo(baseDir, f) ?? toPosix(f);
    for (const log of errorLogs) {
      const sources = results.filter((r) => ownerOf(r.file.path) === log.project).map((r) => r.file.absolutePath);
      const newer = await newerThan(log.file, sources);
      diag("info", "core", `Build error log of ${log.project}: ${reportName(log.file)}`);
      if (newer > 0) diag("warning", "core", `${reportName(log.file)} is older than ${newer} source file(s) of ${log.project}: rebuild the project to refresh it`);
    }
    const externalIssues = new Map<string, PluginIssue[]>();
    if (externalInputs.length > 0) {
      const imported = await importExternalIssues(externalInputs, baseDir);
      for (const w of imported.warnings) diag("warning", "core", w);
      const analyzedFiles = new Map(results.map((r) => [r.file.path, r]));
      const levels = new Map<string, ExternalLevel>();
      const languages = new Map<string, Set<string>>();
      let notAnalyzed = 0;
      let pastEnd = 0;
      for (const finding of imported.findings) {
        const target = analyzedFiles.get(finding.path);
        if (!target) {
          notAnalyzed++;
          continue;
        }
        if (finding.range.startLine > target.content.split("\n").length) {
          pastEnd++;
          continue;
        }
        levels.set(finding.id, maxLevel(levels.get(finding.id) ?? "none", finding.level));
        languages.set(finding.id, (languages.get(finding.id) ?? new Set()).add(target.file.language));
        const list = externalIssues.get(finding.path) ?? [];
        list.push({ ruleId: finding.id, message: finding.message, range: finding.range });
        externalIssues.set(finding.path, list);
      }
      for (const info of imported.rules.values()) {
        if (!levels.has(info.id)) continue;
        const rule = externalRule(info, levels.get(info.id)!, [...languages.get(info.id)!].sort(), config.externalIssues);
        const setting = config.rules[info.id];
        if (setting === "off") continue;
        if (typeof setting === "string" && setting !== "on") rule.severity = setting;
        else if (typeof setting === "object") {
          if (setting.enabled === false) continue;
          rule.severity = setting.severity ?? rule.severity;
          rule.scope = setting.scope ?? rule.scope;
          if (setting.exclude?.length) ruleExcluded.set(info.id, matcher(setting.exclude));
          if (setting.params) diag("warning", "core", `Rule ${info.id} is external and takes no parameters; ignored`);
        }
        rules.active.set(info.id, rule);
      }
      if (notAnalyzed > 0) diag("info", "core", `${notAnalyzed} external issue(s) on files that are not analysed were ignored`);
      if (imported.otherProject > 0) diag("info", "core", `${imported.otherProject} issue(s) of build error logs on files of other projects were ignored`);
      if (imported.outside > 0) diag("info", "core", `${imported.outside} external issue(s) on files outside the project were ignored`);
      if (pastEnd > 0) diag("warning", "core", `${pastEnd} external issue(s) point past the end of their file (stale report?) and were ignored`);
    }

    const dropped = { duplicate: 0, testCode: 0, other: 0 };
    const analyzed: AnalyzedFile[] = results.map(({ file, plugin, content, analysis }) => {
      const test = isTest(file.path);
      const enabledForFile = new Set(
        [...rules.active.values()].filter((r) => inScope(r, test) && !ruleExcluded.get(r.id)?.(file.path)).map((r) => r.id),
      );
      const native = [{ plugin, issues: analysis.issues }, ...(packIssues.get(file.path) ?? [])];
      const fromReports = externalIssues.get(file.path) ?? [];
      const unique = withoutDuplicates(fromReports, native, rules.active);
      const kept = new Set(unique);
      for (const i of fromReports) {
        if (kept.has(i) && enabledForFile.has(i.ruleId)) continue;
        const rule = rules.active.get(i.ruleId);
        if (rule && test && !inScope(rule, true)) dropped.testCode++;
        else if (!kept.has(i)) dropped.duplicate++;
        else dropped.other++;
      }
      const sources = [...native, { plugin: "external", issues: unique }];
      return { ...buildFile(file, plugin, content, analysis, sources, enabledForFile, rules.active, changed, diag), test };
    });
    if (externalFiles.length > 0) {
      const kept = analyzed.reduce((n, a) => n + a.issues.filter((i) => rules.active.get(i.ruleId)?.external).length, 0);
      const reasons = [
        dropped.duplicate > 0 && `${dropped.duplicate} already reported by Qualis`,
        dropped.testCode > 0 && `${dropped.testCode} in test code, outside their rule's scope`,
        dropped.other > 0 && `${dropped.other} disabled or excluded`,
      ].filter(Boolean);
      diag("info", "core", `Imported ${kept} external issue(s) from ${externalFiles.length} report(s)` + (reasons.length > 0 ? `; left out: ${reasons.join(", ")}` : ""));
    }
    // Production code: what size, complexity, duplication and coverage measure.
    const main = analyzed.filter((a) => !a.test);
    const testCode = analyzed.filter((a) => a.test);
    analyzed.sort((a, b) => compareStrings(a.file.path, b.file.path));

    // Duplications.
    progress({ type: "phase", name: "duplication" });
    const dupExcluded = matcher(config.duplication.exclude);
    const cpdInputs: CpdInput[] = config.duplication.enabled
      ? main
          .filter((a) => a.analysis.cpdTokens && !dupExcluded(a.file.path))
          .map((a) => ({ path: a.file.path, tokens: a.analysis.cpdTokens! }))
      : [];
    const duplication = detectDuplications(cpdInputs, config.duplication.minTokens, config.duplication.minLines);

    // Coverage.
    progress({ type: "phase", name: "coverage" });
    const projectFiles = new Set(analyzed.map((a) => a.file.path));
    const coverageFiles = await globReports(config.coverageReports, baseDir);
    if (config.coverageReports.length > 0 && coverageFiles.length === 0) {
      diag("warning", "core", `No coverage report matches ${config.coverageReports.join(", ")}`);
    }
    let coverage: CoverageData = new Map();
    if (coverageFiles.length > 0) {
      const imported = await importCoverage(coverageFiles, baseDir, projectFiles);
      coverage = imported.data;
      for (const w of imported.warnings) diag("warning", "core", w);
    }
    const notInReports = new Set<string>();
    if (coverage.size > 0) {
      const coverageExcluded = matcher(config.coverageExclude);
      const excluded = (file: string) => isTest(file) || coverageExcluded(file);
      for (const file of [...coverage.keys()]) if (excluded(file)) coverage.delete(file);
      if (config.coverageMissingFiles === "uncovered") {
        // A language is measured when at least one of its files is in a report;
        // its other source files were never loaded by the tests.
        const measured = new Set(analyzed.filter((a) => coverage.has(a.file.path)).map((a) => a.file.language));
        for (const a of analyzed) {
          if (coverage.has(a.file.path) || !measured.has(a.file.language) || excluded(a.file.path)) continue;
          const lines = a.analysis.executableLines ?? [...a.codeLines];
          if (lines.length === 0) continue; // declarations only (e.g. an interface): nothing to execute
          coverage.set(a.file.path, new Map(lines.map((line) => [line, { hits: 0, conditions: 0, coveredConditions: 0 }])));
          notInReports.add(a.file.path);
        }
        if (notInReports.size > 0) {
          diag("info", "core", `${notInReports.size} source file(s) not in any coverage report are counted as not covered`);
        }
      }
    }

    // Tests.
    progress({ type: "phase", name: "tests" });
    const testFiles = await globReports(config.testReports, baseDir);
    if (config.testReports.length > 0 && testFiles.length === 0) {
      diag("warning", "core", `No test report matches ${config.testReports.join(", ")}`);
    }
    const tests = testFiles.length > 0 ? await importTests(testFiles, baseDir) : null;
    for (const w of tests?.warnings ?? []) diag("warning", "core", w);

    // Measures.
    progress({ type: "phase", name: "measures" });
    const ratingOptions = config.ratings;
    const allIssues = analyzed.flatMap((a) => a.issues);
    const sum = (pick: (a: AnalyzedFile) => number, of: AnalyzedFile[] = main) => of.reduce((s, a) => s + pick(a), 0);
    const ncloc = sum((a) => a.analysis.measures.ncloc);
    const lines = sum((a) => a.analysis.measures.lines);
    const commentLines = sum((a) => a.analysis.measures.commentLines);
    const complexity = sum((a) => a.analysis.measures.complexity);
    const allFunctions = main.flatMap((a) => a.functions.map((fn) => ({ path: a.file.path, fn })));
    const withHalstead = main.filter((a) => a.analysis.halstead);
    let duplicatedLinesTotal = 0;
    for (const set of duplication.duplicatedLines.values()) duplicatedLinesTotal += set.size;
    const overallRatings = ratings(allIssues, ncloc, ratingOptions);
    const overall: OverallMeasures = {
      files: main.length,
      lines,
      ncloc,
      commentLines,
      commentLinesDensity: ncloc + commentLines === 0 ? 0 : round((commentLines / (ncloc + commentLines)) * 100),
      functions: sum((a) => a.analysis.measures.functions),
      classes: sum((a) => a.analysis.measures.classes),
      statements: sum((a) => a.analysis.measures.statements),
      complexity,
      cognitiveComplexity: sum((a) => a.analysis.measures.cognitiveComplexity),
      complexityDensity: ncloc === 0 ? 0 : round((complexity / ncloc) * 1000),
      functionStats: functionStatistics(allFunctions.map((f) => f.fn)),
      halstead:
        withHalstead.length === 0
          ? null
          : (() => {
              const measures = withHalstead.map((a) => halsteadMeasures(a.analysis.halstead!));
              return {
                volume: round(measures.reduce((s, m) => s + m.volume, 0), 2),
                effort: round(measures.reduce((s, m) => s + m.effort, 0), 2),
                deliveredBugs: round(measures.reduce((s, m) => s + m.deliveredBugs, 0), 4),
              };
            })(),
      hotspots: {
        complexity: hotspots(allFunctions, (f) => f.complexity, "desc"),
        cognitiveComplexity: hotspots(allFunctions, (f) => f.cognitiveComplexity, "desc"),
        maintainabilityIndex: hotspots(allFunctions, (f) => f.maintainabilityIndex, "asc"),
      },
      issues: countIssues(allIssues),
      ratings: overallRatings.ratings,
      technicalDebtMinutes: overallRatings.technicalDebtMinutes,
      debtRatio: overallRatings.debtRatio,
      duplication: {
        duplicatedLines: duplicatedLinesTotal,
        duplicatedBlocks: duplication.groups.reduce((s, g) => s + g.occurrences.length, 0),
        duplicatedFiles: duplication.duplicatedLines.size,
        duplicatedLinesDensity: lines === 0 ? 0 : round((duplicatedLinesTotal / lines) * 100),
      },
      coverage: coverageMeasures(coverage),
      tests: tests ? testMeasures(tests.suites) : null,
      testCode: {
        files: testCode.length,
        lines: sum((a) => a.analysis.measures.lines, testCode),
        ncloc: sum((a) => a.analysis.measures.ncloc, testCode),
      },
    };

    let newCode: NewCodeMeasures | null = null;
    if (changed) {
      const newLinesByFile = new Map<string, Set<number>>();
      for (const a of analyzed) if (a.newLines && a.newLines.size > 0) newLinesByFile.set(a.file.path, a.newLines);
      const newIssues = allIssues.filter((i) => i.isNew);
      let newLineCount = 0;
      let newNcloc = 0;
      let newDuplicated = 0;
      for (const a of main) {
        if (!a.newLines) continue;
        newLineCount += a.newLines.size;
        newNcloc += intersectSize(a.newLines, a.codeLines);
        const dup = duplication.duplicatedLines.get(a.file.path);
        if (dup) newDuplicated += intersectSize(a.newLines, dup);
      }
      const r = ratings(newIssues, newNcloc, ratingOptions);
      newCode = {
        lines: newLineCount,
        ncloc: newNcloc,
        issues: countIssues(newIssues),
        ratings: r.ratings,
        technicalDebtMinutes: r.technicalDebtMinutes,
        debtRatio: r.debtRatio,
        duplicatedLines: newDuplicated,
        duplicatedLinesDensity: newLineCount === 0 ? 0 : round((newDuplicated / newLineCount) * 100),
        coverage: coverage.size > 0 ? coverageMeasures(coverage, newLinesByFile) : null,
      };
    }

    const qualityGate = evaluateGate(config.qualityGate, overall, newCode);

    const files: FileReport[] = analyzed.map((a) => {
      const m = a.analysis.measures;
      const lineCoverage = coverage.get(a.file.path);
      const fileMis = a.functions.map((f) => f.maintainabilityIndex).filter((x): x is number => x !== null);
      const report: FileReport = {
        path: a.file.path,
        language: a.file.language,
        plugin: a.plugin,
        ...(a.test && { test: true }),
        measures: {
          lines: m.lines,
          ncloc: m.ncloc,
          commentLines: m.commentLines,
          functions: m.functions,
          classes: m.classes,
          statements: m.statements,
          complexity: m.complexity,
          cognitiveComplexity: m.cognitiveComplexity,
          issues: a.issues.length,
          duplicatedLines: duplication.duplicatedLines.get(a.file.path)?.size ?? 0,
          technicalDebtMinutes: a.issues.filter((i) => i.type === "code-smell").reduce((s, i) => s + i.effortMinutes, 0),
          halstead: a.analysis.halstead ? halsteadMeasures(a.analysis.halstead) : null,
          maintainabilityIndex: fileMis.length === 0 ? null : Math.min(...fileMis),
        },
        functions: a.functions,
        sha256: createHash("sha256").update(a.content, "utf8").digest("hex"),
      };
      if (a.newLines) report.newLines = [...a.newLines].sort((x, y) => x - y);
      if (lineCoverage) report.coverage = { ...(notInReports.has(a.file.path) && { notInReports: true }), ...fileCoverage(lineCoverage) };
      if (config.output.includeSources) report.source = a.content;
      return report;
    });

    const usedRules: ActiveRule[] = [...rules.active.values()].sort((a, b) => compareStrings(a.id, b.id));
    const finished = new Date();
    return {
      schemaVersion: REPORT_SCHEMA_VERSION,
      tool: { name: "qualis", version: CORE_VERSION, plugins: pluginInfos },
      project: config.project,
      analysis: {
        id: randomUUID(),
        startedAt: started.toISOString(),
        finishedAt: finished.toISOString(),
        durationMs: finished.getTime() - started.getTime(),
        vcs,
        newCode: baseline ? { reference: baseline.reference, baseRevision: baseline.baseRevision } : null,
      },
      qualityGate,
      measures: { overall, newCode },
      files,
      issues: allIssues.sort(
        (a, b) => compareStrings(a.path, b.path) || a.range.startLine - b.range.startLine || a.range.startColumn - b.range.startColumn || compareStrings(a.ruleId, b.ruleId),
      ),
      rules: usedRules,
      duplications: duplication.groups,
      tests: tests ? { reports: testFiles.map((f) => path.relative(baseDir, f).split(path.sep).join("/")), suites: tests.suites } : null,
      coverageReports: coverageFiles.map((f) => path.relative(baseDir, f).split(path.sep).join("/")),
      ...(externalFiles.length > 0 && { externalIssueReports: externalFiles.map(reportName) }),
      diagnostics,
    };
  } finally {
    await Promise.all(plugins.map((p) => p.dispose().catch(() => undefined)));
  }
}

const SEVERITY_BY_LEVEL: Record<ExternalLevel, Severity> = { error: "major", warning: "minor", note: "info", none: "info" };

/** Wildcard pattern (`*` matches any text) to a regular expression. */
function wildcard(pattern: string): RegExp {
  return new RegExp(`^${pattern.split("*").map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);
}

/** Rule definition of an external rule, before the `rules` settings. */
function externalRule(
  info: ExternalRuleInfo,
  level: ExternalLevel,
  languages: string[],
  options: { types: Record<string, IssueType>; effortMinutes: number },
): ActiveRule {
  const configured = Object.entries(options.types).find(([pattern]) => wildcard(pattern).test(info.id))?.[1];
  const type: IssueType = configured ?? (info.security ? "security-hotspot" : "code-smell");
  const severity = SEVERITY_BY_LEVEL[level];
  const scope: RuleScope = defaultScope(type);
  return {
    id: info.id,
    name: info.name,
    languages,
    type,
    severity,
    tags: ["external", info.id.split(":")[1]!],
    enabledByDefault: true,
    effortMinutes: options.effortMinutes,
    description: info.description ?? `Rule \`${info.ruleId}\` of ${info.tool}.`,
    rationale: `Reported by ${info.tool} and imported from its report; Qualis does not run or verify this rule. See the documentation of ${info.tool} for its rationale.`,
    references: info.helpUri?.startsWith("https://") ? [{ publisher: info.tool, id: info.ruleId, title: info.name, url: info.helpUri }] : [],
    plugin: "external",
    defaultSeverity: severity,
    paramValues: {},
    scope,
    external: { tool: info.tool, ruleId: info.ruleId, ...(info.helpUri && { helpUri: info.helpUri }) },
  };
}

/** Lowercase rule key used to recognise the same rule run by Qualis and by the external tool. */
function ruleKey(name: string): string {
  return name.toLowerCase().replace(/^@typescript-eslint\//, "ts-").replace(/[^a-z0-9]+/g, "-");
}

/**
 * Drops external issues that a Qualis plugin already reports on the same line
 * for the same rule (e.g. ESLint run by both the eslint rule pack and the project).
 */
function withoutDuplicates(external: PluginIssue[], native: { issues: PluginIssue[] }[], active: Map<string, ActiveRule>): PluginIssue[] {
  if (external.length === 0) return external;
  const seen = new Set<string>();
  for (const { issues } of native) for (const i of issues) seen.add(`${i.range.startLine}\0${ruleKey(i.ruleId.slice(i.ruleId.indexOf(":") + 1))}`);
  return external.filter((i) => {
    const rule = active.get(i.ruleId);
    return !rule?.external || !seen.has(`${i.range.startLine}\0${ruleKey(rule.external.ruleId)}`);
  });
}

function buildFile(
  file: PluginFile,
  plugin: string,
  content: string,
  analysis: FileAnalysis,
  sources: { plugin: string; issues: PluginIssue[] }[],
  enabledIds: Set<string>,
  active: Map<string, ActiveRule>,
  changed: Map<string, number[] | "all"> | null,
  diag: (level: Diagnostic["level"], source: string, message: string, file?: string) => void,
): Omit<AnalyzedFile, "test"> {
  const lines = new LineIndex(content);
  const lineCount = lines.lineCount;
  let newLines: Set<number> | null = null;
  if (changed) {
    const entry = changed.get(file.path);
    if (entry === "all") newLines = new Set(Array.from({ length: lineCount }, (_, i) => i + 1));
    else newLines = new Set((entry ?? []).filter((l) => l <= lineCount));
  }
  const codeLines = new Set<number>(
    analysis.codeLines ??
      Array.from({ length: lineCount }, (_, i) => i + 1).filter((l) => lines.lineText(l).trim() !== ""),
  );
  const ranks = new Map<string, number>();
  const issues: Issue[] = [];
  for (const { plugin: source, issues: rawIssues } of sources) for (const raw of rawIssues) {
    const rule = active.get(raw.ruleId);
    if (!rule || rule.plugin !== source) {
      diag("warning", source, `issue for rule ${raw.ruleId} ignored (rule unknown or disabled)`, file.path);
      continue;
    }
    if (!enabledIds.has(raw.ruleId)) continue; // excluded for this file
    const lineText = lines.lineText(raw.range.startLine);
    const key = `${raw.ruleId}\0${lineText.trim()}`;
    const rank = ranks.get(key) ?? 0;
    ranks.set(key, rank + 1);
    const issue: Issue = {
      id: fingerprint(raw.ruleId, file.path, lineText, rank),
      ruleId: raw.ruleId,
      type: rule.type,
      characteristic: CHARACTERISTIC_BY_TYPE[rule.type],
      severity: rule.severity,
      message: raw.message,
      path: file.path,
      range: raw.range,
      effortMinutes: raw.effortMinutes ?? rule.effortMinutes,
      tags: rule.tags,
      isNew: newLines ? newLines.has(raw.range.startLine) : false,
    };
    if (raw.secondaryLocations?.length) issue.secondaryLocations = raw.secondaryLocations;
    issues.push(issue);
  }
  return {
    file,
    plugin,
    content,
    lines,
    analysis,
    issues,
    newLines,
    codeLines,
    functions: (analysis.functions ?? []).map(functionReport),
  };
}

/**
 * Writes the report (and SARIF if requested) to the output directory, and keeps
 * a copy in `history/` pruned to the newest `history` analyses. Returns the written paths.
 */
export async function writeReport(
  report: Report,
  outputDir: string,
  formats: ("json" | "sarif")[],
  history = 0,
): Promise<string[]> {
  await mkdir(outputDir, { recursive: true });
  const written: string[] = [];
  if (formats.includes("json")) {
    const file = path.join(outputDir, "report.json");
    await writeFile(file, JSON.stringify(report, null, 2) + "\n");
    written.push(file);
  }
  if (history > 0) {
    const dir = path.join(outputDir, "history");
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, `${report.analysis.finishedAt.replace(/[-:.]/g, "")}.json`);
    await writeFile(file, JSON.stringify(report) + "\n");
    written.push(file);
    // Timestamped names sort chronologically.
    const kept = (await readdir(dir)).filter((f) => /^\d{8}T\d{6,9}Z\.json$/.test(f)).sort();
    for (const old of kept.slice(0, Math.max(0, kept.length - history))) await rm(path.join(dir, old), { force: true });
  }
  if (formats.includes("sarif")) {
    const file = path.join(outputDir, "report.sarif");
    await writeFile(file, JSON.stringify(toSarif(report), null, 2) + "\n");
    written.push(file);
  }
  return written;
}
