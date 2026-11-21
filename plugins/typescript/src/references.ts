import type { Reference } from "@qualis/plugin-api";

const cwe = (id: number, title: string, anchor = ""): Reference => ({
  publisher: "MITRE CWE",
  id: `CWE-${id}`,
  title,
  url: `https://cwe.mitre.org/data/definitions/${id}.html${anchor}`,
});

const mdn = (title: string, url: string): Reference => ({ publisher: "MDN Web Docs", title, url });
const node = (title: string, url: string): Reference => ({ publisher: "Node.js Documentation", title, url });
const owasp = (title: string, url: string): Reference => ({ publisher: "OWASP", title, url });
const tsDocs = (title: string, url: string): Reference => ({ publisher: "TypeScript Documentation", title, url });

/** Every source cited by the TypeScript/JavaScript rules. Each URL was checked against the official page. */
export const REF = {
  cwe95: cwe(95, "Improper Neutralization of Directives in Dynamically Evaluated Code ('Eval Injection')"),
  cwe78: cwe(78, "Improper Neutralization of Special Elements used in an OS Command ('OS Command Injection')"),
  cwe79: cwe(79, "Improper Neutralization of Input During Web Page Generation ('Cross-site Scripting')"),
  cwe89: cwe(89, "Improper Neutralization of Special Elements used in an SQL Command ('SQL Injection')"),
  cwe295: cwe(295, "Improper Certificate Validation"),
  cwe327: cwe(327, "Use of a Broken or Risky Cryptographic Algorithm"),
  cwe328: cwe(328, "Use of Weak Hash"),
  cwe798: cwe(798, "Use of Hard-coded Credentials", "#Potential_Mitigations"),
  cwe489: cwe(489, "Active Debug Code"),
  cwe481: cwe(481, "Assigning instead of Comparing"),
  cwe484: cwe(484, "Omitted Break Statement in Switch"),
  cwe561: cwe(561, "Dead Code"),
  cwe563: cwe(563, "Assignment to Variable without Use"),
  cwe570: cwe(570, "Expression is Always False"),
  cwe571: cwe(571, "Expression is Always True"),
  cwe584: cwe(584, "Return Inside Finally Block"),
  cwe755: cwe(755, "Improper Handling of Exceptional Conditions"),
  cwe1069: cwe(1069, "Empty Exception Block"),
  cwe390: cwe(390, "Detection of Error Condition Without Action"),
  cwe1121: cwe(1121, "Excessive McCabe Cyclomatic Complexity"),
  cwe1064: cwe(1064, "Invokable Control Element with Signature Containing an Excessive Number of Parameters"),
  cwe1080: cwe(1080, "Source Code File with Excessive Number of Lines of Code"),
  cwe546: cwe(546, "Suspicious Comment"),
  cwe1085: cwe(1085, "Invokable Control Element with Excessive Volume of Commented-out Code"),
  cwe1164: cwe(1164, "Irrelevant Code"),

  mdnEval: mdn("eval() - Never use direct eval()!", "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/eval#never_use_direct_eval!"),
  mdnSetTimeout: mdn("Window: setTimeout() method - Parameters", "https://developer.mozilla.org/en-US/docs/Web/API/Window/setTimeout#parameters"),
  mdnSetInterval: mdn("Window: setInterval() method - Parameters", "https://developer.mozilla.org/en-US/docs/Web/API/Window/setInterval#parameters"),
  mdnFunction: mdn("Function() constructor - Security considerations", "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Function/Function#security_considerations"),
  mdnInnerHtml: mdn("Element: innerHTML property - Security considerations", "https://developer.mozilla.org/en-US/docs/Web/API/Element/innerHTML#security_considerations"),
  mdnDocumentWrite: mdn("Document: write() method - Security considerations", "https://developer.mozilla.org/en-US/docs/Web/API/Document/write#security_considerations"),
  mdnInsertAdjacentHtml: mdn("Element: insertAdjacentHTML() method - Security considerations", "https://developer.mozilla.org/en-US/docs/Web/API/Element/insertAdjacentHTML#security_considerations"),
  mdnNaN: mdn("NaN - Testing against NaN", "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/NaN#testing_against_nan"),
  mdnTypeof: mdn("typeof - Description", "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/typeof#description"),
  mdnFinally: mdn("try...catch - The finally block", "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/try...catch#the_finally_block"),
  mdnSwitch: mdn("switch - Breaking and fall-through", "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/switch#breaking_and_fall-through"),
  mdnEquality: mdn("Equality comparisons and sameness - Strict equality using ===", "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Equality_comparisons_and_sameness#strict_equality_using"),
  mdnDuplicateKeys: mdn("Object initializer - Duplicate property names", "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Object_initializer#duplicate_property_names"),
  mdnDebugger: mdn("debugger", "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/debugger"),
  mdnPromises: mdn("Using promises - Chaining", "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Using_promises#chaining"),

  nodeExec: node("Child process - child_process.exec()", "https://nodejs.org/api/child_process.html#child_processexeccommand-options-callback"),
  nodeTlsConnect: node("TLS (SSL) - tls.connect(options[, callback])", "https://nodejs.org/api/tls.html#tlsconnectoptions-callback"),
  nodeTlsEnv: node("Command-line API - NODE_TLS_REJECT_UNAUTHORIZED", "https://nodejs.org/api/cli.html#node_tls_reject_unauthorizedvalue"),
  nodeUnhandledRejections: node("Command-line API - --unhandled-rejections=mode", "https://nodejs.org/api/cli.html#--unhandled-rejectionsmode"),
  nodeTest: node("Test runner - test([name][, options][, fn])", "https://nodejs.org/api/test.html#testname-options-fn"),
  nodeCreateHash: node("Crypto - crypto.createHash()", "https://nodejs.org/api/crypto.html#cryptocreatehashalgorithm-options"),
  nodeCreateCipheriv: node("Crypto - crypto.createCipheriv()", "https://nodejs.org/api/crypto.html#cryptocreatecipherivalgorithm-key-iv-options"),

  owaspSqli: owasp("SQL Injection Prevention Cheat Sheet - Prepared statements with parameterized queries", "https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html#defense-option-1-prepared-statements-with-parameterized-queries"),
  owaspXss: owasp("Cross Site Scripting Prevention Cheat Sheet - Safe sinks", "https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html#safe-sinks"),
  owaspDomXss: owasp("DOM based XSS Prevention Cheat Sheet - Avoid sending untrusted data into HTML rendering methods", "https://cheatsheetseries.owasp.org/cheatsheets/DOM_based_XSS_Prevention_Cheat_Sheet.html#guideline-4-avoid-sending-untrusted-data-into-html-rendering-methods"),
  owaspCommandInjection: owasp("OS Command Injection Defense Cheat Sheet - Primary defenses", "https://cheatsheetseries.owasp.org/cheatsheets/OS_Command_Injection_Defense_Cheat_Sheet.html#primary-defenses"),
  owaspCryptoStorage: owasp("Cryptographic Storage Cheat Sheet - Cipher modes", "https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html#cipher-modes"),
  owaspHardcodedPassword: owasp("Use of hard-coded password", "https://community.owasp.org/vulnerabilities/Use_of_hard-coded_password"),

  nist800131a: { publisher: "NIST", id: "SP 800-131A Rev. 2", title: "Transitioning the Use of Cryptographic Algorithms and Key Lengths", url: "https://csrc.nist.gov/pubs/sp/800/131/a/r2/final" } satisfies Reference,
  nistHashPolicy: { publisher: "NIST", title: "NIST Policy on Hash Functions", url: "https://csrc.nist.gov/projects/hash-functions/nist-policy-on-hash-functions" } satisfies Reference,
  nist500235: { publisher: "NIST", id: "SP 500-235", title: "Structured Testing: A Testing Methodology Using the Cyclomatic Complexity Metric (section 2.5)", url: "https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication500-235.pdf" } satisfies Reference,
  mccabe1976: { publisher: "IEEE", title: "T. J. McCabe, A Complexity Measure, IEEE Transactions on Software Engineering, 1976", url: "https://doi.org/10.1109/TSE.1976.233837" } satisfies Reference,
  omgAscqm: { publisher: "OMG", id: "ASCQM 1.1 / ISO/IEC 5055", title: "Automated Source Code Quality Measures", url: "https://www.omg.org/spec/ASCQM/1.1/PDF" } satisfies Reference,
  rfc6151: { publisher: "IETF", id: "RFC 6151", title: "Updated Security Considerations for the MD5 Message-Digest and the HMAC-MD5 Algorithms", url: "https://www.rfc-editor.org/rfc/rfc6151.html#section-2" } satisfies Reference,
  rfc7465: { publisher: "IETF", id: "RFC 7465", title: "Prohibiting RC4 Cipher Suites", url: "https://www.rfc-editor.org/rfc/rfc7465.html" } satisfies Reference,

  tsNoFallthrough: tsDocs("TSConfig Reference - noFallthroughCasesInSwitch", "https://www.typescriptlang.org/tsconfig/#noFallthroughCasesInSwitch"),
  tsNoUnusedLocals: tsDocs("TSConfig Reference - noUnusedLocals", "https://www.typescriptlang.org/tsconfig/#noUnusedLocals"),
  tsAllowUnreachable: tsDocs("TSConfig Reference - allowUnreachableCode", "https://www.typescriptlang.org/tsconfig/#allowUnreachableCode"),
  tsDeprecated: tsDocs("JSDoc Reference - @deprecated", "https://www.typescriptlang.org/docs/handbook/jsdoc-supported-types.html#deprecated"),
} as const;
