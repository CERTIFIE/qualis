// Qualis documentation: theme, navigation, code blocks, search and rule filters.
(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const storage = {
    get(key) {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, value);
      } catch {
        // Storage can be unavailable (private mode, file:// restrictions).
      }
    },
  };

  // Theme (dark by default; the choice is remembered per browser).
  const applyTheme = (theme) => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    for (const button of $$("[data-theme-toggle]")) {
      button.setAttribute("aria-label", theme === "dark" ? "Switch to light theme" : "Switch to dark theme");
    }
  };
  for (const button of $$("[data-theme-toggle]")) {
    button.addEventListener("click", () => {
      const next = document.documentElement.classList.contains("dark") ? "light" : "dark";
      storage.set("qualis-theme", next);
      applyTheme(next);
    });
  }
  applyTheme(document.documentElement.classList.contains("dark") ? "dark" : "light");

  // Mobile navigation.
  const sidebar = $("#sidebar");
  for (const button of $$("[data-nav-toggle]")) {
    button.addEventListener("click", () => {
      const open = sidebar.classList.toggle("hidden") === false;
      button.setAttribute("aria-expanded", String(open));
    });
  }

  // Copy buttons.
  const copy = async (text, button) => {
    try {
      await navigator.clipboard.writeText(text);
      const label = $(".copy-label", button);
      if (label) {
        const previous = label.textContent;
        label.textContent = "Copied";
        setTimeout(() => (label.textContent = previous), 1500);
      }
    } catch {
      // Clipboard API not available: nothing to do.
    }
  };
  for (const button of $$("[data-copy-code]")) {
    button.addEventListener("click", () => {
      const block = button.closest(".code");
      const visible = $$("pre", block).find((pre) => !pre.hidden);
      void copy(visible ? visible.textContent : "", button);
    });
  }
  const markdown = $("#page-markdown");
  for (const button of $$("[data-copy-markdown]")) {
    button.addEventListener("click", () => void copy(markdown ? markdown.textContent : "", button));
  }

  // Code tabs (package managers); the selected tab is remembered.
  const selectTab = (name) => {
    for (const group of $$("[data-tabs]")) {
      const buttons = $$("[data-tab]", group);
      if (!buttons.some((b) => b.dataset.tab === name)) continue;
      for (const b of buttons) b.setAttribute("aria-selected", String(b.dataset.tab === name));
      for (const pre of $$("pre[data-panel]", group)) pre.hidden = pre.dataset.panel !== name;
    }
  };
  for (const button of $$("[data-tabs] [data-tab]")) {
    button.addEventListener("click", () => {
      storage.set("qualis-tab", button.dataset.tab);
      selectTab(button.dataset.tab);
    });
  }
  const savedTab = storage.get("qualis-tab");
  if (savedTab) selectTab(savedTab);

  // "On this page": highlight the heading in view.
  const tocLinks = $$(".toc-link");
  if (tocLinks.length && "IntersectionObserver" in window) {
    const byId = new Map(tocLinks.map((a) => [a.getAttribute("href").slice(1), a]));
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          for (const a of tocLinks) a.classList.toggle("active", a === byId.get(entry.target.id));
        }
      },
      { rootMargin: "-80px 0px -70% 0px" },
    );
    for (const id of byId.keys()) {
      const heading = document.getElementById(id);
      if (heading) observer.observe(heading);
    }
  }

  // Search (index embedded in search-index.js so it works from file://).
  const dialog = $("#search");
  const input = $("#search-input");
  const results = $("#search-results");
  const base = document.documentElement.dataset.base || "";
  const index = window.QUALIS_SEARCH || [];
  let selected = 0;
  const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const render = () => {
    const terms = input.value.toLowerCase().split(/\s+/).filter(Boolean);
    const scored = terms.length
      ? index
          .map((entry) => {
            const title = entry.title.toLowerCase();
            const haystack = `${title} ${entry.text.toLowerCase()}`;
            if (!terms.every((t) => haystack.includes(t))) return null;
            const score = terms.reduce((s, t) => s + (title.includes(t) ? 3 : 1), 0) + (title.startsWith(terms[0]) ? 2 : 0);
            return { entry, score };
          })
          .filter(Boolean)
          .sort((a, b) => b.score - a.score)
          .slice(0, 12)
      : index.filter((e) => e.kind === "page").slice(0, 8).map((entry) => ({ entry, score: 0 }));
    selected = Math.min(selected, Math.max(0, scored.length - 1));
    // qualis-ignore-next-line typescript:no-unsafe-html-sink -- every value is escaped with escapeHtml
    results.innerHTML = scored.length
      ? scored
          .map(
            ({ entry }, i) => `<a href="${base}${entry.url}" class="flex items-baseline gap-3 px-4 py-2.5 ${i === selected ? "bg-soft" : ""}" data-result>
              <span class="label w-24 shrink-0 truncate text-faint">${escapeHtml(entry.section)}</span>
              <span class="min-w-0"><span class="block truncate text-[14px] text-fg">${escapeHtml(entry.title)}</span>
              <span class="block truncate text-[12.5px] text-faint">${escapeHtml(entry.text.slice(0, 120))}</span></span></a>`,
          )
          .join("")
      : `<p class="px-4 py-6 text-center text-[13px] text-faint">No results for “${escapeHtml(input.value)}”</p>`;
  };
  const openSearch = () => {
    dialog.classList.remove("hidden");
    dialog.classList.add("flex");
    input.value = "";
    selected = 0;
    render();
    input.focus();
  };
  const closeSearch = () => {
    dialog.classList.add("hidden");
    dialog.classList.remove("flex");
  };
  for (const button of $$("[data-search-open]")) button.addEventListener("click", openSearch);
  dialog?.addEventListener("click", (event) => {
    if (event.target === dialog) closeSearch();
  });
  input?.addEventListener("input", () => {
    selected = 0;
    render();
  });
  input?.addEventListener("keydown", (event) => {
    const links = $$("[data-result]", results);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      selected = (selected + (event.key === "ArrowDown" ? 1 : -1) + links.length) % Math.max(links.length, 1);
      render();
    } else if (event.key === "Enter" && links[selected]) {
      window.location.href = links[selected].href;
    }
  });
  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      dialog.classList.contains("hidden") ? openSearch() : closeSearch();
    } else if (event.key === "Escape" && dialog && !dialog.classList.contains("hidden")) {
      closeSearch();
    } else if (event.key === "/" && !/input|textarea|select/i.test(document.activeElement?.tagName ?? "")) {
      event.preventDefault();
      openSearch();
    }
  });

  // Rule catalog filters.
  const catalog = $("#rule-catalog");
  if (catalog) {
    const controls = $$("[data-filter]");
    const rows = $$("[data-rule]", catalog);
    const counter = $("#rule-count");
    const apply = () => {
      const values = Object.fromEntries(controls.map((c) => [c.dataset.filter, c.value.trim().toLowerCase()]));
      let shown = 0;
      for (const row of rows) {
        const ok =
          (!values.plugin || row.dataset.plugin === values.plugin) &&
          (!values.type || row.dataset.type === values.type) &&
          (!values.severity || row.dataset.severity === values.severity) &&
          (!values.text || row.dataset.search.includes(values.text));
        row.hidden = !ok;
        if (ok) shown++;
      }
      if (counter) counter.textContent = String(shown);
    };
    for (const control of controls) control.addEventListener("input", apply);
    const params = new URLSearchParams(window.location.search);
    for (const control of controls) {
      const value = params.get(control.dataset.filter);
      if (value) control.value = value;
    }
    apply();
  }
})();
