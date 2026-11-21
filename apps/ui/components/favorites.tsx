"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { Bookmark, BookmarkFilled } from "./icons";
import { Empty } from "./ui";
import { NO_FAVORITES, parseFavorites, projectsPageItems, toggleFavorite, type Favorites, type PageProject, type PageSolution, type ProjectsView } from "@/lib/favorites";

// Favorites and the All / Favorites choice are kept in this browser's localStorage (the UI has no users). Storage
// can be unavailable (private windows, blocked site data): every access is guarded and the page then simply has no
// favorites. The server renders with no favorites; useSyncExternalStore switches to the stored ones after hydration.

const FAVORITES_KEY = "qualis:favorites";
const VIEW_KEY = "qualis:projects-view";
export const FAVORITES_TIP = "Favorites are saved in this browser only: Qualis has no user accounts.";

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage unavailable: the change lasts until the page is reloaded.
  }
  memory.set(key, value);
  listeners.forEach((l) => l());
}

/** Values written while storage is unavailable, so the page still reacts. */
const memory = new Map<string, string>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === FAVORITES_KEY || e.key === VIEW_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

let cachedText: string | null | undefined;
let cachedFavorites: Favorites = NO_FAVORITES;

function favoritesSnapshot(): Favorites {
  const text = read(FAVORITES_KEY) ?? memory.get(FAVORITES_KEY) ?? null;
  if (text !== cachedText) {
    cachedText = text;
    cachedFavorites = parseFavorites(text);
  }
  return cachedFavorites;
}

function viewSnapshot(): ProjectsView {
  return (read(VIEW_KEY) ?? memory.get(VIEW_KEY)) === "favorites" ? "favorites" : "all";
}

export function useFavorites(): Favorites {
  return useSyncExternalStore(subscribe, favoritesSnapshot, () => NO_FAVORITES);
}

function useView(): ProjectsView {
  return useSyncExternalStore(subscribe, viewSnapshot, () => "all");
}

/** Bookmark toggle of a project or a solution. */
export function FavButton({ kind, id, name, inline }: { kind: keyof Favorites; id: string; name: string; inline?: boolean }) {
  const favs = useFavorites();
  const on = favs[kind].includes(id);
  const Icon = on ? BookmarkFilled : Bookmark;
  return (
    <button
      type="button"
      className={`fav-btn${inline ? " inline" : ""}`}
      aria-pressed={on}
      aria-label={`${on ? "Remove" : "Add"} ${name} ${on ? "from" : "to"} favorites`}
      title={`${on ? "Remove from favorites" : "Add to favorites"} · saved in this browser`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        write(FAVORITES_KEY, JSON.stringify(toggleFavorite(favoritesSnapshot(), kind, id)));
      }}
    >
      <Icon aria-hidden />
    </button>
  );
}

/** Small filled bookmark on a project chip of a solution card when that project is a favorite. */
export function FavMark({ projectKey }: { projectKey: string }) {
  const favs = useFavorites();
  if (!favs.projects.includes(projectKey)) return null;
  return (
    <span className="mfav" title="Favorite">
      <BookmarkFilled aria-hidden />
      <span className="sr-only">favorite</span>
    </span>
  );
}

/**
 * The cards of the Projects page with the All / Favorites switch. Cards are rendered on the server and picked here:
 * `flatCards` are the projects of a solution as shown alone in Favorites (with their "in <solution>" hint).
 */
export function ProjectsBrowser({
  solutions,
  projects,
  solutionCards,
  projectCards,
  flatCards,
}: {
  solutions: PageSolution[];
  projects: PageProject[];
  solutionCards: Record<string, ReactNode>;
  projectCards: Record<string, ReactNode>;
  flatCards: Record<string, ReactNode>;
}) {
  const favs = useFavorites();
  const view = useView();
  const all = projectsPageItems("all", solutions, projects, favs);
  const favorites = projectsPageItems("favorites", solutions, projects, favs);
  const items = view === "favorites" ? favorites : all;
  const setView = (v: ProjectsView) => write(VIEW_KEY, v);
  return (
    <>
      <div className="section-title">
        <h2>{view === "favorites" ? "Favorites" : "All projects"}</h2>
        <div className="st-tools">
          <div className="seg pview" role="group" aria-label="Show">
            <button type="button" aria-pressed={view === "all"} onClick={() => setView("all")}>
              All<span className="count">{all.length}</span>
            </button>
            <button type="button" aria-pressed={view === "favorites"} onClick={() => setView("favorites")} title={FAVORITES_TIP}>
              <Bookmark aria-hidden />
              Favorites<span className="count">{favorites.length}</span>
            </button>
          </div>
          <span className="eyebrow m-0 hide-sm">Sorted by latest analysis</span>
        </div>
      </div>
      {view === "favorites" && items.length > 0 && (
        <div className="fav-note">
          <Bookmark aria-hidden />
          <span>Saved in this browser only. A favorite solution shows as a whole; a favorite project of another solution shows on its own.</span>
        </div>
      )}
      {items.length ? (
        <div className="pgrid">
          {items.map((item) =>
            item.kind === "solution" ? (
              <div key={`s:${item.id}`} className="contents">
                {solutionCards[item.id]}
              </div>
            ) : (
              <div key={`p:${item.key}`} className="contents">
                {item.inSolution ? flatCards[item.key] : projectCards[item.key]}
              </div>
            ),
          )}
        </div>
      ) : (
        <div className="card">
          <Empty icon={Bookmark} title="No favorites yet">
            Use the bookmark on a project or solution card to keep it here. Favorites are saved in <b>this browser only</b>: Qualis has no user accounts, so other browsers and people keep their own.
          </Empty>
          <div className="flex justify-center px-5 pb-6">
            <button type="button" className="btn" onClick={() => setView("all")}>
              Show all projects
            </button>
          </div>
        </div>
      )}
    </>
  );
}
