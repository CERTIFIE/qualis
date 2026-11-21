"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "./Dialog";
import { useDialogs } from "./dialogs";
import { Copy, Dots, Folders, Layers, Pencil, Plus, Refresh, Trash } from "./icons";
import { useMenu } from "./menu";

// Solutions: New solution, Add projects, Move to solution, Rename, Remove solution and the solution menu.
// A project belongs to at most one solution; picking one that is in another solution moves it. Nothing on disk changes.

interface ProjectItem {
  key: string;
  name: string;
  solution: { id: string; name: string } | null;
}

interface SolutionItem {
  id: string;
  name: string;
  folder: string | null;
  projects: string[];
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init ? { ...init, headers: { "Content-Type": "application/json" } } : undefined);
  return (await res.json()) as T;
}

export function NewSolutionButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen(true)} aria-haspopup="dialog">
        <Folders aria-hidden />
        New solution
      </button>
      <PickProjectsDialog open={open} onClose={() => setOpen(false)} target={null} />
    </>
  );
}

/** New solution (`target` null) or Add projects to an existing solution: pick registered projects. */
export function PickProjectsDialog({ open, onClose, target }: { open: boolean; onClose: () => void; target: { id: string; name: string } | null }) {
  const router = useRouter();
  const { notify } = useDialogs();
  const [projects, setProjects] = useState<ProjectItem[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPicked(new Set());
    setName("");
    setError(null);
    setProjects(null);
    void json<ProjectItem[]>("/api/projects").then(setProjects);
  }, [open]);

  const rows = (projects ?? []).filter((p) => !target || p.solution?.id !== target.id);
  const k = picked.size;
  const submit = async () => {
    if (!target && !name.trim()) {
      setError("Give the solution a name.");
      return;
    }
    setBusy(true);
    if (target) {
      await json(`/api/solutions/${encodeURIComponent(target.id)}`, { method: "PATCH", body: JSON.stringify({ add: [...picked] }) });
      setBusy(false);
      onClose();
      notify(`Added ${plural(k, "project", "projects")} to ${target.name}.`);
      router.refresh();
      return;
    }
    const created = await json<{ id?: string; name?: string }>("/api/solutions", { method: "POST", body: JSON.stringify({ name, projects: [...picked] }) });
    setBusy(false);
    if (!created.id) {
      setError("The solution could not be created.");
      return;
    }
    onClose();
    notify(`Created ${created.name}${k ? ` with ${plural(k, "project", "projects")}` : ""}.`);
    router.push(`/s/${encodeURIComponent(created.id)}`);
    router.refresh();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      wide
      eyebrow={target ? "Solution" : "New solution"}
      title={target ? `Add projects to ${target.name}` : "Group projects in a solution"}
      {...(target ? {} : { description: "A solution shows the combined metrics of its projects. To create one from a folder with several projects, use Import project." })}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn primary" disabled={busy || (!!target && !k)} onClick={() => void submit()}>
            {target ? `Add ${plural(k, "project", "projects")}` : `Create solution${k ? ` (${plural(k, "project", "projects")})` : ""}`}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
        {!target && (
          <label className="disc-name">
            <span>Solution name</span>
            <input
              className="fsearch"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
              placeholder="e.g. ACS Academy"
              spellCheck={false}
              autoComplete="off"
              data-autofocus
              aria-invalid={!!error}
            />
          </label>
        )}
        {error && (
          <div className="note warn" role="alert">
            <span>{error}</span>
          </div>
        )}
        <div className="flist" role="group" aria-label="Projects">
          {projects === null && <div className="p-3.5 text-center text-[13px] text-faint">Loading…</div>}
          {projects !== null && !rows.length && <div className="p-3.5 text-center text-[13px] text-faint">{target ? "Every project is already in this solution." : "No projects yet: import one first."}</div>}
          {rows.map((p) => (
            <label key={p.key} className="frow pick">
              <input
                type="checkbox"
                checked={picked.has(p.key)}
                onChange={(e) => {
                  const next = new Set(picked);
                  if (e.target.checked) next.add(p.key);
                  else next.delete(p.key);
                  setPicked(next);
                }}
              />
              <Layers aria-hidden />
              <span className="nm sans">{p.name}</span>
              <span className="pick-name mono">{p.key}</span>
              {p.solution && (
                <span className="badge" title="A project belongs to one solution">
                  in {p.solution.name} · moves
                </span>
              )}
            </label>
          ))}
        </div>
        <div className="text-[12.5px] text-faint">A project belongs to at most one solution: picking one from another solution moves it here. Nothing on disk changes.</div>
      </div>
    </Dialog>
  );
}

