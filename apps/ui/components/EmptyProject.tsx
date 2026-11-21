import { FolderOpen, TriangleAlert } from "./icons";
import { AnalyzeSnippet } from "./AnalyzeSnippet";
import { ProjectHeader } from "./ProjectHeader";
import { Empty, Note } from "./ui";
import type { ProjectView } from "@/lib/store";

export function EmptyProject({ project }: { project: ProjectView }) {
  return (
    <>
      <ProjectHeader project={project} active="overview" />
      <div className="wrap">
        <div className="card">
          {project.folder ? (
            <Empty icon={FolderOpen} title="No analyses yet">
              Qualis reads <code>{project.folder}/.qualis</code> on every visit, and there is no valid <code>report.json</code> in it yet. Run <code>qualis analyze</code> in the project folder: this page shows
              the analysis as soon as it is written. You can also add a report.json with <b>Read analysis</b>.
            </Empty>
          ) : (
            <Empty icon={FolderOpen} title="No analyses">
              This project has no uploaded analyses left. Add one with <b>Read analysis</b>, or link the project folder from the Project menu.
            </Empty>
          )}
          <div className="mx-auto grid max-w-[720px] gap-3 px-5 pb-6">
            {project.diagnostics.length > 0 && (
              <Note warn icon={TriangleAlert}>
                {project.diagnostics.map((d) => (
                  <span key={d.file} className="block">
                    <code>{d.file}</code> — {d.message}
                  </span>
                ))}
              </Note>
            )}
            {project.folder && <AnalyzeSnippet />}
          </div>
        </div>
      </div>
    </>
  );
}
