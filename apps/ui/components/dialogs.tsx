"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "./Dialog";
import { Check, ChevronLeft, ChevronRight, FileUpload, Folder, Folders, GitBranch, Info, TriangleAlert } from "./icons";
import type { FolderStatus, ImportResult, UploadPreview } from "@/lib/store";
import { fDate } from "@/lib/format";

// "Import project" and "Read analysis": the two ways a project gets into Qualis, available from the header,
// the projects page and the project menu.

interface DialogsApi {
  openImport: () => void;
  openRead: () => void;
  notify: (message: string) => void;
}

const DialogsContext = createContext<DialogsApi | null>(null);

export function useDialogs(): DialogsApi {
  const api = useContext(DialogsContext);
  if (!api) throw new Error("useDialogs outside DialogsProvider");
  return api;
}

export function DialogsProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<"import" | "read" | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const notify = useCallback((message: string) => {
    setToast(message);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 3200);
  }, []);
  const api = useMemo<DialogsApi>(() => ({ openImport: () => setOpen("import"), openRead: () => setOpen("read"), notify }), [notify]);
  return (
    <DialogsContext.Provider value={api}>
      {children}
      <ImportDialog open={open === "import"} onClose={() => setOpen(null)} onSwitch={() => setOpen("read")} />
      <ReadDialog open={open === "read"} onClose={() => setOpen(null)} onSwitch={() => setOpen("import")} />
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </DialogsContext.Provider>
  );
}

export function ImportButton({ primary }: { primary?: boolean }) {
  const { openImport } = useDialogs();
  return (
    <button type="button" className={`btn${primary ? " primary" : ""}`} onClick={openImport} aria-haspopup="dialog" aria-label="Import project">
      <Folder aria-hidden />
      <span>Import project</span>
    </button>
  );
}

export function ReadButton({ primary }: { primary?: boolean }) {
  const { openRead } = useDialogs();
  return (
    <button type="button" className={`btn${primary ? " primary" : ""}`} onClick={openRead} aria-haspopup="dialog" aria-label="Read analysis">
      <FileUpload aria-hidden />
      <span>Read analysis</span>
    </button>
  );
}

// ------------------------------------------------------------------------------------------- Import project

interface BrowseEntry {
  name: string;
  path: string;
  qualis: { analyses: number; hasReport: boolean; historyFiles: number } | null;
  hasChildren: boolean;
  /** Key of the project already reading this folder. */
  imported: string | null;
  /** Name of the solution imported from this folder. */
  solution: string | null;
  /** Project folders below it (for folders without their own .qualis). */
  inner: number;
}

interface Discovered {
  path: string;
  /** Relative to the browsed folder; "" for the folder itself. */
  rel: string;
  analyses: number;
  name: string | null;
  imported: { key: string; name: string } | null;
  solution: { id: string; name: string } | null;
}

