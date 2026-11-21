---
title: Sources
description: Every authoritative source cited by the rules, the metrics and the formats, and how sources are chosen.
---
A rule exists in Qualis only if official documentation describes the problem it detects. This page lists all the sources: {{source-count}} pages cited by the rules, plus the references behind the metrics and file formats.

## How sources are chosen

- **Authorities first.** Weakness catalogs and standards (MITRE CWE, NIST, IETF RFCs, ISO/IEC, OMG), security guidance (OWASP), and the documentation of the platform the rule applies to (MDN for JavaScript, Node.js, Microsoft Learn for .NET, the TypeScript handbook).
- **Exact claims.** Each reference points to the page, and when possible the section, that supports the rule. Every link was checked against the published page; when a page did not support a claim, the rule was reworded or another source was used.
- **Own words.** Rule pages summarise the sources; they do not copy them.
- **Wrapped analyzers.** Rules of the ESLint and Roslyn packs are run unchanged; each links the official page of its maintainers (eslint.org, typescript-eslint.io, Microsoft Learn), and security and reliability rules also cite the matching CWE where one applies. Their default profiles are the maintainers' own: ESLint's and typescript-eslint's recommended configurations and Microsoft's Recommended analysis mode.
- **Thresholds are labelled.** When a number comes from a standard (10 for cyclomatic complexity in NIST SP 500-235, 7 parameters and 1000 lines per file in ISO/IEC 5055) the rule says so; when it is a convention (the default coverage target of the quality gate, the development cost per line), the documentation says that too.

{{sources}}
