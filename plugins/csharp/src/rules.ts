import type { Node, Parser } from "web-tree-sitter";
import {
  TASK_MARKER,
  type FileMeasures,
  type LineIndex,
  type RuleDefinition,
  type TextRange,
} from "@qualis/plugin-api";
import { REF } from "./references.js";
import { rangeOf, walk, type Comment, type FunctionInfo } from "./syntax.js";

const LANGUAGES = ["csharp"];

export interface RuleContext {
  params: Record<string, number | string | boolean>;
  /** Names of `const` fields and locals declared in the file. */
  constants: ReadonlySet<string>;
  lines: LineIndex;
  comments: Comment[];
  functions: FunctionInfo[];
  measures: FileMeasures;
  /** Parser for re-parsing snippets (commented-out code detection). */
  parser: Parser;
  report(target: Node | TextRange, message: string, options?: { effortMinutes?: number }): void;
}

export interface Rule {
  definition: RuleDefinition;
  visit?: (node: Node, ctx: RuleContext) => void;
  check?: (ctx: RuleContext) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Last simple name of a (possibly qualified or generic) type or member expression. */
function simpleName(node: Node | null | undefined): string | undefined {
  if (!node) return undefined;
  switch (node.type) {
    case "identifier":
      return node.text;
    case "generic_name":
      return node.namedChildren[0]?.text;
    case "qualified_name":
      return simpleName(node.namedChildren[node.namedChildren.length - 1]);
    case "member_access_expression":
      return simpleName(node.childForFieldName("name"));
    case "alias_qualified_name":
      return simpleName(node.namedChildren[node.namedChildren.length - 1]);
    default:
      return undefined;
  }
}

/** `{receiver, name}` of an invocation such as `MD5.Create()` or `db.Database.ExecuteSqlRaw(...)`. */
function invocation(node: Node): { receiver: Node | null; name: string | undefined } {
  const fn = node.childForFieldName("function");
  if (fn?.type === "member_access_expression") return { receiver: fn.childForFieldName("expression"), name: simpleName(fn.childForFieldName("name")) };
  return { receiver: null, name: simpleName(fn) };
}

function args(node: Node): Node[] {
  const list = node.childForFieldName("arguments");
  return (list?.namedChildren ?? []).filter((a): a is Node => a?.type === "argument").map((a) => a.namedChildren[a.namedChildren.length - 1]!).filter(Boolean);
}

const STRING_LITERALS = new Set(["string_literal", "verbatim_string_literal", "raw_string_literal"]);

function literalText(node: Node): string | undefined {
  if (node.type === "string_literal" || node.type === "raw_string_literal") {
    return node.namedChildren.filter((c) => c?.type === "string_literal_content" || c?.type === "escape_sequence").map((c) => c!.text).join("");
  }
  if (node.type === "verbatim_string_literal") return node.text.replace(/^@"/, "").replace(/"$/, "").replace(/""/g, "\"");
  return undefined;
}

function unwrap(node: Node): Node {
  let n = node;
  while (n.type === "parenthesized_expression" && n.namedChildren[0]) n = n.namedChildren[0];
  return n;
}

const NO_CONSTANTS: ReadonlySet<string> = new Set();

/** Names of `const` fields and local constants declared in a file. */
export function collectConstants(root: Node): Set<string> {
  const names = new Set<string>();
  walk(root, (node) => {
    if ((node.type === "field_declaration" || node.type === "local_declaration_statement") && node.children.some((c) => c?.type === "modifier" && c.text === "const")) {
      const declaration = node.namedChildren.find((c) => c?.type === "variable_declaration");
      for (const d of declaration?.namedChildren ?? []) {
        const name = d?.type === "variable_declarator" ? d.childForFieldName("name")?.text : undefined;
        if (name) names.add(name);
      }
    }
  });
  return names;
}

/**
 * Expressions that can only produce constant text: literals, `nameof`, constants
 * declared in the file (`Name` or `Type.Name`) and conditionals between them.
 */
function isConstantValue(node: Node, constants: ReadonlySet<string> = NO_CONSTANTS): boolean {
  const n = unwrap(node);
  if (STRING_LITERALS.has(n.type) || n.type === "integer_literal" || n.type === "real_literal" || n.type === "boolean_literal") return true;
  if (n.type === "interpolated_string_expression") return isConstantString(n, constants);
  if (n.type === "invocation_expression") return invocation(n).name === "nameof";
  if (n.type === "identifier") return constants.has(n.text);
  if (n.type === "member_access_expression") {
    const owner = n.childForFieldName("expression");
    return owner?.type === "identifier" && /^[A-Z]/.test(owner.text) && constants.has(simpleName(n) ?? "");
  }
  if (n.type === "conditional_expression") {
    return isConstantValue(n.childForFieldName("consequence")!, constants) && isConstantValue(n.childForFieldName("alternative")!, constants);
  }
  return false;
}

function isConstantString(node: Node, constants: ReadonlySet<string> = NO_CONSTANTS): boolean {
  const n = unwrap(node);
  if (STRING_LITERALS.has(n.type)) return true;
  if (n.type === "interpolated_string_expression") {
    return n.namedChildren
      .filter((c): c is Node => c?.type === "interpolation")
      .every((i) => i.namedChildren.filter((c) => c && c.type !== "interpolation_brace" && c.type !== "interpolation_alignment_clause" && c.type !== "interpolation_format_clause").every((c) => isConstantValue(c!, constants)));
  }
  if (n.type === "binary_expression" && n.childForFieldName("operator")?.type === "+") {
    return isConstantString(n.childForFieldName("left")!, constants) && isConstantString(n.childForFieldName("right")!, constants);
  }
  return false;
}

/** Pieces of a string expression in source order: literal text or an inserted expression. */
type Piece = { text: string } | { inserted: Node };

function pieces(node: Node, constants: ReadonlySet<string>, out: Piece[] = []): Piece[] {
  const n = unwrap(node);
  if (STRING_LITERALS.has(n.type)) out.push({ text: literalText(n) ?? "" });
  else if (n.type === "interpolated_string_expression") {
    for (const c of n.namedChildren) {
      if (!c) continue;
      if (c.type === "string_content" || c.type === "escape_sequence") out.push({ text: c.text });
      else if (c.type === "interpolation") {
        const expr = c.namedChildren.find((x) => x && x.type !== "interpolation_brace" && x.type !== "interpolation_alignment_clause" && x.type !== "interpolation_format_clause");
        if (expr) out.push(isConstantValue(expr, constants) ? { text: "?" } : { inserted: expr });
      }
    }
  } else if (n.type === "binary_expression" && n.childForFieldName("operator")?.type === "+") {
    pieces(n.childForFieldName("left")!, constants, out);
    pieces(n.childForFieldName("right")!, constants, out);
  } else if (isConstantValue(n, constants)) out.push({ text: "?" });
  else out.push({ inserted: n });
  return out;
}

const SQL_START = /^\s*(select|insert|update|delete|merge|with|create|alter|drop|truncate|exec|execute|grant|revoke)\b/i;
/** Text that places the next inserted expression where SQL expects a data value. */
const VALUE_CONTEXT = /(=|<>|!=|<|>|\bin\s*\(|\blike|\bvalues\s*\(|\bbetween|\blimit|\boffset|\btop\s*\(?)\s*$/i;

export type SqlKind = "value" | "structure";

/**
 * Classifies a string expression used as SQL text: `value` when variable data is
 * inserted where a data value is expected (inside '...' or after an operator),
 * `structure` when only identifiers or fragments are inserted, undefined when the
 * text is constant or does not build SQL from expressions.
 */
export function classifySql(node: Node, constants: ReadonlySet<string> = NO_CONSTANTS): SqlKind | undefined {
  const n = unwrap(node);
  if (n.type !== "interpolated_string_expression" && !(n.type === "binary_expression" && n.childForFieldName("operator")?.type === "+")) return undefined;
  let before = "";
  let kind: SqlKind | undefined;
  for (const piece of pieces(n, constants)) {
    if ("text" in piece) {
      before += piece.text;
      continue;
    }
    const insideQuotes = (before.match(/'/g)?.length ?? 0) % 2 === 1;
    if (insideQuotes || VALUE_CONTEXT.test(before)) return "value";
    kind = "structure";
    before += "x";
  }
  return kind;
}

function leadingText(node: Node): string {
  const first = pieces(node, NO_CONSTANTS)[0];
  return first && "text" in first ? first.text : "";
}

function memberAssigned(node: Node): string | undefined {
  if (node.type !== "assignment_expression") return undefined;
  return simpleName(node.childForFieldName("left"));
}

// ---------------------------------------------------------------------------
// Security
// ---------------------------------------------------------------------------

const INSECURE_SERIALIZERS = new Set(["BinaryFormatter", "SoapFormatter", "NetDataContractSerializer", "LosFormatter", "ObjectStateFormatter"]);

const noInsecureDeserializer: Rule = {
  definition: {
    id: "csharp:no-insecure-deserializer",
    name: "BinaryFormatter and related serializers should not be used",
    languages: LANGUAGES,
    type: "vulnerability",
    severity: "critical",
    tags: ["deserialization", "cwe-502"],
    enabledByDefault: true,
    effortMinutes: 60,
    description: "Reports instantiations of `BinaryFormatter`, `SoapFormatter`, `NetDataContractSerializer`, `LosFormatter` and `ObjectStateFormatter`.",
    rationale:
      "Microsoft states that the `BinaryFormatter` type is dangerous and not recommended for data processing: deserializing a crafted payload can run arbitrary code, and the type cannot be made secure. The same guidance covers the related formatters. This is Deserialization of Untrusted Data (CWE-502).",
    noncompliantExample: "var formatter = new BinaryFormatter();\nvar order = (Order)formatter.Deserialize(stream);",
    compliantExample: "var order = JsonSerializer.Deserialize<Order>(stream);",
    references: [REF.binaryFormatter, REF.cwe502],
  },
  visit(node, ctx) {
    if (node.type !== "object_creation_expression") return;
    const name = simpleName(node.childForFieldName("type"));
    if (name && INSECURE_SERIALIZERS.has(name)) ctx.report(node.childForFieldName("type")!, `${name} is insecure; use System.Text.Json or another safe serializer.`);
  },
};

const WEAK_HASH_TYPES = new Set(["MD5", "SHA1", "RIPEMD160"]);
const WEAK_HASH_CLASSES = new Set(["MD5CryptoServiceProvider", "MD5Cng", "SHA1CryptoServiceProvider", "SHA1Managed", "SHA1Cng", "RIPEMD160Managed"]);
const HASH_FACTORIES = new Set(["Create", "HashData", "HashDataAsync", "TryHashData"]);

const noWeakHash: Rule = {
  definition: {
    id: "csharp:no-weak-hash",
    name: "Weak hash algorithms should not be used",
    languages: LANGUAGES,
    type: "vulnerability",
    severity: "major",
    tags: ["crypto", "cwe-328"],
    enabledByDefault: true,
    effortMinutes: 15,
    description: "Reports uses of MD5, SHA-1 and RIPEMD-160: `MD5.Create()`, `SHA1.HashData()`, `new SHA1Managed()` and similar.",
    rationale:
      "Microsoft code analysis rules CA5351 (broken algorithms: MD5) and CA5350 (weak algorithms: SHA-1, RIPEMD-160) ask to replace these hash functions with SHA-2 family algorithms because collisions can be produced. Using them for integrity or security is a weak-hash weakness (CWE-328).",
    exceptions: "Non-security uses (checksums required by an external format) can be suppressed with `// qualis-ignore-next-line csharp:no-weak-hash -- reason`.",
    noncompliantExample: "using var md5 = MD5.Create();",
    compliantExample: "using var sha = SHA256.Create();",
    references: [REF.ca5351, REF.ca5350, REF.cwe328],
  },
  visit(node, ctx) {
    if (node.type === "invocation_expression") {
      const { receiver, name } = invocation(node);
      const type = simpleName(receiver);
      if (type && WEAK_HASH_TYPES.has(type) && name && HASH_FACTORIES.has(name)) ctx.report(node, `${type} is a weak hash algorithm; use SHA-256 or stronger.`);
    } else if (node.type === "object_creation_expression") {
      const name = simpleName(node.childForFieldName("type"));
      if (name && WEAK_HASH_CLASSES.has(name)) ctx.report(node, `${name} is a weak hash algorithm; use SHA-256 or stronger.`);
    }
  },
};

const WEAK_CIPHER_TYPES = new Set(["DES", "TripleDES", "RC2"]);
const WEAK_CIPHER_CLASSES = new Set(["DESCryptoServiceProvider", "TripleDESCryptoServiceProvider", "TripleDESCng", "RC2CryptoServiceProvider"]);
const UNSAFE_MODES = new Set(["ECB", "OFB", "CFB"]);

const noWeakCipher: Rule = {
  definition: {
    id: "csharp:no-weak-cipher",
    name: "Broken or risky ciphers and cipher modes should not be used",
    languages: LANGUAGES,
    type: "vulnerability",
    severity: "critical",
    tags: ["crypto", "cwe-327"],
    enabledByDefault: true,
    effortMinutes: 30,
    description: "Reports DES, triple DES and RC2 (`DES.Create()`, `new TripleDESCryptoServiceProvider()`, …) and the `CipherMode.ECB`, `CipherMode.OFB` and `CipherMode.CFB` modes.",
    rationale:
      "CA5351 lists DES and RC2 as broken algorithms and CA5350 lists TripleDES as weak; NIST SP 800-131A Rev. 2 disallows two-key TDEA and, after 2023, three-key TDEA for encryption. CA5358 flags ECB, OFB and CFB as unsafe cipher modes. These are broken or risky algorithms (CWE-327); use AES with an authenticated mode such as `AesGcm`.",
    noncompliantExample: "using var des = TripleDES.Create();\naes.Mode = CipherMode.ECB;",
    compliantExample: "using var aes = new AesGcm(key, tagSizeInBytes: 16);",
    references: [REF.ca5351, REF.ca5350, REF.ca5358, REF.nist800131a, REF.cwe327],
  },
  visit(node, ctx) {
    if (node.type === "invocation_expression") {
      const { receiver, name } = invocation(node);
      const type = simpleName(receiver);
      if (type && WEAK_CIPHER_TYPES.has(type) && name === "Create") ctx.report(node, `${type} is a broken or weak cipher; use AES-GCM.`);
    } else if (node.type === "object_creation_expression") {
      const name = simpleName(node.childForFieldName("type"));
      if (name && WEAK_CIPHER_CLASSES.has(name)) ctx.report(node, `${name} is a broken or weak cipher; use AES-GCM.`);
    } else if (node.type === "member_access_expression") {
      const owner = simpleName(node.childForFieldName("expression"));
      const mode = simpleName(node.childForFieldName("name"));
      if (owner === "CipherMode" && mode && UNSAFE_MODES.has(mode)) ctx.report(node, `CipherMode.${mode} is unsafe; use an authenticated mode such as AES-GCM.`);
    }
  },
};

const VALIDATION_CALLBACKS = new Set(["ServerCertificateCustomValidationCallback", "ServerCertificateValidationCallback", "RemoteCertificateValidationCallback"]);

/** True when a lambda or anonymous method returns the literal `true` unconditionally. */
function alwaysTrue(node: Node): boolean {
  const n = unwrap(node);
  if (n.type !== "lambda_expression" && n.type !== "anonymous_method_expression") return false;
  const body = n.childForFieldName("body") ?? n.namedChildren.find((c) => c?.type === "block") ?? null;
  if (!body) return false;
  if (body.type === "block") {
    const statements = body.namedChildren.filter((c) => c && c.type !== "comment");
    const first = statements[0];
    return statements.length === 1 && first?.type === "return_statement" && first.namedChildren[0]?.text === "true";
  }
  return unwrap(body).text === "true";
}

const noCertificateValidationBypass: Rule = {
  definition: {
    id: "csharp:no-certificate-validation-bypass",
    name: "Server certificate validation should not be disabled",
    languages: LANGUAGES,
    type: "vulnerability",
    severity: "critical",
    tags: ["tls", "cwe-295"],
    enabledByDefault: true,
    effortMinutes: 15,
    description:
      "Reports certificate validation callbacks (`ServerCertificateCustomValidationCallback`, `ServicePointManager.ServerCertificateValidationCallback`, `RemoteCertificateValidationCallback`) assigned a lambda that always returns `true`, and uses of `HttpClientHandler.DangerousAcceptAnyServerCertificateValidator`.",
    rationale:
      "A callback that accepts every certificate disables TLS server authentication, so any machine able to intercept the traffic can impersonate the server. Microsoft rule CA5359 asks not to disable certificate validation; MITRE classifies the weakness as Improper Certificate Validation (CWE-295).",
    noncompliantExample: "handler.ServerCertificateCustomValidationCallback = (msg, cert, chain, errors) => true;",
    compliantExample: "// Trust the internal CA by installing it in the machine store instead of disabling validation.",
    references: [REF.ca5359, REF.cwe295],
  },
  visit(node, ctx) {
    if (node.type === "assignment_expression") {
      const name = memberAssigned(node);
      const right = node.childForFieldName("right");
      if (name && VALIDATION_CALLBACKS.has(name) && right && alwaysTrue(right)) ctx.report(node, "This callback accepts every certificate; do not disable certificate validation.");
    } else if (node.type === "member_access_expression" && simpleName(node.childForFieldName("name")) === "DangerousAcceptAnyServerCertificateValidator") {
      ctx.report(node, "DangerousAcceptAnyServerCertificateValidator disables certificate validation.");
    }
  },
};

const COMMAND_TYPES = new Set(["SqlCommand", "SqliteCommand", "NpgsqlCommand", "MySqlCommand", "OracleCommand", "OleDbCommand", "OdbcCommand"]);
const RAW_SQL_METHODS = new Set(["FromSqlRaw", "ExecuteSqlRaw", "ExecuteSqlRawAsync", "SqlQueryRaw"]);
const DAPPER_METHODS = new Set(["Query", "QueryAsync", "QueryFirst", "QueryFirstAsync", "QueryFirstOrDefault", "QueryFirstOrDefaultAsync", "QuerySingle", "QuerySingleAsync", "QuerySingleOrDefault", "QuerySingleOrDefaultAsync", "QueryMultiple", "QueryMultipleAsync", "Execute", "ExecuteAsync", "ExecuteScalar", "ExecuteScalarAsync", "ExecuteReader", "ExecuteReaderAsync"]);

/** The SQL text argument when `node` passes SQL to a database API. */
function sqlText(node: Node): Node | undefined {
  if (node.type === "object_creation_expression") {
    const name = simpleName(node.childForFieldName("type"));
    return name && COMMAND_TYPES.has(name) ? args(node)[0] : undefined;
  }
  if (node.type === "assignment_expression") {
    return memberAssigned(node) === "CommandText" ? (node.childForFieldName("right") ?? undefined) : undefined;
  }
  if (node.type === "invocation_expression") {
    const { name } = invocation(node);
    const first = args(node)[0];
    if (!name || !first) return undefined;
    if (RAW_SQL_METHODS.has(name)) return first;
    if (DAPPER_METHODS.has(name) && SQL_START.test(leadingText(first))) return first;
  }
  return undefined;
}

const SQL_REFERENCES = [REF.ca2100, REF.efSqlQueries, REF.owaspSqli, REF.cwe89];

const noSqlInjection: Rule = {
  definition: {
    id: "csharp:no-sql-injection",
    name: "Data should not be concatenated or interpolated into SQL",
    languages: LANGUAGES,
    type: "vulnerability",
    severity: "critical",
    tags: ["injection", "sql", "cwe-89"],
    enabledByDefault: true,
    effortMinutes: 30,
    description:
      "Reports SQL text passed to an ADO.NET command (`new SqlCommand(...)`, `CommandText = ...`), to EF Core raw SQL methods (`FromSqlRaw`, `ExecuteSqlRaw`, `SqlQueryRaw`) or to Dapper methods, when a variable expression is interpolated or concatenated where SQL expects a data value: inside a quoted literal (`'{name}'`) or after a comparison, `IN (`, `LIKE`, `VALUES (`, `BETWEEN`, `LIMIT` or `OFFSET`.",
    rationale:
      "Microsoft rule CA2100 warns that SQL commands built from user input are vulnerable to SQL injection and recommends parameterized commands. The EF Core documentation explains that `FromSqlRaw` and the other raw methods must never receive interpolated user data, and offers `FromSql`/`FromSqlInterpolated`, which turn interpolations into parameters. OWASP names parameterized queries as the primary defense (CWE-89).",
    exceptions:
      "Interpolations that can only insert constant text (literals, `nameof`, `const` declared in the same file, conditionals between them) are ignored. Identifiers and SQL fragments inserted outside a value position are reported by `csharp:dynamic-sql-review` instead. The rule has no data-flow analysis.",
    noncompliantExample: "var cmd = new SqlCommand($\"SELECT * FROM Users WHERE Name = '{name}'\", connection);",
    compliantExample: "var cmd = new SqlCommand(\"SELECT * FROM Users WHERE Name = @name\", connection);\ncmd.Parameters.AddWithValue(\"@name\", name);",
    references: SQL_REFERENCES,
  },
  visit(node, ctx) {
    const sql = sqlText(node);
    if (sql && classifySql(sql, ctx.constants) === "value") ctx.report(sql, "Pass this value as a query parameter instead of inserting it into the SQL text.");
  },
};

const dynamicSqlReview: Rule = {
  definition: {
    id: "csharp:dynamic-sql-review",
    name: "Dynamically built SQL should be reviewed",
    languages: LANGUAGES,
    type: "security-hotspot",
    severity: "major",
    tags: ["injection", "sql", "cwe-89", "review"],
    enabledByDefault: true,
    effortMinutes: 10,
    description:
      "Reports SQL text passed to ADO.NET, EF Core raw SQL or Dapper APIs that inserts variable identifiers or SQL fragments (table, column, schema or role names, generated clauses) by interpolation or concatenation.",
    rationale:
      "Identifiers and SQL fragments cannot be passed as query parameters, so dynamic SQL is sometimes necessary (DDL, generated filters). It is still an injection vector if any inserted piece can be influenced by a user. Microsoft rule CA2100 asks to review such commands; OWASP recommends allow-listing identifiers. This is a security hotspot: it does not lower the security rating, but each occurrence should be reviewed.",
    exceptions: "Mark a reviewed occurrence with `// qualis-ignore-next-line csharp:dynamic-sql-review -- reason`.",
    noncompliantExample: "await admin.ExecuteAsync($\"DROP DATABASE IF EXISTS \\\"{tenant.DatabaseName}\\\"\");",
    compliantExample: "var name = TenantNames.Validate(tenant.DatabaseName);\n// qualis-ignore-next-line csharp:dynamic-sql-review -- name is validated against an allow-list pattern\nawait admin.ExecuteAsync($\"DROP DATABASE IF EXISTS \\\"{name}\\\"\");",
    references: SQL_REFERENCES,
  },
  visit(node, ctx) {
    const sql = sqlText(node);
    if (sql && classifySql(sql, ctx.constants) === "structure") ctx.report(sql, "Review this dynamic SQL: make sure the inserted identifiers or fragments cannot be influenced by users.");
  },
};

const CREDENTIAL_NAME = /(password|passwd|pwd|secret|api[_-]?key|access[_-]?key|access[_-]?token|auth[_-]?token|private[_-]?key|client[_-]?secret)$/i;
const CONNECTION_PASSWORD = /(?:^|;)\s*(password|pwd)\s*=\s*([^;]*)/i;

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const PLACEHOLDER = /^([.*xX#_<>{}[\]$%-]+|<[^>]*>|\$\{[^}]*\}|\{[^}]*\})$/;

/** True for values that look like a secret rather than a key name, label or placeholder. */
function looksLikeSecret(name: string, text: string): boolean {
  if (text.length < 4 || /\s/.test(text) || PLACEHOLDER.test(text)) return false;
  return normalize(text) !== normalize(name);
}

function credentialValue(name: string | undefined, value: Node | null | undefined): boolean {
  if (!name || !value || !CREDENTIAL_NAME.test(name)) return false;
  const text = literalText(unwrap(value));
  return text !== undefined && looksLikeSecret(name, text);
}

const noHardcodedCredentials: Rule = {
  definition: {
    id: "csharp:no-hardcoded-credentials",
    name: "Credentials should not be hard-coded",
    languages: LANGUAGES,
    type: "vulnerability",
    severity: "critical",
    tags: ["secrets", "cwe-798"],
    enabledByDefault: true,
    effortMinutes: 30,
    description:
      "Reports string literals (at least four characters, no spaces) assigned to variables, fields, properties or arguments whose name ends with password, pwd, secret, apiKey, accessToken, privateKey, clientSecret and similar, and connection strings containing a literal `Password=` or `Pwd=` value.",
    rationale:
      "Credentials written in source code are visible to everyone with access to the repository, its history and the compiled assemblies, and cannot be rotated without a release. MITRE CWE-798 recommends storing passwords, keys and other credentials outside of the code (configuration, user secrets, a key vault); OWASP classifies hard-coded passwords as a vulnerability.",
    exceptions:
      "Values shorter than four characters, values containing spaces, placeholders (`...`, `***`, `{0}`, `<password>`) and values equal to the name itself in another casing (`DatabasePassword = \"database-password\"`) are ignored.",
    noncompliantExample: "const string ConnectionString = \"Server=db;User Id=app;Password=S3cr3t!;\";",
    compliantExample: "var connectionString = configuration.GetConnectionString(\"Main\");",
    references: [REF.cwe798, REF.owaspHardcodedPassword],
  },
  visit(node, ctx) {
    let name: string | undefined;
    let value: Node | null | undefined;
    if (node.type === "variable_declarator") {
      name = node.childForFieldName("name")?.text;
      value = node.namedChildren.find((c) => c && c.type !== "identifier" && c.type !== "bracketed_argument_list" && c.type !== "tuple_pattern");
    } else if (node.type === "property_declaration") {
      name = node.childForFieldName("name")?.text;
      value = node.childForFieldName("value");
    } else if (node.type === "assignment_expression" && node.childForFieldName("operator")?.type === "=") {
      name = memberAssigned(node);
      value = node.childForFieldName("right");
    } else if (node.type === "argument") {
      name = node.childForFieldName("name")?.text;
      value = node.namedChildren[node.namedChildren.length - 1];
    }
    if (credentialValue(name, value)) {
      ctx.report(value!, `Do not hard-code the value of "${name}"; read it from configuration or a secret store.`);
      return;
    }
    if (STRING_LITERALS.has(node.type)) {
      const match = CONNECTION_PASSWORD.exec(literalText(node) ?? "");
      const secret = match?.[2]?.trim() ?? "";
      if (match && looksLikeSecret(match[1]!, secret)) ctx.report(node, "Do not hard-code passwords in connection strings.");
    }
  },
};

const noInsecureXmlDtd: Rule = {
  definition: {
    id: "csharp:no-insecure-xml-dtd",
    name: "XML parsers should not process DTDs or resolve external entities",
    languages: LANGUAGES,
    type: "vulnerability",
    severity: "critical",
    tags: ["xml", "xxe", "cwe-611"],
    enabledByDefault: true,
    effortMinutes: 15,
    description:
      "Reports `DtdProcessing = DtdProcessing.Parse`, `XmlResolver = new XmlUrlResolver()` and `ProhibitDtd = false`.",
    rationale:
      "Microsoft rule CA3075 explains that processing DTDs with an XML resolver lets a document reference external entities, exposing local files or internal services and enabling denial of service. MITRE classifies the weakness as Improper Restriction of XML External Entity Reference (CWE-611).",
    noncompliantExample: "var settings = new XmlReaderSettings { DtdProcessing = DtdProcessing.Parse };",
    compliantExample: "var settings = new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null };",
    references: [REF.ca3075, REF.cwe611],
  },
  visit(node, ctx) {
    if (node.type !== "assignment_expression") return;
    const name = memberAssigned(node);
    const right = node.childForFieldName("right");
    if (!right) return;
    const value = unwrap(right);
    if (name === "DtdProcessing" && /(^|\.)Parse$/.test(value.text)) ctx.report(node, "Do not enable DTD processing; use DtdProcessing.Prohibit or Ignore.");
    else if (name === "XmlResolver" && value.type === "object_creation_expression" && simpleName(value.childForFieldName("type")) === "XmlUrlResolver") ctx.report(node, "Do not resolve external XML entities; set XmlResolver to null.");
    else if (name === "ProhibitDtd" && value.text === "false") ctx.report(node, "Do not allow DTDs in XML documents.");
  },
};

// ---------------------------------------------------------------------------
// Reliability
// ---------------------------------------------------------------------------

const hasModifier = (node: Node, modifier: string) => node.children.some((c) => c?.type === "modifier" && c.text === modifier);

function isEventHandler(node: Node): boolean {
  const params = node.childForFieldName("parameters")?.namedChildren.filter((c) => c?.type === "parameter") ?? [];
  return params.length === 2 && /EventArgs(<.*>)?$/.test(params[1]!.childForFieldName("type")?.text ?? "");
}

const noAsyncVoid: Rule = {
  definition: {
    id: "csharp:no-async-void",
    name: "Async methods should return Task",
    languages: LANGUAGES,
    type: "bug",
    severity: "major",
    tags: ["async"],
    enabledByDefault: true,
    effortMinutes: 10,
    description: "Reports `async void` methods and local functions, except event handlers (two parameters, the second an `EventArgs`).",
    rationale:
      "Microsoft's async best-practices guide asks to avoid `async void`: exceptions thrown by such methods cannot be caught by the caller and are raised on the synchronization context, usually crashing the process, and callers cannot await completion. `async void` is meant only for event handlers.",
    noncompliantExample: "public async void SaveAsync() { await repository.SaveAsync(); }",
    compliantExample: "public async Task SaveAsync() { await repository.SaveAsync(); }",
    references: [REF.asyncBestPractices],
  },
  visit(node, ctx) {
    if (node.type !== "method_declaration" && node.type !== "local_function_statement") return;
    const returns = node.childForFieldName(node.type === "method_declaration" ? "returns" : "type");
    if (returns?.text === "void" && hasModifier(node, "async") && !isEventHandler(node)) {
      ctx.report(node.childForFieldName("name")!, "Return Task instead of void from this async method.");
    }
  },
};

const isAsyncCall = (node: Node | null | undefined): boolean => {
  if (!node || node.type !== "invocation_expression") return false;
  return /Async$/.test(invocation(node).name ?? "");
};

const noBlockingAsync: Rule = {
  definition: {
    id: "csharp:no-blocking-async",
    name: "Asynchronous calls should be awaited, not blocked on",
    languages: LANGUAGES,
    type: "bug",
    severity: "major",
    tags: ["async"],
    enabledByDefault: true,
    effortMinutes: 15,
    description: "Reports `.Result` and `.Wait()` applied directly to the call of a method whose name ends with `Async`.",
    rationale:
      "Microsoft's async best-practices guide (\"async all the way\") explains that blocking on a task with `Task.Wait` or `Task.Result` can deadlock when a synchronization context is present and wraps exceptions in `AggregateException`. Use `await` instead.",
    noncompliantExample: "var user = repository.FindAsync(id).Result;",
    compliantExample: "var user = await repository.FindAsync(id);",
    references: [REF.asyncBestPractices],
  },
  visit(node, ctx) {
    if (node.type === "member_access_expression" && simpleName(node.childForFieldName("name")) === "Result" && isAsyncCall(node.childForFieldName("expression"))) {
      ctx.report(node, "Do not block on an asynchronous call with .Result; await it.");
    } else if (node.type === "invocation_expression") {
      const { receiver, name } = invocation(node);
      if (name === "Wait" && args(node).length === 0 && isAsyncCall(receiver)) ctx.report(node, "Do not block on an asynchronous call with .Wait(); await it.");
    }
  },
};

const preserveStackOnRethrow: Rule = {
  definition: {
    id: "csharp:preserve-stack-on-rethrow",
    name: "Caught exceptions should be rethrown with throw;",
    languages: LANGUAGES,
    type: "bug",
    severity: "major",
    tags: ["error-handling"],
    enabledByDefault: true,
    effortMinutes: 5,
    description: "Reports `throw ex;` inside a `catch (Exception ex)` block, where `ex` is the caught exception.",
    rationale:
      "Microsoft rule CA2200 explains that rethrowing the caught exception object resets its stack trace to the current method, losing the location of the original failure. `throw;` rethrows while preserving the stack details.",
    noncompliantExample: "try\n{\n    File.Delete(path);\n}\ncatch (IOException ex)\n{\n    log.Error(ex);\n    throw ex;\n}",
    compliantExample: "try\n{\n    File.Delete(path);\n}\ncatch (IOException ex)\n{\n    log.Error(ex);\n    throw;\n}",
    references: [REF.ca2200],
  },
  visit(node, ctx) {
    if (node.type !== "throw_statement") return;
    const thrown = node.namedChildren[0];
    if (!thrown || thrown.type !== "identifier") return;
    for (let p = node.parent; p; p = p.parent) {
      if (p.type === "lambda_expression" || p.type === "anonymous_method_expression" || p.type === "local_function_statement") return;
      if (p.type === "catch_clause") {
        const declared = p.namedChildren.find((c) => c?.type === "catch_declaration")?.childForFieldName("name")?.text;
        if (declared === thrown.text) ctx.report(node, `Use "throw;" to rethrow "${declared}" without losing its stack trace.`);
        return;
      }
    }
  },
};

const NAN_REFERENCE = /^(System\.)?(double|float|Double|Single)\.NaN$/;

const noCompareNaN: Rule = {
  definition: {
    id: "csharp:no-compare-nan",
    name: "NaN should be tested with IsNaN",
    languages: LANGUAGES,
    type: "bug",
    severity: "major",
    tags: ["cwe-570", "cwe-571"],
    enabledByDefault: true,
    effortMinutes: 5,
    description: "Reports `==` and `!=` comparisons with `double.NaN` or `float.NaN`.",
    rationale:
      "The `Double.NaN` documentation states that `NaN` is not equal to any value, including itself, and that `IsNaN` must be used to test for it; Microsoft rule CA2242 reports the same mistake. The comparison is always false with `==` (CWE-570) and always true with `!=` (CWE-571).",
    noncompliantExample: "if (ratio == double.NaN) { return 0; }",
    compliantExample: "if (double.IsNaN(ratio)) { return 0; }",
    references: [REF.ca2242, REF.doubleNaN, REF.cwe570, REF.cwe571],
  },
  visit(node, ctx) {
    if (node.type !== "binary_expression") return;
    const op = node.childForFieldName("operator")?.type;
    if (op !== "==" && op !== "!=") return;
    const left = node.childForFieldName("left");
    const right = node.childForFieldName("right");
    if ([left, right].some((s) => s && NAN_REFERENCE.test(unwrap(s).text))) ctx.report(node, "Use double.IsNaN() / float.IsNaN(); comparisons with NaN are never true.");
  },
};

const noEmptyCatch: Rule = {
  definition: {
    id: "csharp:no-empty-catch",
    name: "Exceptions should not be silently ignored",
    languages: LANGUAGES,
    type: "bug",
    severity: "minor",
    tags: ["error-handling", "cwe-1069", "cwe-390"],
    enabledByDefault: true,
    effortMinutes: 10,
    description: "Reports `catch` blocks that contain neither statements nor a comment.",
    rationale:
      "An empty `catch` hides failures: the program continues in an unknown state and the cause is lost. MITRE describes this as Empty Exception Block (CWE-1069) and Detection of Error Condition Without Action (CWE-390).",
    exceptions: "A comment inside the block documenting why the error can be ignored marks the catch as intentional.",
    noncompliantExample: "try { cache.Set(key, value); }\ncatch (Exception) { }",
    compliantExample: "try { cache.Set(key, value); }\ncatch (CacheException ex)\n{\n    // The cache is optional.\n    logger.LogDebug(ex, \"Cache write failed\");\n}",
    references: [REF.cwe1069, REF.cwe390],
  },
  visit(node, ctx) {
    if (node.type !== "catch_clause") return;
    const body = node.childForFieldName("body");
    if (body && body.namedChildren.length === 0) ctx.report(node.children[0]!, "Handle this exception or explain in a comment why it is ignored.");
  },
};

const noUnsafeLockTarget: Rule = {
  definition: {
    id: "csharp:no-unsafe-lock-target",
    name: "Locks should use a private object",
    languages: LANGUAGES,
    type: "bug",
    severity: "major",
    tags: ["concurrency", "cwe-412"],
    enabledByDefault: true,
    effortMinutes: 15,
    description: "Reports `lock (this)`, `lock (typeof(...))` and locks on string literals.",
    rationale:
      "The C# `lock` statement documentation advises against locking on `this`, `Type` instances or string instances: other code can lock on the same publicly reachable object, causing deadlocks or contention. Use a dedicated private object. MITRE describes the weakness as Unrestricted Externally Accessible Lock (CWE-412).",
    noncompliantExample: "lock (this) { balance += amount; }",
    compliantExample: "private readonly object _sync = new();\nlock (_sync) { balance += amount; }",
    references: [REF.lockStatement, REF.cwe412],
  },
  visit(node, ctx) {
    if (node.type !== "lock_statement") return;
    const open = node.children.findIndex((c) => c?.type === "(");
    const target = open >= 0 ? node.children[open + 1] : null;
    if (!target) return;
    const t = unwrap(target);
    if (t.type === "this" || t.text === "this") ctx.report(t, "Do not lock on \"this\"; lock on a private readonly object.");
    else if (t.type === "typeof_expression") ctx.report(t, "Do not lock on a Type instance; lock on a private readonly object.");
    else if (STRING_LITERALS.has(t.type)) ctx.report(t, "Do not lock on a string; lock on a private readonly object.");
  },
};

// ---------------------------------------------------------------------------
// Maintainability
// ---------------------------------------------------------------------------

function nameNode(fn: Node): Node {
  return fn.childForFieldName("name") ?? fn.children[0]!;
}

const functionComplexity: Rule = {
  definition: {
    id: "csharp:function-complexity",
    name: "Methods should not be too complex",
    languages: LANGUAGES,
    type: "code-smell",
    severity: "major",
    tags: ["complexity", "cwe-1121"],
    enabledByDefault: true,
    effortMinutes: 10,
    description:
      "Reports methods, constructors, accessors, local functions and lambdas whose McCabe cyclomatic complexity exceeds `max` (default 10). Complexity is 1 plus one for each `if`, `?:`, loop, `case` label, non-discard switch-expression arm, `catch`, `&&`, `||`, `??` and `??=`.",
    rationale:
      "Cyclomatic complexity counts the linearly independent paths through a method and therefore the minimum number of tests needed to cover them (McCabe, 1976). NIST SP 500-235 recommends limiting it to 10 per module. MITRE lists excessive cyclomatic complexity as a maintainability weakness (CWE-1121); ISO/IEC 5055 (OMG ASCQM) flags values above 20.",
    params: [{ name: "max", description: "Highest accepted cyclomatic complexity per method.", type: "integer", default: 10 }],
    references: [REF.nist500235, REF.mccabe1976, REF.cwe1121, REF.omgAscqm],
  },
  check(ctx) {
    const max = Number(ctx.params["max"] ?? 10);
    for (const fn of ctx.functions) {
      const c = fn.metrics.complexity;
      if (c > max) ctx.report(nameNode(fn.node), `Cyclomatic complexity of "${fn.metrics.name}" is ${c} (max ${max}). Split it into smaller methods.`, { effortMinutes: 10 + (c - max) });
    }
  },
};

const tooManyParameters: Rule = {
  definition: {
    id: "csharp:too-many-parameters",
    name: "Methods should not have too many parameters",
    languages: LANGUAGES,
    type: "code-smell",
    severity: "major",
    tags: ["design", "cwe-1064"],
    enabledByDefault: true,
    effortMinutes: 20,
    description: "Reports methods, constructors, local functions and lambdas declaring more than `max` parameters (default 7).",
    rationale:
      "Long parameter lists make calls hard to read and easy to get wrong, and usually indicate a method with too many responsibilities. MITRE lists them as a weakness (CWE-1064) and ISO/IEC 5055 (OMG ASCQM) uses 7 parameters as the threshold.",
    params: [{ name: "max", description: "Highest accepted number of parameters.", type: "integer", default: 7 }],
    references: [REF.cwe1064, REF.omgAscqm],
  },
  check(ctx) {
    const max = Number(ctx.params["max"] ?? 7);
    for (const fn of ctx.functions) {
      if (fn.metrics.parameters > max) ctx.report(nameNode(fn.node), `"${fn.metrics.name}" has ${fn.metrics.parameters} parameters (max ${max}).`);
    }
  },
};

const fileTooLong: Rule = {
  definition: {
    id: "csharp:file-too-long",
    name: "Files should not have too many lines of code",
    languages: LANGUAGES,
    type: "code-smell",
    severity: "major",
    tags: ["size", "cwe-1080"],
    enabledByDefault: true,
    effortMinutes: 60,
    description: "Reports files with more than `max` non-comment lines of code (default 1000).",
    rationale:
      "Very large files tend to mix several responsibilities and are harder to understand, review and change. MITRE lists them as a weakness (CWE-1080) and ISO/IEC 5055 (OMG ASCQM) uses 1000 lines of code per file as the threshold.",
    params: [{ name: "max", description: "Highest accepted number of lines of code.", type: "integer", default: 1000 }],
    references: [REF.cwe1080, REF.omgAscqm],
  },
  check(ctx) {
    const max = Number(ctx.params["max"] ?? 1000);
    if (ctx.measures.ncloc > max) {
      ctx.report({ startLine: 1, startColumn: 1, endLine: 1, endColumn: Math.max(2, ctx.lines.lineText(1).length + 1) }, `This file has ${ctx.measures.ncloc} lines of code (max ${max}). Split it.`);
    }
  },
};

const todoComment: Rule = {
  definition: {
    id: "csharp:todo-comment",
    name: "Task markers in comments should be tracked",
    languages: LANGUAGES,
    type: "code-smell",
    severity: "info",
    tags: ["cwe-546"],
    enabledByDefault: true,
    effortMinutes: 0,
    description: "Reports comments containing `TODO`, `FIXME`, `XXX` or `HACK`.",
    rationale:
      "Such markers flag known gaps or defects that were left in the code. MITRE classifies them as Suspicious Comment (CWE-546): they point to unfinished work that should be tracked and resolved rather than forgotten.",
    references: [REF.cwe546],
  },
  check(ctx) {
    for (const comment of ctx.comments) {
      const match = TASK_MARKER.exec(comment.text);
      if (!match) continue;
      const before = comment.text.slice(0, match.index);
      const line = comment.startLine + (before.match(/\n/g)?.length ?? 0);
      const column = (line === comment.startLine ? comment.node.startPosition.column : 0) + (before.length - before.lastIndexOf("\n") - 1) + 1;
      ctx.report({ startLine: line, startColumn: column, endLine: line, endColumn: column + match[0].length }, `Complete the task associated with this "${match[0]}" comment.`);
    }
  },
};

const CODE_HINT = /[;{}]|=>/;
const CODE_NODES = new Set([
  "invocation_expression",
  "assignment_expression",
  "local_declaration_statement",
  "return_statement",
  "if_statement",
  "for_statement",
  "foreach_statement",
  "while_statement",
  "throw_statement",
  "using_statement",
  "object_creation_expression",
  "await_expression",
  "method_declaration",
  "field_declaration",
  "property_declaration",
]);

function parsesAsCode(parser: Parser, text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 3 || !CODE_HINT.test(trimmed)) return false;
  for (const wrapped of [`class __Q { void __M() { ${trimmed}\n} }`, `class __Q { ${trimmed}\n}`]) {
    const tree = parser.parse(wrapped);
    if (!tree) continue;
    try {
      if (tree.rootNode.hasError) continue;
      let found = false;
      walk(tree.rootNode, (n) => {
        if (found) return false;
        if (CODE_NODES.has(n.type) && !(n.type === "method_declaration" && n.childForFieldName("name")?.text === "__M")) found = true;
        return !found;
      });
      if (found) return true;
    } finally {
      tree.delete();
    }
  }
  return false;
}

const commentedOutCode: Rule = {
  definition: {
    id: "csharp:commented-out-code",
    name: "Commented-out code should be removed",
    languages: LANGUAGES,
    type: "code-smell",
    severity: "minor",
    tags: ["unused", "cwe-1085"],
    enabledByDefault: true,
    effortMinutes: 5,
    description: "Reports comment blocks whose content parses as C# statements or members. XML documentation comments (`///`) are ignored.",
    rationale:
      "Commented-out code distracts readers, gets out of date and is not compiled or tested; version control already keeps old versions. MITRE lists an excessive volume of commented-out code as a maintainability weakness (CWE-1085) and ISO/IEC 5055 (OMG ASCQM) measures it.",
    noncompliantExample: "// var total = order.Lines.Sum(l => l.Price);\n// return total;",
    compliantExample: "// Totals include VAT since 2024 (see ADR-12).",
    references: [REF.cwe1085, REF.omgAscqm],
  },
  check(ctx) {
    const blocks: { first: Comment; last: Comment; text: string }[] = [];
    for (const c of ctx.comments) {
      if (c.text.startsWith("///")) continue;
      if (c.text.startsWith("/*")) {
        blocks.push({ first: c, last: c, text: c.text.slice(2, -2).replace(/^\s*\*/gm, "") });
        continue;
      }
      const prev = blocks[blocks.length - 1];
      if (prev && prev.last.text.startsWith("//") && prev.last.endLine === c.startLine - 1) {
        prev.last = c;
        prev.text += "\n" + c.text.slice(2);
      } else {
        blocks.push({ first: c, last: c, text: c.text.slice(2) });
      }
    }
    for (const block of blocks) {
      if (parsesAsCode(ctx.parser, block.text)) {
        const start = rangeOf(block.first.node);
        const end = rangeOf(block.last.node);
        ctx.report({ startLine: start.startLine, startColumn: start.startColumn, endLine: end.endLine, endColumn: end.endColumn }, "Remove this commented-out code.");
      }
    }
  },
};

export const RULES: Rule[] = [
  noInsecureDeserializer,
  noWeakHash,
  noWeakCipher,
  noCertificateValidationBypass,
  noSqlInjection,
  dynamicSqlReview,
  noHardcodedCredentials,
  noInsecureXmlDtd,
  noAsyncVoid,
  noBlockingAsync,
  preserveStackOnRethrow,
  noCompareNaN,
  noEmptyCatch,
  noUnsafeLockTarget,
  functionComplexity,
  tooManyParameters,
  fileTooLong,
  todoComment,
  commentedOutCode,
];
