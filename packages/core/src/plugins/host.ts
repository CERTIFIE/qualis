import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { FileAnalysis, PluginManifest, PluginReference, RulePackAnalysis } from "@qualis/schema";
import {
  type AnalyzeFileRequest,
  type EnabledRule,
  type Logger,
  type PluginFile,
  type ProcessPluginDescriptor,
  type QualisPlugin,
} from "@qualis/plugin-api";
import { checkFileAnalysis, checkManifest, kindOf, PluginError } from "./checks.js";
import { ProcessPlugin } from "./process.js";

export { checkFileAnalysis, checkManifest, kindOf, PluginError };

/** A loaded plugin, whatever its transport. */
export interface PluginHandle {
  readonly manifest: PluginManifest;
  readonly transport: "module" | "process";
  prepare(baseDir: string, files: PluginFile[], rules: EnabledRule[], log: Logger): Promise<void>;
  /** A file analysis for language plugins, issues only for rule packs. */
  analyzeFile(request: AnalyzeFileRequest): Promise<FileAnalysis | RulePackAnalysis>;
  dispose(): Promise<void>;
}

class ModulePlugin implements PluginHandle {
  readonly transport = "module" as const;
  readonly manifest: PluginManifest;

  constructor(
    private readonly plugin: QualisPlugin,
    private readonly options: Record<string, unknown>,
    private readonly validateResults: boolean,
  ) {
    this.manifest = checkManifest(
      {
        apiVersion: plugin.apiVersion,
        ...(plugin.kind !== undefined && { kind: plugin.kind }),
        id: plugin.id,
        name: plugin.name,
        version: plugin.version,
        ...(plugin.description !== undefined && { description: plugin.description }),
        ...(plugin.homepage !== undefined && { homepage: plugin.homepage }),
        languages: plugin.languages,
        rules: plugin.rules,
      },
      plugin.id,
    );
  }

  async prepare(baseDir: string, files: PluginFile[], rules: EnabledRule[], log: Logger): Promise<void> {
    await this.plugin.prepare?.({ baseDir, files, options: this.options, rules, log });
  }

  async analyzeFile(request: AnalyzeFileRequest): Promise<FileAnalysis | RulePackAnalysis> {
    const result = await this.plugin.analyzeFile(request);
    return this.validateResults ? checkFileAnalysis(result, this.manifest.id, request.file.path, kindOf(this.manifest)) : result;
  }

  async dispose(): Promise<void> {
    await this.plugin.dispose?.();
  }
}

function resolveModule(specifier: string, searchPaths: string[]): string {
  if (specifier.startsWith(".") || path.isAbsolute(specifier)) {
    return path.resolve(searchPaths[0]!, specifier);
  }
  const errors: string[] = [];
  for (const dir of searchPaths) {
    try {
      return createRequire(path.join(dir, "noop.js")).resolve(specifier);
    } catch (error) {
      errors.push((error as Error).message.split("\n")[0]!);
    }
  }
  throw new PluginError(`Cannot find plugin module "${specifier}" (searched ${searchPaths.join(", ")})`);
}

export interface LoadPluginOptions {
  /** Project root; relative module paths and process `cwd` resolve against it. */
  baseDir: string;
  /** Additional directories to resolve bare module specifiers from (e.g. the CLI's install dir). */
  resolveFrom?: string[];
  /** Validate every in-process plugin result against the schema (always done for process plugins). */
  validateModuleResults?: boolean;
  log: Logger;
}

/** Loads a plugin from a configuration reference. */
export async function loadPlugin(reference: PluginReference, options: LoadPluginOptions): Promise<PluginHandle> {
  if (typeof reference === "object" && "command" in reference) {
    const plugin = new ProcessPlugin(reference, options.baseDir, options.log);
    await plugin.start();
    return plugin;
  }
  const specifier = typeof reference === "string" ? reference : reference.module;
  const pluginOptions = typeof reference === "string" ? {} : (reference.options ?? {});
  const resolved = resolveModule(specifier, [options.baseDir, ...(options.resolveFrom ?? [])]);
  let exported: unknown;
  try {
    const mod = (await import(pathToFileURL(resolved).href)) as { default?: unknown };
    exported = mod.default ?? mod;
  } catch (error) {
    throw new PluginError(`Cannot load plugin "${specifier}": ${(error as Error).message}`);
  }
  const value = typeof exported === "function" ? await (exported as () => unknown)() : exported;
  // A module may ask to be started as a separate process (plugins written in other languages).
  const descriptor = value as Partial<ProcessPluginDescriptor> | undefined;
  if (descriptor && typeof descriptor.command === "string" && !("analyzeFile" in descriptor)) {
    const plugin = new ProcessPlugin(
      {
        command: descriptor.command,
        ...(descriptor.args && { args: descriptor.args }),
        ...(descriptor.env && { env: descriptor.env }),
        options: pluginOptions,
      },
      options.baseDir,
      options.log,
    );
    await plugin.start();
    return plugin;
  }
  const plugin = value as QualisPlugin;
  if (!plugin || typeof plugin.analyzeFile !== "function") {
    throw new PluginError(`Module "${specifier}" does not export a Qualis plugin`);
  }
  return new ModulePlugin(plugin, pluginOptions, options.validateModuleResults ?? false);
}
