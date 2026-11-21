import { CopyButton } from "./client";

const COMMANDS = `npx qualis analyze

# or as a project script
pnpm add -D qualis
# package.json → "scripts": { "analyze": "qualis analyze" }
pnpm analyze`;

/** How analyses get into a project folder: `qualis analyze` writes .qualis/report.json and .qualis/history/. */
export function AnalyzeSnippet() {
  return (
    <div className="code-block">
      <div className="code-head">
        <span>Terminal · in the project folder</span>
        <CopyButton text={COMMANDS} />
      </div>
      <pre>
        <span className="c"># writes .qualis/report.json and keeps the previous ones in .qualis/history/</span>
        {"\n"}npx qualis analyze{"\n\n"}
        <span className="c"># or as a project script</span>
        {"\n"}pnpm add -D qualis{"\n"}
        <span className="c"># package.json → &quot;scripts&quot;: {"{"} &quot;analyze&quot;: &quot;qualis analyze&quot; {"}"}</span>
        {"\n"}pnpm analyze
      </pre>
    </div>
  );
}
