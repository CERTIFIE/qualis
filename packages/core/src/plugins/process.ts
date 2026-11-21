import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import { createInterface } from "node:readline";
import type { FileAnalysis, PluginManifest, ProcessPluginReference, RulePackAnalysis } from "@qualis/schema";
import {
  METHODS,
  PLUGIN_API_VERSION,
  type AnalyzeFileRequest,
  type EnabledRule,
  type JsonRpcMessage,
  type JsonRpcResponse,
  type Logger,
  type LogLevel,
  type PluginFile,
} from "@qualis/plugin-api";
import { CORE_VERSION } from "../version.js";
import { checkFileAnalysis, checkManifest, kindOf, PluginError } from "./checks.js";
import type { PluginHandle } from "./host.js";

const TIMEOUTS = { initialize: 30_000, prepare: 1_800_000, analyzeFile: 120_000, shutdown: 10_000 };

interface Pending {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

/** A plugin running as a separate process, speaking JSON-RPC 2.0 over stdio (NDJSON). */
export class ProcessPlugin implements PluginHandle {
  readonly transport = "process" as const;
  private child: ChildProcessWithoutNullStreams | undefined;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private stderr = "";
  private exited: Error | undefined;
  private _manifest: PluginManifest | undefined;

  constructor(
    private readonly reference: ProcessPluginReference,
    private readonly baseDir: string,
    private readonly log: Logger,
  ) {}

  get manifest(): PluginManifest {
    if (!this._manifest) throw new PluginError("Plugin process not initialized");
    return this._manifest;
  }

  private get label(): string {
    return [this.reference.command, ...(this.reference.args ?? [])].join(" ");
  }

  async start(): Promise<void> {
    const cwd = this.reference.cwd ? path.resolve(this.baseDir, this.reference.cwd) : this.baseDir;
    const child = spawn(this.reference.command, this.reference.args ?? [], {
      cwd,
      env: { ...process.env, ...this.reference.env },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.child = child;
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      this.stderr = (this.stderr + chunk).slice(-8192);
    });
    child.on("error", (error) => this.fail(new PluginError(`Cannot start plugin "${this.label}": ${error.message}`)));
    child.on("exit", (code, signal) => {
      const tail = this.stderr.trim() ? `\n${this.stderr.trim()}` : "";
      this.fail(new PluginError(`Plugin "${this.label}" exited (code ${code ?? "null"}, signal ${signal ?? "none"})${tail}`));
    });
    child.stdin.on("error", () => undefined); // reported through "exit"
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    lines.on("line", (line) => this.onLine(line));

    const manifest = await this.request(METHODS.initialize, {
      apiVersion: PLUGIN_API_VERSION,
      host: { name: "qualis", version: CORE_VERSION },
    }, TIMEOUTS.initialize);
    this._manifest = checkManifest(manifest, `"${this.label}"`);
  }

  private fail(error: Error): void {
    if (this.exited) return;
    this.exited = error;
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
  }

  private onLine(line: string): void {
    if (line.trim() === "") return;
    let message: JsonRpcMessage;
    try {
      message = JSON.parse(line) as JsonRpcMessage;
    } catch {
      this.log.log("warning", `Plugin "${this.label}" wrote a non-JSON line to stdout: ${line.slice(0, 200)}`);
      return;
    }
    if ("method" in message) {
      if (message.method === METHODS.log) {
        const params = message.params as { level?: LogLevel; message?: string } | undefined;
        this.log.log(params?.level ?? "info", `[${this._manifest?.id ?? this.label}] ${params?.message ?? ""}`);
      }
      return;
    }
    const response = message as JsonRpcResponse;
    const pending = typeof response.id === "number" ? this.pending.get(response.id) : undefined;
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(response.id as number);
    if (response.error) {
      pending.reject(new PluginError(`Plugin "${this._manifest?.id ?? this.label}": ${response.error.message}`));
    } else {
      pending.resolve(response.result ?? null);
    }
  }

  private request(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
    if (this.exited) return Promise.reject(this.exited);
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new PluginError(`Plugin "${this.label}" did not answer "${method}" within ${timeoutMs / 1000}s`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child!.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }

  async prepare(baseDir: string, files: PluginFile[], rules: EnabledRule[]): Promise<void> {
    await this.request(METHODS.prepare, { baseDir, files, options: this.reference.options ?? {}, rules }, TIMEOUTS.prepare);
  }

  async analyzeFile(request: AnalyzeFileRequest): Promise<FileAnalysis | RulePackAnalysis> {
    const result = await this.request(METHODS.analyzeFile, request, TIMEOUTS.analyzeFile);
    return checkFileAnalysis(result, this.manifest.id, request.file.path, kindOf(this.manifest));
  }

  async dispose(): Promise<void> {
    if (!this.child || this.exited) return;
    try {
      await this.request(METHODS.shutdown, {}, TIMEOUTS.shutdown);
      this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: METHODS.exit }) + "\n");
      this.child.stdin.end();
    } catch {
      // fall through to kill
    }
    const child = this.child;
    await new Promise<void>((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) return resolve();
      const timer = setTimeout(() => {
        child.kill();
        resolve();
      }, 2000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}
