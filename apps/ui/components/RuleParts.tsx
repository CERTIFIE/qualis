import { ExternalLink } from "@/components/icons";
import type { Reference, RuleDefinition } from "@qualis/schema";
import { CopyButton } from "./client";
import { cx } from "./ui";

export function CodeExamples({ rule, stacked }: { rule: Pick<RuleDefinition, "noncompliantExample" | "compliantExample">; stacked?: boolean }) {
  const block = (label: string, tone: "bad" | "good", code: string) => (
    <div className="code-block">
      <div className="code-head">
        <span className={tone}>{label}</span>
        <CopyButton text={code} />
      </div>
      <pre>{code}</pre>
    </div>
  );
  return (
    <div className={cx("grid gap-3", !stacked && "md:grid-cols-2")}>
      {rule.noncompliantExample && block("Noncompliant", "bad", rule.noncompliantExample)}
      {rule.compliantExample && block("Compliant", "good", rule.compliantExample)}
    </div>
  );
}

export function References({ references }: { references: Reference[] }) {
  return (
    <ul className="refs">
      {references.map((r) => (
        <li key={r.url}>
          <a href={r.url} target="_blank" rel="noreferrer">
            <span className="pub">{r.publisher}</span>
            <span className="t">
              {r.title}
              {r.id && <span className="rid">{r.id}</span>}
            </span>
            <ExternalLink aria-hidden strokeWidth={1.75} />
          </a>
        </li>
      ))}
    </ul>
  );
}