type BrowseResponse =
  | {
      root: string;
      path: string;
      parent: string | null;
      crumbs: Array<{ name: string; path: string }>;
      entries: BrowseEntry[];
      status: FolderStatus;
      solution: { id: string; name: string; projects: string[] } | null;
      discovered: Discovered[];
      error?: undefined;
    }
  | { root: string; error: "outside" | "not-found" | "not-a-folder" | "root-missing" };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function ImportDialog({ open, onClose, onSwitch }: { open: boolean; onClose: () => void; onSwitch: () => void }) {
  const router = useRouter();
  const { notify } = useDialogs();
  const [path, setPath] = useState<string>("");
  const [data, setData] = useState<BrowseResponse | null>(null);
  const [current, setCurrent] = useState<Extract<BrowseResponse, { entries: BrowseEntry[] }> | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [solutionName, setSolutionName] = useState("");

  useEffect(() => {
    if (open) {
      setPath("");
      setFailure(null);
    }
  }, [open]);

  // A new folder: every project found below it is picked, the solution is named after the folder.
  useEffect(() => {
    if (!current) return;
    setPicked(new Set(current.discovered.map((d) => d.path)));
    setSolutionName(current.path.split(/[\\/]/).pop() ?? "");
  }, [current]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void fetch(`/api/browse?path=${encodeURIComponent(path)}`)
      .then((r) => r.json() as Promise<BrowseResponse>)
      .then((res) => {
        if (cancelled) return;
        setData(res);
        if (!res.error) {
          setCurrent(res);
          setInput(res.path);
        }
      })
      .catch(() => !cancelled && setFailure("The server could not list this folder."));
    return () => {
      cancelled = true;
    };
  }, [open, path]);

  const go = (p: string) => {
    setFailure(null);
    setPath(p);
  };
  const shown = current;
  const error = data?.error;
  const status = shown?.status;
  const name = shown ? shown.path.split(/[\\/]/).pop() : "";

  const doImport = async () => {
    if (!shown) return;
    setBusy(true);
    const res = await fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: shown.path }) });
    const result = (await res.json()) as ImportResult | { status: string };
    setBusy(false);
    if ("key" in result && (result.status === "imported" || result.status === "linked" || result.status === "already")) {
      onClose();
      notify(result.status === "linked" ? `Linked ${shown.path} to ${result.name}.` : result.status === "already" ? `${result.name} is already imported.` : `Imported ${result.name}.`);
      router.push(`/p/${encodeURIComponent(result.key)}`);
      router.refresh();
    } else {
      setFailure(result.status === "no-qualis" ? "No .qualis folder here." : result.status === "conflict" ? "Another folder already uses this project key." : "The folder could not be imported.");
    }
  };

  const subProjects = shown && !error ? shown.discovered.filter((d) => d.rel !== "") : [];
  const offerSolution = !!shown && !error && !failure && !shown.solution && !status?.imported && subProjects.length > 0;

  const doImportSolution = async () => {
    if (!shown) return;
    setBusy(true);
    const res = await fetch("/api/solutions/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: shown.path, name: solutionName, include: [...picked] }) });
    const result = (await res.json()) as { status: string; id?: string; name?: string; projects?: number; skipped?: Array<{ path: string; reason: string }> };
    setBusy(false);
    if (result.id) {
      onClose();
      const skipped = result.skipped?.length ? ` ${plural(result.skipped.length, "folder was", "folders were")} skipped (${result.skipped.map((x) => x.reason).join("; ")}).` : "";
      notify(`Imported ${result.name}: a solution with ${plural(result.projects ?? 0, "project", "projects")}.${skipped}`);
      router.push(`/s/${encodeURIComponent(result.id)}`);
      router.refresh();
    } else {
      setFailure(result.status === "root" ? "The browse root cannot be imported as a solution: choose a folder inside it." : "No project folders were found here.");
    }
  };

  let note: ReactNode = null;
  if (error === "outside") note = <Banner warn>Outside the browse root. Only folders under <code>{data?.root}</code> can be imported.</Banner>;
  else if (error === "not-found" || error === "not-a-folder") note = <Banner warn><b>Folder not found:</b> <code>{path}</code></Banner>;
  else if (error === "root-missing") note = <Banner warn>The browse root <code>{data?.root}</code> does not exist. Set <code>QUALIS_BROWSE_ROOT</code> or mount a folder there.</Banner>;
  else if (failure) note = <Banner warn>{failure}</Banner>;
  else if (shown?.solution)
    note = (
      <Banner>
        Already imported as the solution <b>{shown.solution.name}</b> ({plural(shown.solution.projects.length, "project", "projects")}). Use <b>Look for new projects</b> in its menu to add projects that appeared here.
      </Banner>
    );
  else if (offerSolution)
    note = (
      <>
        {status?.qualis && status.latest && (
          <Banner ok>
            <b>.qualis found</b> · {plural(status.qualis.analyses, "analysis", "analyses")} of <b>{status.latest.name}</b>. The folder also contains other projects: import only this one, or all of them as a solution.
          </Banner>
        )}
        <div className="disc">
          <div className="disc-hd">
            <b>{plural(subProjects.length, "project", "projects")} in sub-folders</b>
            <span className="text-faint">up to 4 levels · node_modules, bin, obj, .git skipped</span>
          </div>
          <label className="disc-name">
            <span>Solution name</span>
            <input className="fsearch" value={solutionName} onChange={(e) => setSolutionName(e.target.value)} spellCheck={false} autoComplete="off" />
          </label>
          <div className="flist" role="group" aria-label="Projects to import">
            {shown!.discovered.map((d) => (
              <label key={d.path} className="frow pick">
                <input
                  type="checkbox"
                  checked={picked.has(d.path)}
                  onChange={(e) => {
                    const next = new Set(picked);
                    if (e.target.checked) next.add(d.path);
                    else next.delete(d.path);
                    setPicked(next);
                  }}
                />
                <Folder aria-hidden />
                <span className="nm">{d.rel || "(this folder)"}</span>
                {d.name && <span className="pick-name">{d.name}</span>}
                {d.solution ? (
                  <span className="badge" title="A project belongs to one solution">
                    in {d.solution.name} · moves
                  </span>
                ) : d.imported ? (
                  <span className="badge b-new">Imported</span>
                ) : (
                  <span className="badge b-ok">{plural(d.analyses, "analysis", "analyses")}</span>
                )}
              </label>
            ))}
          </div>
        </div>
      </>
    );
  else if (status?.imported) note = <Banner>Already imported as <b>{status.imported.name}</b>. Qualis re-reads its <code>.qualis</code> folder on every visit.</Banner>;
  else if (status?.qualis && status.conflict) note = <Banner warn>A project with the key <code>{status.conflict.key}</code> already reads <code>{status.conflict.folder}</code>. Remove it first to import this folder.</Banner>;
  else if (status?.qualis && status.linkTo)
    note = (
      <Banner ok>
        <b>.qualis found</b> · {plural(status.qualis.analyses, "analysis", "analyses")} of <b>{status.latest?.name ?? status.linkTo.name}</b> (<code>{status.linkTo.key}</code>). A project with this key already exists with{" "}
        {plural(status.linkTo.uploads, "uploaded analysis", "uploaded analyses")}: the folder is linked to it and the history becomes the union, deduplicated by analysis id.
      </Banner>
    );
  else if (status?.qualis && status.latest)
    note = (
      <Banner ok>
        <b>.qualis found</b> · {plural(status.qualis.analyses, "analysis", "analyses")} of <b>{status.latest.name}</b> (<code>{status.latest.key}</code>), latest {fDate(status.latest.finishedAt)}.
      </Banner>
    );
  else if (status?.qualis)
    note = (
      <Banner>
        <b>.qualis found, but without a valid report.</b> You can import the folder now; analyses appear as soon as <code>qualis analyze</code> writes <code>.qualis/report.json</code>.
      </Banner>
    );
  else if (shown)
    note = (
      <Banner warn>
        <b>No .qualis folder here.</b> Choose a project folder{shown.entries.length ? " below" : ""}, or run <code>qualis analyze</code> in this folder first.
      </Banner>
    );

  const canImport = !!shown && !error && !failure && !!status?.qualis && !status.imported && !status.conflict;
  const primary = shown?.solution ? (
    <button
      type="button"
      className="btn primary"
      onClick={() => {
        onClose();
        router.push(`/s/${encodeURIComponent(shown.solution!.id)}`);
      }}
    >
      Open solution
    </button>
  ) : offerSolution ? (
    <>
      {canImport && (
        <button type="button" className="btn" disabled={busy} onClick={() => void doImport()}>
          Import only this project
        </button>
      )}
      <button type="button" className="btn primary" disabled={busy || !picked.size} onClick={() => void doImportSolution()}>
        {busy ? "Importing…" : `Import as solution (${plural(picked.size, "project", "projects")})`}
      </button>
    </>
  ) : status?.imported ? (
    <button
      type="button"
      className="btn primary"
      onClick={() => {
        onClose();
        router.push(`/p/${encodeURIComponent(status.imported!.key)}`);
      }}
    >
      Open project
    </button>
  ) : (
    <button type="button" className="btn primary" disabled={!canImport || busy} onClick={() => void doImport()}>
      {busy ? "Importing…" : status?.linkTo ? `Link folder to ${status.linkTo.name}` : `Import ${name || "folder"}`}
    </button>
  );

  return (
    <Dialog
      open={open}
      onClose={onClose}
      wide
      eyebrow="Import project"
      title="Choose the project folder"
      description={
        <>
          Qualis reads the analyses in its <code className="mono">.qualis</code> folder and keeps the project: new analyses appear by themselves.
        </>
      }
      footer={
        <>
          <span className="mono mr-auto min-w-0 truncate text-[11.5px] text-faint">{shown?.path ?? ""}</span>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          {primary}
        </>
      }
    >
      <div className="imp">
        <div className="text-[12.5px] text-faint">
          The server reads its own disk, starting from <code className="mono">{data?.root ?? "…"}</code> (<code className="mono">QUALIS_BROWSE_ROOT</code>). In Docker, mount your projects there, e.g.{" "}
          <code className="mono">-v ~/workspace:/workspace:ro</code>.
        </div>
        <form
          className="pathbar"
          onSubmit={(e) => {
            e.preventDefault();
            go(input);
          }}
        >
          <input className="fsearch" value={input} onChange={(e) => setInput(e.target.value)} aria-label="Folder path" spellCheck={false} autoComplete="off" />
          <button type="submit" className="btn sm">
            Go
          </button>
        </form>
        {shown && (
          <nav className="crumbs" aria-label="Folder">
            {shown.crumbs.map((c, i) =>
              i === shown.crumbs.length - 1 ? (
                <b key={c.path} className="font-medium text-fg">
                  {c.name}
                </b>
              ) : (
                <span key={c.path} className="contents">
                  <a
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      go(c.path);
                    }}
                  >
                    {c.name}
                  </a>
                  <span className="sep">/</span>
                </span>
              ),
            )}
          </nav>
        )}
        <div className="flist" role="list">
          {shown?.parent && (
            <button type="button" className="frow up" onClick={() => go(shown.parent!)}>
              <ChevronLeft aria-hidden />
              <span className="nm">..</span>
            </button>
          )}
          {shown?.entries.map((e) => (
            <button key={e.path} type="button" className="frow" onClick={() => go(e.path)}>
              <Folder aria-hidden />
              <span className="nm">{e.name}</span>
              {e.solution ? (
                <span className="badge b-new">
                  <Folders aria-hidden />
                  Solution
                </span>
              ) : e.imported ? (
                <span className="badge b-new">Imported</span>
              ) : !e.qualis && e.inner > 0 ? (
                <span className="badge">{plural(e.inner, "project", "projects")} inside</span>
              ) : e.qualis ? (
                e.qualis.analyses ? (
                  <span className="badge b-ok">
                    <Check aria-hidden />
                    .qualis · {plural(e.qualis.analyses, "analysis", "analyses")}
                  </span>
                ) : (
                  <span className="badge">.qualis · empty</span>
                )
              ) : null}
              {e.hasChildren && <ChevronRight aria-hidden className="text-faint" />}
            </button>
          ))}
          {shown && !shown.entries.length && <div className="p-3.5 text-center text-[13px] text-faint">No sub-folders</div>}
          {!shown && <div className="p-3.5 text-center text-[13px] text-faint">Loading…</div>}
        </div>
        {note}
        <div className="text-[12.5px] text-faint">
          Only have a report.json?{" "}
          <a
            href="#"
            className="link"
            onClick={(e) => {
              e.preventDefault();
              onSwitch();
            }}
          >
            Read analysis
          </a>{" "}
          adds it to Qualis.
        </div>
      </div>
    </Dialog>
  );
}

