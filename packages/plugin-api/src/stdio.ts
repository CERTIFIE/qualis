import { createInterface } from "node:readline";
import type { AnalyzeFileRequest, EnabledRule, LogLevel, PluginFile, QualisPlugin } from "./plugin.js";
import { manifestOf, PLUGIN_API_VERSION } from "./plugin.js";
import { ERROR_CODES, METHODS, type JsonRpcRequest, type JsonRpcResponse } from "./protocol.js";

interface PrepareParams {
  baseDir: string;
  files: PluginFile[];
  options: Record<string, unknown>;
  rules?: EnabledRule[];
}

/**
 * Serves a JavaScript plugin over the stdio protocol. Useful to run a plugin
 * out of process, and as a reference implementation of the plugin side of the
 * protocol for authors using other languages.
 */
export function runStdioPlugin(
  plugin: QualisPlugin,
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stdout,
): Promise<void> {
  const send = (message: object) => {
    output.write(JSON.stringify(message) + "\n");
  };
  const log = (level: LogLevel, message: string) =>
    send({ jsonrpc: "2.0", method: METHODS.log, params: { level, message } });

  const handle = async (request: JsonRpcRequest): Promise<unknown> => {
    switch (request.method) {
      case METHODS.initialize: {
        const params = request.params as { apiVersion?: number } | undefined;
        if (params?.apiVersion !== PLUGIN_API_VERSION) {
          throw Object.assign(new Error(`Unsupported plugin API version ${String(params?.apiVersion)}`), {
            code: ERROR_CODES.invalidParams,
          });
        }
        return manifestOf(plugin);
      }
      case METHODS.prepare: {
        const params = request.params as PrepareParams;
        await plugin.prepare?.({ ...params, rules: params.rules ?? [], log: { log } });
        return null;
      }
      case METHODS.analyzeFile:
        return await plugin.analyzeFile(request.params as AnalyzeFileRequest);
      case METHODS.shutdown:
        await plugin.dispose?.();
        return null;
      default:
        throw Object.assign(new Error(`Unknown method ${request.method}`), { code: ERROR_CODES.methodNotFound });
    }
  };

  return new Promise((resolve) => {
    const lines = createInterface({ input, crlfDelay: Infinity });
    // Requests are processed one at a time, in order.
    let queue = Promise.resolve();
    lines.on("line", (line) => {
      if (line.trim() === "") return;
      queue = queue.then(async () => {
        let message: JsonRpcRequest;
        try {
          message = JSON.parse(line) as JsonRpcRequest;
        } catch {
          send({ jsonrpc: "2.0", id: null, error: { code: ERROR_CODES.parseError, message: "Invalid JSON" } });
          return;
        }
        if (message.method === METHODS.exit) {
          lines.close();
          return;
        }
        if (message.id === undefined) return; // unknown notification
        const response: JsonRpcResponse = { jsonrpc: "2.0", id: message.id };
        try {
          response.result = await handle(message);
        } catch (error) {
          const code = (error as { code?: unknown }).code;
          response.error = {
            code: typeof code === "number" ? code : ERROR_CODES.internalError,
            message: error instanceof Error ? error.message : String(error),
          };
        }
        send(response);
      });
    });
    lines.on("close", () => {
      void queue.then(() => resolve());
    });
  });
}
