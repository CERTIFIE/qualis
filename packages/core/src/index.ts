export { analyze, writeReport, type AnalyzeOptions, type ProgressEvent } from "./analyze.js";
export {
  BUILT_IN_EXCLUDES,
  CONFIG_FILE_NAMES,
  DEFAULT_COVERAGE_EXCLUDES,
  DEFAULT_TEST_SOURCES,
  ConfigError,
  DEFAULT_PLUGINS,
  DEFAULT_QUALITY_GATE,
  findConfigFile,
  loadConfig,
  readConfigFile,
  resolveConfig,
  type ResolvedConfig,
} from "./config.js";
export { coverageMeasures, importCoverage, parseCobertura, parseLcov, parseOpenCover } from "./coverage.js";
export { detectDuplications, type CpdInput, type DuplicationResult } from "./duplication.js";
export { externalRuleId, importExternalIssues, type ExternalFinding, type ExternalImport, type ExternalRuleInfo } from "./external.js";
export { discoverFiles } from "./files.js";
export { checkConditions, evaluateGate, GateConfigError } from "./gate.js";
export { parseUnifiedDiff } from "./git.js";
export {
  complexityBand,
  debtRatio,
  functionReport,
  halsteadMeasures,
  maintainabilityBand,
  maintainabilityIndex,
  maintainabilityRating,
  severityRating,
} from "./metrics.js";
export { loadPlugin, PluginError, type PluginHandle } from "./plugins/host.js";
export { defaultScope, resolveRules } from "./rules.js";
export { toSarif } from "./sarif.js";
export { parseJUnit, parseTrx, testMeasures } from "./tests.js";
export { validate, type ValidationResult } from "./validation.js";
export { CORE_VERSION } from "./version.js";