function Banner({ children, warn, ok }: { children: ReactNode; warn?: boolean; ok?: boolean }) {
  const Icon = warn ? TriangleAlert : ok ? Check : Info;
  return (
    <div className={`note${warn ? " warn" : ""}`} role={warn ? "alert" : undefined}>
      <Icon aria-hidden />
      <span>{children}</span>
    </div>
  );
}

// ------------------------------------------------------------------------------------------- Read analysis

function ReadDialog({ open, onClose, onSwitch }: { open: boolean; onClose: () => void; onSwitch: () => void }) {
  const router = useRouter();
  const { notify } = useDialogs();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [step, setStep] = useState<"pick" | "checking" | "result" | "saving">("pick");
  const [preview, setPreview] = useState<UploadPreview | null>(null);
  const [over, setOver] = useState(false);

  useEffect(() => {
    if (open) {
      setFile(null);
      setStep("pick");
      setPreview(null);
    }
  }, [open]);

  const check = async (f: File | undefined) => {
    if (!f) return;
    setFile(f);
    setStep("checking");
    try {
      const res = await fetch("/api/uploads?dryRun=1", { method: "POST", headers: { "Content-Type": "application/json" }, body: f });
      setPreview((await res.json()) as UploadPreview);
    } catch {
      setPreview({ status: "invalid", errors: ["The server could not read the file."] });
    }
    setStep("result");
  };

  const save = async () => {
    if (!file) return;
    setStep("saving");
    const res = await fetch("/api/uploads", { method: "POST", headers: { "Content-Type": "application/json" }, body: file });
    const result = (await res.json()) as UploadPreview;
    if (result.status === "adds" || result.status === "creates") {
      onClose();
      notify(result.status === "creates" ? `Created ${result.name} with 1 uploaded analysis.` : `Added the analysis to ${result.name}.`);
      router.push(`/p/${encodeURIComponent(result.key)}`);
      router.refresh();
    } else {
      setPreview(result);
      setStep("result");
    }
  };

  const picker = (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3.5">
      <button
        type="button"
        className={`drop${over ? " over" : ""}`}
        data-autofocus
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void check(e.dataTransfer.files[0]);
        }}
      >
        <FileUpload aria-hidden className="mx-auto" />
        <div className="mt-1.5 text-fg">
          Drop <code className="mono">report.json</code> here or choose a file
        </div>
        <div className="mt-0.5 text-xs text-faint">Checked against the report schema before anything is saved</div>
      </button>
      <input ref={input} type="file" accept=".json,application/json" hidden onChange={(e) => void check(e.target.files?.[0])} />
      <Banner>
        The analysis is stored by Qualis (<code>QUALIS_DATA_DIR/uploads/&lt;project&gt;/</code>) and added to the project with the same <code>project.key</code>, or to a new project. Your file is not changed.
      </Banner>
      <div className="text-[12.5px] text-faint">
        Working on a project folder?{" "}
        <a
          href="#"
          className="link"
          onClick={(e) => {
            e.preventDefault();
            onSwitch();
          }}
        >
          Import the project
        </a>{" "}
        instead: Qualis then follows its <code>.qualis</code> folder by itself.
      </div>
    </div>
  );

  let body: ReactNode = picker;
  let footer: ReactNode = (
    <>
      <button type="button" className="btn" onClick={onClose}>
        Cancel
      </button>
      <button type="button" className="btn primary" disabled>
        Add
      </button>
    </>
  );
  if (step === "checking" || step === "saving") {
    body = (
      <div className="empty">
        <div className="empty-ic">
          <FileUpload aria-hidden />
        </div>
        <b className="t">{step === "checking" ? `Validating ${file?.name ?? "report.json"}…` : "Saving…"}</b>
        <p>{step === "checking" ? "Checking the report schema" : "Storing the analysis in the data folder"}</p>
      </div>
    );
  } else if (step === "result" && preview) {
    if (preview.status === "invalid") {
      body = (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3.5">
          <div className="note warn" role="alert">
            <TriangleAlert aria-hidden />
            <span>
              <b>{file?.name ?? "This file"} is not a Qualis report.</b> Nothing was saved.
              <ul className="mono mt-1.5 list-disc pl-4 text-xs break-all">
                {preview.errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </span>
          </div>
          {picker}
        </div>
      );
    } else {
      const outcome =
        preview.status === "duplicate" ? (
          <Banner>
            <b>Already in {preview.name}.</b> An analysis with the same id is in the project; nothing to add.
          </Banner>
        ) : preview.status === "adds" ? (
          <div className="outcome">
            <span className="badge b-new">Adds analysis</span>
            <div>
              <b>Adds this analysis to {preview.name}</b>
              <p>
                The project already exists (same <code>project.key</code>). It will have {preview.analyses} analyses; the newest by date is shown first.
              </p>
            </div>
          </div>
        ) : (
          <div className="outcome">
            <span className="badge b-new">New project</span>
            <div>
              <b>Creates the project {preview.name}</b>
              <p>
                No project with the key <code>{preview.key}</code> yet: Qualis creates it as an uploaded project. You can link its folder later.
              </p>
            </div>
          </div>
        );
      body = (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3.5">
          <Banner ok>
            <b>{file?.name ?? "report.json"} is a valid report</b>
          </Banner>
          <dl className="kv narrow">
            <div>
              <dt>Project</dt>
              <dd>
                {preview.name} <span className="mono text-faint">{preview.key}</span>
              </dd>
            </div>
            <div>
              <dt>Analysis</dt>
              <dd className="inline-flex flex-wrap items-center gap-1.5">
                {fDate(preview.finishedAt)}
                {preview.branch && (
                  <>
                    {" · "}
                    <GitBranch aria-hidden className="size-3.5" /> {preview.branch}
                  </>
                )}
              </dd>
            </div>
            <div>
              <dt>Quality gate</dt>
              <dd>
                <span className={`badge ${preview.gate === "passed" ? "b-ok" : "b-fail"}`}>{preview.gate === "passed" ? "Passed" : "Failed"}</span>
              </dd>
            </div>
          </dl>
          {outcome}
        </div>
      );
      footer =
        preview.status === "duplicate" ? (
          <>
            <button type="button" className="btn" onClick={onClose}>
              Close
            </button>
            <button
              type="button"
              className="btn primary"
              onClick={() => {
                onClose();
                router.push(`/p/${encodeURIComponent(preview.key)}`);
              }}
            >
              Open project
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setStep("pick");
                setPreview(null);
              }}
            >
              Choose another file
            </button>
            <button type="button" className="btn primary" onClick={() => void save()}>
              {preview.status === "adds" ? "Add analysis" : "Create project"}
            </button>
          </>
        );
    }
  }

  return (
    <Dialog open={open} onClose={onClose} eyebrow="Read analysis" title="Add a report.json" description="Validate a report and keep it in Qualis." footer={footer}>
      {body}
    </Dialog>
  );
}