/** Move to solution: an existing solution or a new one. */
export function MoveToSolutionDialog({ open, onClose, projectKey, name, current }: { open: boolean; onClose: () => void; projectKey: string; name: string; current: string | null }) {
  const router = useRouter();
  const { notify } = useDialogs();
  const [solutions, setSolutions] = useState<SolutionItem[] | null>(null);
  const [choice, setChoice] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setChoice(null);
    setNewName("");
    void json<SolutionItem[]>("/api/solutions").then(setSolutions);
  }, [open]);

  const submit = async () => {
    if (!choice || (choice === "__new" && !newName.trim())) return;
    setBusy(true);
    const result = await json<{ status: string; id?: string | null }>(`/api/projects/${encodeURIComponent(projectKey)}/solution`, {
      method: "PUT",
      body: JSON.stringify(choice === "__new" ? { newName } : { id: choice }),
    });
    setBusy(false);
    onClose();
    const target = choice === "__new" ? newName.trim() : solutions?.find((s) => s.id === choice)?.name;
    notify(result.status === "ok" ? `${name} moved to ${target}.` : `${name} could not be moved.`);
    router.refresh();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      eyebrow="Project"
      title={`Move ${name} to a solution`}
      description="A project belongs to at most one solution. Its analyses and folder do not change."
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn primary" disabled={busy || !choice || (choice === "__new" && !newName.trim())} onClick={() => void submit()}>
            Move
          </button>
        </>
      }
    >
      <div className="flist" role="radiogroup" aria-label="Solution">
        {solutions === null && <div className="p-3.5 text-center text-[13px] text-faint">Loading…</div>}
        {solutions?.map((s) => (
          <label key={s.id} className="frow pick">
            <input type="radio" name="move-to" checked={choice === s.id} disabled={s.id === current} onChange={() => setChoice(s.id)} />
            <Folders aria-hidden />
            <span className="nm sans">{s.name}</span>
            <span className="pick-name">{plural(s.projects.length, "project", "projects")}</span>
            {s.id === current && <span className="badge b-new">Current</span>}
          </label>
        ))}
        <label className="frow pick">
          <input type="radio" name="move-to" checked={choice === "__new"} onChange={() => setChoice("__new")} />
          <Plus aria-hidden />
          <span className="nm sans">New solution</span>
          <input
            className="fsearch m-0 max-w-[220px]"
            placeholder="Name"
            value={newName}
            disabled={choice !== "__new"}
            onChange={(e) => setNewName(e.target.value)}
            aria-label="Name of the new solution"
          />
        </label>
      </div>
    </Dialog>
  );
}

