import type { Report, Severity } from "@qualis/schema";

const LEVEL: Record<Severity, "error" | "warning" | "note"> = {
  blocker: "error",
  critical: "error",
  major: "warning",
  minor: "note",
  info: "note",
};

/** Converts a report into SARIF 2.1.0 (issues and rules only). */
export function toSarif(report: Report): object {
  const rules = report.rules.map((rule) => ({
    id: rule.id,
    name: rule.name,
    shortDescription: { text: rule.name },
    fullDescription: { text: rule.description },
    help: {
      text: `${rule.rationale}\n\nReferences:\n${rule.references.map((r) => `- ${r.title}: ${r.url}`).join("\n")}`,
    },
    helpUri: rule.references[0]?.url,
    defaultConfiguration: { level: LEVEL[rule.severity] },
    properties: { tags: rule.tags, type: rule.type, severity: rule.severity, plugin: rule.plugin },
  }));
  const ruleIndex = new Map(rules.map((r, i) => [r.id, i]));
  return {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "Qualis",
            version: report.tool.version,
            rules,
          },
        },
        automationDetails: { id: `qualis/${report.project.key}/${report.analysis.id}` },
        ...(report.analysis.vcs?.revision && {
          versionControlProvenance: [
            {
              repositoryUri: ".",
              revisionId: report.analysis.vcs.revision,
              ...(report.analysis.vcs.branch && { branch: report.analysis.vcs.branch }),
            },
          ],
        }),
        results: report.issues.map((issue) => ({
          ruleId: issue.ruleId,
          ruleIndex: ruleIndex.get(issue.ruleId),
          level: LEVEL[issue.severity],
          message: { text: issue.message },
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: issue.path, uriBaseId: "%SRCROOT%" },
                region: issue.range,
              },
            },
          ],
          ...(issue.secondaryLocations?.length && {
            relatedLocations: issue.secondaryLocations.map((l, id) => ({
              id,
              message: { text: l.message ?? "" },
              physicalLocation: { artifactLocation: { uri: issue.path, uriBaseId: "%SRCROOT%" }, region: l.range },
            })),
          }),
          partialFingerprints: { "qualis/v1": issue.id },
          properties: { severity: issue.severity, type: issue.type, isNew: issue.isNew, effortMinutes: issue.effortMinutes },
        })),
      },
    ],
  };
}
