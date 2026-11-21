import type {
  FileAnalysis,
  LanguageDescriptor,
  PluginManifest,
  RuleDefinition,
  RulePackAnalysis,
} from "@qualis/schema";

/** Version of the plugin contract implemented by this package. */
export const PLUGIN_API_VERSION = 1 as const;

export type LogLevel = "debug" | "info" | "warning" | "error";

export interface Logger {
  log(level: LogLevel, message: string): void;
}

/** A file assigned to a plugin. */
export interface PluginFile {
  /** Path relative to the project root, forward slashes. */
  path: string;
  absolutePath: string;
  /** Language id, one of the plugin's `languages`. */
  language: string;
}

/** Context passed once, before any file is analysed. */
export interface PrepareContext {
  /** Absolute path of the project root. */
  baseDir: string;
  /** All files assigned to this plugin in this analysis. */
  files: PluginFile[];
  /** Plugin options from the configuration (`plugins[].options`). */
  options: Record<string, unknown>;
  /** Rules of this plugin enabled for the analysis (the same list `analyzeFile` receives). */
  rules: EnabledRule[];
  log: Logger;
}

/** A rule enabled for the analysis, with its effective parameters. */
export interface EnabledRule {
  id: string;
  params: Record<string, number | string | boolean>;
}

export interface AnalyzeFileRequest {
  file: PluginFile;
  /** File content decoded as UTF-8 (BOM removed). */
  content: string;
  /** Rules of this plugin that are enabled. Only these may produce issues. */
  rules: EnabledRule[];
}

/**
 * An in-process language plugin.
 *
 * A plugin package default-exports either an object implementing this
 * interface or a (possibly async) function returning one.
 */
export interface LanguagePlugin extends PluginManifest {
  kind?: "language";
  /** Called once per analysis before `analyzeFile`. */
  prepare?(context: PrepareContext): void | Promise<void>;
  analyzeFile(request: AnalyzeFileRequest): FileAnalysis | Promise<FileAnalysis>;
  /** Called once when the analysis is over. */
  dispose?(): void | Promise<void>;
}

/**
 * An in-process rule pack: adds rules to the files of the languages it lists,
 * which are owned (and measured) by language plugins.
 */
export interface RulePackPlugin extends PluginManifest {
  kind: "rule-pack";
  /** Called once per analysis before `analyzeFile`; throw to report that the pack cannot run. */
  prepare?(context: PrepareContext): void | Promise<void>;
  analyzeFile(request: AnalyzeFileRequest): RulePackAnalysis | Promise<RulePackAnalysis>;
  dispose?(): void | Promise<void>;
}

export type QualisPlugin = LanguagePlugin | RulePackPlugin;

export type LanguagePluginFactory = () => LanguagePlugin | Promise<LanguagePlugin>;

/**
 * What a plugin module may export to be started as a separate process: the
 * host spawns `command args` and speaks the stdio protocol with it. This lets a
 * plugin written in another language be published and referenced as an npm package.
 */
export interface ProcessPluginDescriptor {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

/** Identity helper giving type checking to plugin authors. */
export function definePlugin<T extends QualisPlugin>(plugin: T): T {
  return plugin;
}

/** Identity helper giving type checking to rule definitions. */
export function defineRule(rule: RuleDefinition): RuleDefinition {
  return rule;
}

/** Extracts the static manifest of a plugin (what `initialize` returns over stdio). */
export function manifestOf(plugin: QualisPlugin): PluginManifest {
  const manifest: PluginManifest = {
    apiVersion: plugin.apiVersion,
    ...(plugin.kind !== undefined && { kind: plugin.kind }),
    id: plugin.id,
    name: plugin.name,
    version: plugin.version,
    languages: plugin.languages.map((l: LanguageDescriptor) => ({ ...l })),
    rules: plugin.rules,
  };
  if (plugin.description !== undefined) manifest.description = plugin.description;
  if (plugin.homepage !== undefined) manifest.homepage = plugin.homepage;
  return manifest;
}