/** The solution's actions on its dashboard. */
export function SolutionMenu({ id, name, folder, projects }: { id: string; name: string; folder: string | null; projects: number }) {
  const router = useRouter();
  const { notify } = useDialogs();
  const { open, setOpen, wrap, button, run } = useMenu();
  const [dialog, setDialog] = useState<"add" | "rename" | "remove" | null>(null);
  const [newName, setNewName] = useState(name);
  const [busy, setBusy] = useState(false);
  const url = `/api/solutions/${encodeURIComponent(id)}`;

  const rescan = async () => {
    const result = await json<{ status: string; added?: number }>(url, { method: "POST" });
    notify(result.status === "ok" ? (result.added ? `Found ${plural(result.added, "new project", "new projects")} in ${folder}.` : `No new projects in ${folder}.`) : `The folder ${folder} is not reachable.`);
    router.refresh();
  };
  const rename = async () => {
    if (!newName.trim()) return;
    setBusy(true);
    await json(url, { method: "PATCH", body: JSON.stringify({ name: newName }) });
    setBusy(false);
    setDialog(null);
    notify(`Renamed to ${newName.trim()}.`);
    router.refresh();
  };
  const remove = async () => {
    setBusy(true);
    await json(url, { method: "DELETE" });
    setBusy(false);
    setDialog(null);
    notify(`Removed ${name}; its projects are standalone now.`);
    router.push("/");
    router.refresh();
  };

  return (
    <div className="menu-wrap" ref={wrap}>
      <button ref={button} type="button" className="btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Dots aria-hidden />
        Solution
      </button>
      {open && (
        <div className="menu" role="menu">
          <button type="button" role="menuitem" onClick={run(() => setDialog("add"))}>
            <Plus aria-hidden />
            Add projects…
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={run(() => {
              setNewName(name);
              setDialog("rename");
            })}
          >
            <Pencil aria-hidden />
            Rename…
          </button>
          {folder && (
            <>
              <button type="button" role="menuitem" onClick={run(rescan)}>
                <Refresh aria-hidden />
                Look for new projects
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={run(async () => {
                  await navigator.clipboard?.writeText(folder);
                  notify(`Copied ${folder}`);
                })}
              >
                <Copy aria-hidden />
                Copy folder path
              </button>
            </>
          )}
          <hr />
          <button type="button" role="menuitem" className="danger" onClick={run(() => setDialog("remove"))}>
            <Trash aria-hidden />
            Remove solution
          </button>
        </div>
      )}
      <PickProjectsDialog open={dialog === "add"} onClose={() => setDialog(null)} target={{ id, name }} />
      <Dialog
        open={dialog === "rename"}
        onClose={() => setDialog(null)}
        eyebrow="Solution"
        title={`Rename ${name}`}
        footer={
          <>
            <button type="button" className="btn" onClick={() => setDialog(null)}>
              Cancel
            </button>
            <button type="button" className="btn primary" disabled={busy || !newName.trim()} onClick={() => void rename()}>
              Rename
            </button>
          </>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void rename();
          }}
        >
          <label className="disc-name">
            <span>Solution name</span>
            <input className="fsearch" value={newName} onChange={(e) => setNewName(e.target.value)} spellCheck={false} autoComplete="off" data-autofocus />
          </label>
        </form>
      </Dialog>
      <Dialog
        open={dialog === "remove"}
        onClose={() => setDialog(null)}
        eyebrow="Solution"
        title={`Remove the solution ${name}?`}
        footer={
          <>
            <button type="button" className="btn" onClick={() => setDialog(null)} data-autofocus>
              Cancel
            </button>
            <button type="button" className="btn primary danger" disabled={busy} onClick={() => void remove()}>
              <Trash aria-hidden />
              Remove solution
            </button>
          </>
        }
      >
        <p className="t2 m-0">
          {projects === 1 ? "Its project stays in Qualis as a standalone project, with all its analyses." : projects ? `Its ${projects} projects stay in Qualis as standalone projects, with all their analyses.` : "It has no projects."} No folder or file is touched
          {folder && (
            <>
              {" "}
              (<code className="mono">{folder}</code> included)
            </>
          )}
          .
        </p>
      </Dialog>
    </div>
  );
}

export function AddProjectsButton({ id, name, primary }: { id: string; name: string; primary?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={`btn sm${primary ? " primary" : ""}`} onClick={() => setOpen(true)} aria-haspopup="dialog">
        <Plus aria-hidden />
        Add projects…
      </button>
      <PickProjectsDialog open={open} onClose={() => setOpen(false)} target={{ id, name }} />
    </>
  );
}
