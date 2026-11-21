"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "./Dialog";
import { useDialogs } from "./dialogs";
import { Copy, Dots, FileUpload, Folders, Link2, Refresh, Trash, X } from "./icons";
import { useMenu } from "./menu";
import { MoveToSolutionDialog } from "./solution-dialogs";

/** The project's actions: re-read, copy or link the folder, read an analysis into it, move it between solutions, remove it. */
export function ProjectMenu({ projectKey, name, folder, uploads, solution }: { projectKey: string; name: string; folder: string | null; uploads: number; solution: { id: string; name: string } | null }) {
  const router = useRouter();
  const { openImport, openRead, notify } = useDialogs();
  const { open, setOpen, wrap, button, run } = useMenu();
  const [confirm, setConfirm] = useState(false);
  const [move, setMove] = useState(false);
  const [busy, setBusy] = useState(false);

  const reread = async () => {
    const res = await fetch(`/api/projects/${encodeURIComponent(projectKey)}`, { method: "POST" });
    const body = (await res.json()) as { analyses?: number };
    notify(folder ? `Re-read ${folder}/.qualis · ${body.analyses ?? 0} analyses.` : `Reloaded · ${body.analyses ?? 0} analyses.`);
    router.refresh();
  };
  const leave = async () => {
    await fetch(`/api/projects/${encodeURIComponent(projectKey)}/solution`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: null }) });
    notify(`Removed ${name} from ${solution?.name}: it is a standalone project now.`);
    router.refresh();
  };
  const remove = async () => {
    setBusy(true);
    await fetch(`/api/projects/${encodeURIComponent(projectKey)}`, { method: "DELETE" });
    setBusy(false);
    setConfirm(false);
    notify(`${name} removed from Qualis.`);
    router.push("/");
    router.refresh();
  };

  return (
    <div className="menu-wrap" ref={wrap}>
      <button ref={button} type="button" className="btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Dots aria-hidden />
        Project
      </button>
      {open && (
        <div className="menu" role="menu">
          {folder ? (
            <>
              <button type="button" role="menuitem" onClick={run(reread)}>
                <Refresh aria-hidden />
                Re-read .qualis now
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
          ) : (
            <button type="button" role="menuitem" onClick={run(openImport)}>
              <Link2 aria-hidden />
              Link a project folder…
            </button>
          )}
          <button type="button" role="menuitem" onClick={run(openRead)}>
            <FileUpload aria-hidden />
            Read analysis into this project…
          </button>
          <hr />
          <button type="button" role="menuitem" onClick={run(() => setMove(true))}>
            <Folders aria-hidden />
            Move to solution…
          </button>
          {solution && (
            <button type="button" role="menuitem" onClick={run(leave)}>
              <X aria-hidden />
              Remove from {solution.name}
            </button>
          )}
          <hr />
          <button type="button" role="menuitem" className="danger" onClick={run(() => setConfirm(true))}>
            <Trash aria-hidden />
            Remove from Qualis
          </button>
        </div>
      )}
      <MoveToSolutionDialog open={move} onClose={() => setMove(false)} projectKey={projectKey} name={name} current={solution?.id ?? null} />
      <Dialog
        open={confirm}
        onClose={() => setConfirm(false)}
        eyebrow="Project"
        title={`Remove ${name} from Qualis?`}
        footer={
          <>
            <button type="button" className="btn" onClick={() => setConfirm(false)} data-autofocus>
              Cancel
            </button>
            <button type="button" className="btn primary danger" disabled={busy} onClick={() => void remove()}>
              <Trash aria-hidden />
              Remove
            </button>
          </>
        }
      >
        <p className="t2 m-0">
          {folder ? (
            <>
              Qualis forgets <b>{name}</b>
              {uploads > 0 && ` and deletes its ${uploads} uploaded ${uploads === 1 ? "analysis" : "analyses"}`}. The folder <code className="mono">{folder}</code> and its <code className="mono">.qualis</code> files are{" "}
              <b>not touched</b>: import it again at any time.
            </>
          ) : (
            <>
              Qualis forgets <b>{name}</b> and deletes its {uploads} uploaded {uploads === 1 ? "analysis" : "analyses"} from its data folder. The original report files you uploaded are not affected.
            </>
          )}
        </p>
      </Dialog>
    </div>
  );
}
