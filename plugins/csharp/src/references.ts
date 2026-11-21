import type { Reference } from "@qualis/plugin-api";

const cwe = (id: number, title: string, anchor = ""): Reference => ({
  publisher: "MITRE CWE",
  id: `CWE-${id}`,
  title,
  url: `https://cwe.mitre.org/data/definitions/${id}.html${anchor}`,
});

const learn = (id: string | undefined, title: string, url: string): Reference => ({
  publisher: "Microsoft Learn",
  ...(id !== undefined && { id }),
  title,
  url,
});

const caRule = (id: string, title: string): Reference =>
  learn(id, `${id}: ${title}`, `https://learn.microsoft.com/en-us/dotnet/fundamentals/code-analysis/quality-rules/${id.toLowerCase()}`);

/** Every source cited by the C# rules. Each URL was checked against the official page. */
export const REF = {
  ca5350: caRule("CA5350", "Do Not Use Weak Cryptographic Algorithms"),
  ca5351: caRule("CA5351", "Do Not Use Broken Cryptographic Algorithms"),
  ca5358: caRule("CA5358", "Do Not Use Unsafe Cipher Modes"),
  ca5359: caRule("CA5359", "Do not disable certificate validation"),
  ca2100: caRule("CA2100", "Review SQL queries for security vulnerabilities"),
  ca2200: caRule("CA2200", "Rethrow to preserve stack details"),
  ca2242: caRule("CA2242", "Test for NaN correctly"),
  ca3075: caRule("CA3075", "Insecure DTD Processing"),
  efSqlQueries: learn(undefined, "SQL Queries - EF Core", "https://learn.microsoft.com/en-us/ef/core/querying/sql-queries"),
  binaryFormatter: learn(undefined, "Deserialization risks in use of BinaryFormatter and related types", "https://learn.microsoft.com/en-us/dotnet/standard/serialization/binaryformatter-security-guide"),
  lockStatement: learn(undefined, "The lock statement - synchronize access to shared resources", "https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/statements/lock"),
  asyncBestPractices: learn(undefined, "Async/Await - Best Practices in Asynchronous Programming", "https://learn.microsoft.com/en-us/archive/msdn-magazine/2013/march/async-await-best-practices-in-asynchronous-programming"),
  doubleNaN: learn(undefined, "Double.NaN Field", "https://learn.microsoft.com/en-us/dotnet/api/system.double.nan"),

  owaspSqli: { publisher: "OWASP", title: "SQL Injection Prevention Cheat Sheet - Prepared statements with parameterized queries", url: "https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html#defense-option-1-prepared-statements-with-parameterized-queries" } satisfies Reference,
  owaspHardcodedPassword: { publisher: "OWASP", title: "Use of hard-coded password", url: "https://community.owasp.org/vulnerabilities/Use_of_hard-coded_password" } satisfies Reference,
  nist800131a: { publisher: "NIST", id: "SP 800-131A Rev. 2", title: "Transitioning the Use of Cryptographic Algorithms and Key Lengths", url: "https://csrc.nist.gov/pubs/sp/800/131/a/r2/final" } satisfies Reference,
  nist500235: { publisher: "NIST", id: "SP 500-235", title: "Structured Testing: A Testing Methodology Using the Cyclomatic Complexity Metric (section 2.5)", url: "https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication500-235.pdf" } satisfies Reference,
  mccabe1976: { publisher: "IEEE", title: "T. J. McCabe, A Complexity Measure, IEEE Transactions on Software Engineering, 1976", url: "https://doi.org/10.1109/TSE.1976.233837" } satisfies Reference,
  omgAscqm: { publisher: "OMG", id: "ASCQM 1.1 / ISO/IEC 5055", title: "Automated Source Code Quality Measures", url: "https://www.omg.org/spec/ASCQM/1.1/PDF" } satisfies Reference,

  cwe89: cwe(89, "Improper Neutralization of Special Elements used in an SQL Command ('SQL Injection')"),
  cwe295: cwe(295, "Improper Certificate Validation"),
  cwe327: cwe(327, "Use of a Broken or Risky Cryptographic Algorithm"),
  cwe328: cwe(328, "Use of Weak Hash"),
  cwe502: cwe(502, "Deserialization of Untrusted Data"),
  cwe611: cwe(611, "Improper Restriction of XML External Entity Reference"),
  cwe798: cwe(798, "Use of Hard-coded Credentials", "#Potential_Mitigations"),
  cwe570: cwe(570, "Expression is Always False"),
  cwe571: cwe(571, "Expression is Always True"),
  cwe412: cwe(412, "Unrestricted Externally Accessible Lock"),
  cwe1069: cwe(1069, "Empty Exception Block"),
  cwe390: cwe(390, "Detection of Error Condition Without Action"),
  cwe1121: cwe(1121, "Excessive McCabe Cyclomatic Complexity"),
  cwe1064: cwe(1064, "Invokable Control Element with Signature Containing an Excessive Number of Parameters"),
  cwe1080: cwe(1080, "Source Code File with Excessive Number of Lines of Code"),
  cwe546: cwe(546, "Suspicious Comment"),
  cwe1085: cwe(1085, "Invokable Control Element with Excessive Volume of Commented-out Code"),
} as const;
