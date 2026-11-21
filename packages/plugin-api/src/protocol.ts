/**
 * Out-of-process plugin protocol.
 *
 * Transport: the host spawns the plugin and talks JSON-RPC 2.0 over the
 * plugin's stdin/stdout. Every message is one JSON object encoded as UTF-8 on a
 * single line terminated by `\n` (newline-delimited JSON). stderr is free-form
 * diagnostic output collected by the host.
 *
 * Lifecycle (host → plugin):
 *   1. request  `initialize`  {apiVersion, host}           → PluginManifest
 *   2. request  `prepare`     {baseDir, files, options, rules} → null
 *   3. request  `analyzeFile` {file, content, rules} (×N)  → FileAnalysis
 *   4. request  `shutdown`    {}                           → null
 *   5. notification `exit`
 * Plugin → host: notification `log` {level, message} at any time.
 */

export const METHODS = {
  initialize: "initialize",
  prepare: "prepare",
  analyzeFile: "analyzeFile",
  shutdown: "shutdown",
  exit: "exit",
  log: "log",
} as const;

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: JsonRpcError;
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

/** Standard JSON-RPC 2.0 error codes. */
export const ERROR_CODES = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
} as const;

export interface InitializeParams {
  apiVersion: 1;
  host: { name: string; version: string };
}
