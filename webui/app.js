"use strict";

// File Names Come From The Drive And From The Disk: They Are Only Ever Put In
// The Page With textContent (Through h()), Never As Html.

const h = (tag, attrs, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (k === "class") e.className = v;
    else if (k === "text") e.textContent = v;
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) e.append(kid);
  return e;
};

const $ = (id) => document.getElementById(id);

async function api(path, body) {
  const opts = body === undefined ? {} : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  };
  const res = await fetch("/api/" + path, opts);
  let data = {};
  try { data = await res.json(); } catch (_) { /* Empty Body */ }
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

const human = (b) => {
  if (b == null || b < 0) return "—";
  const u = ["B", "KiB", "MiB", "GiB", "TiB"];
  let i = 0;
  while (b >= 1024 && i < 4) { b /= 1024; i++; }
  return (i === 0 ? String(Math.round(b)) : b.toFixed(1)) + " " + u[i];
};
const when = (iso) => (iso ? iso.slice(0, 16).replace("T", " ") : "");
const join = (dir, name) => (dir.replace(/\/+$/, "") + "/" + name);
const parentOf = (p) => p.replace(/\/[^/]*\/?$/, "") || "/";

function say(text, kind = "") {
  const box = $("messages");
  const li = h("li", { class: kind, text });
  box.append(li);
  box.hidden = false;
  setTimeout(() => { li.remove(); box.hidden = !box.children.length; }, kind === "error" ? 9000 : 4000);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ Remote Files
const files = {
  cwd: "/", entries: [], sel: new Set(), sort: "name", dir: 1, loading: false, busy: false,

  async load(path = this.cwd) {
    this.loading = true; this.render();
    try {
      const r = await api("ls?path=" + encodeURIComponent(path));
      this.cwd = r.path; this.entries = r.entries; this.sel.clear();
    } catch (e) { say(e.message, "error"); }
    this.loading = false; this.render();
  },

  sorted() {
    const k = this.sort, d = this.dir;
    return [...this.entries].sort((a, b) => {
      if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
      let r;
      if (k === "size") r = a.size - b.size;
      else if (k === "modified") r = a.modified.localeCompare(b.modified);
      else r = a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });
      return r * d || a.name.localeCompare(b.name);
    });
  },

  chosen() { return this.entries.filter((e) => this.sel.has(e.name)); },

  render() {
    const root = $("view-files");
    const chosen = this.chosen();
    const crumbs = h("div", { class: "crumbs" });
    const parts = this.cwd.split("/").filter(Boolean);
    crumbs.append(h("button", { type: "button", text: "proton:", onclick: () => this.load("/") }));
    parts.forEach((p, i) => {
      crumbs.append(h("span", { class: "sep", text: "/" }));
      const target = "/" + parts.slice(0, i + 1).join("/");
      crumbs.append(i === parts.length - 1
        ? h("span", { class: "cur", text: p })
        : h("button", { type: "button", text: p, onclick: () => this.load(target) }));
    });

    const th = (key, label, cls = "") => h("th", {
      class: "sortable " + cls, "aria-sort": this.sort === key ? (this.dir === 1 ? "ascending" : "descending") : false,
    }, h("button", { type: "button", onclick: () => {
      if (this.sort === key) this.dir = -this.dir; else { this.sort = key; this.dir = 1; }
      this.render();
    } }, label, h("span", { class: "sort-arrow", text: this.sort === key && this.dir === -1 ? "▼" : "▲" })));

    const all = h("input", { type: "checkbox", "aria-label": "Select all",
      onchange: (ev) => {
        this.sel = new Set(ev.target.checked ? this.entries.map((e) => e.name) : []);
        this.render();
      } });
    all.checked = this.entries.length > 0 && this.sel.size === this.entries.length;

    const rows = this.sorted().map((e) => {
      const cb = h("input", { type: "checkbox", "aria-label": "Select " + e.name,
        onchange: (ev) => { ev.target.checked ? this.sel.add(e.name) : this.sel.delete(e.name); this.render(); } });
      cb.checked = this.sel.has(e.name);
      const label = e.is_dir
        ? h("button", { type: "button", title: e.name, onclick: () => this.load(join(this.cwd, e.name)) }, h("span", { class: "ico", text: "📁" }), e.name)
        : h("span", { class: "nm", title: e.name }, h("span", { class: "ico", text: "📄" }), e.name);
      return h("tr", { class: this.sel.has(e.name) ? "selected" : "" },
        h("td", { class: "select" }, cb),
        h("td", { class: "name-cell" }, label),
        h("td", { class: "num mono nowrap", text: e.is_dir ? "—" : human(e.size) }),
        h("td", { class: "mono nowrap muted", text: when(e.modified) }));
    });

    const needSel = chosen.length === 0;
    const body = this.loading
      ? h("div", { class: "empty" }, h("span", { class: "spinner" }), " Reading the Drive… (can take a few seconds)")
      : this.entries.length === 0
        ? h("div", { class: "empty", text: "(empty)" })
        : h("div", { class: "table-wrap" }, h("table", {},
            h("thead", {}, h("tr", {}, h("th", { class: "select" }, all), th("name", "Name"), th("size", "Size", "num"), th("modified", "Modified"))),
            h("tbody", {}, rows)));

    root.replaceChildren(
      h("div", { class: "page-head" }, h("div", {}, h("h1", { text: "Files" }), h("p", { text: "Browse Proton Drive and move files in either direction." }))),
      h("div", { class: "card" },
        h("div", { class: "toolbar" },
          h("div", { class: "grow" }, crumbs),
          h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "↑ Up", disabled: this.cwd === "/", onclick: () => this.load(parentOf(this.cwd)) }),
          h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Reload", onclick: () => this.load() }),
          h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "New Folder", onclick: () => this.newFolder() })),
        h("div", { class: "toolbar" },
          h("button", { class: "btn", type: "button", text: "⬇ Download", disabled: needSel, onclick: () => transferDialog("download", chosen) }),
          h("button", { class: "btn", type: "button", text: "⬆ Upload Here", onclick: () => transferDialog("upload", []) }),
          h("button", { class: "btn btn-ghost", type: "button", text: "Size", disabled: chosen.length !== 1, onclick: () => this.size(chosen[0]) }),
          h("button", { class: "btn btn-danger-ghost", type: "button", text: "Delete…", disabled: needSel, onclick: () => deleteDialog(chosen) })),
        body,
        h("div", { class: "results-meta" },
          h("span", { text: `${this.entries.length} item${this.entries.length === 1 ? "" : "s"}` }),
          h("span", { text: this.sel.size ? `${this.sel.size} selected` : "" }))));
  },

  async newFolder() {
    const name = prompt("Name of the new folder:");
    if (!name) return;
    try { await api("mkdir", { path: this.cwd, name }); say(`Created ${name}`, "ok"); await this.load(); }
    catch (e) { say(e.message, "error"); }
  },

  async size(e) {
    try {
      say(`Computing the size of ${e.name}…`);
      const r = await api("size?path=" + encodeURIComponent(join(this.cwd, e.name)));
      say(`${e.name}: ${r.count} file${r.count === 1 ? "" : "s"}, ${human(r.bytes)}`, "ok");
    } catch (err) { say(err.message, "error"); }
  },
};

// ------------------------------------------------------------------------ Dialogs
function openModal(title, body, foot) {
  const overlay = $("overlay");
  const close = () => { overlay.hidden = true; overlay.replaceChildren(); };
  overlay.replaceChildren(h("div", { class: "modal", role: "dialog", "aria-modal": "true", "aria-label": title },
    h("div", { class: "modal-head" }, h("h2", { text: title }),
      h("button", { class: "btn-link", type: "button", text: "Close", onclick: () => close() })),
    h("div", { class: "modal-body" }, body),
    h("div", { class: "modal-foot" }, foot)));
  overlay.hidden = false;
  return close;
}

function chips(names) {
  const shown = names.slice(0, 8);
  return h("div", { class: "chips" }, shown.map((n) => h("span", { class: "chip", title: n, text: n })),
    names.length > shown.length ? h("span", { class: "muted", text: `+${names.length - shown.length} more` }) : null);
}

const CONFLICT_OPTIONS = [
  [1, "Overwrite if different", "default"],
  [2, "Skip files already there", "--ignore-existing"],
  [3, "Overwrite only if newer", "--update"],
  [4, "Keep both", "the old one becomes name.old-YYYYMMDD-HHMMSS.ext"],
];

function conflictFieldset() {
  return h("fieldset", {}, h("legend", { text: "If the file already exists at the destination" }),
    CONFLICT_OPTIONS.map(([v, label, hint]) => h("label", { class: "choice" },
      h("input", Object.assign({ type: "radio", name: "conflict", value: String(v) }, v === 1 ? { checked: true } : {})),
      h("span", {}, label, " ", h("span", { class: "hint", text: hint })))));
}
const conflictValue = () => Number(document.querySelector('input[name="conflict"]:checked').value);

// Folder / File Picker On The Local Disk. `multi` Lets Files And Folders Be Ticked.
function localPicker(start, { multi }) {
  const state = { path: start, ticked: new Map(), hidden: false, info: null };
  const root = h("div", { class: "picker" });
  const render = (data, err) => {
    const list = h("div", { class: "picker-list" });
    if (err) list.append(h("div", { class: "empty", text: err }));
    else if (!data.entries.length) list.append(h("div", { class: "empty", text: "(empty)" }));
    else for (const e of data.entries.sort((a, b) => (b.is_dir - a.is_dir) || a.name.localeCompare(b.name))) {
      const full = join(data.path, e.name);
      const row = h("div", { class: "picker-row" });
      if (multi) {
        const cb = h("input", { type: "checkbox", "aria-label": "Select " + e.name,
          onchange: (ev) => { ev.target.checked ? state.ticked.set(full, e) : state.ticked.delete(full); summary(); } });
        cb.checked = state.ticked.has(full);
        row.append(cb);
      }
      row.append(e.is_dir
        ? h("button", { type: "button", title: e.name, onclick: () => go(full) }, "📁 ", e.name)
        : h("button", { type: "button", title: e.name, style: "cursor:default" }, "📄 ", e.name),
        h("span", { class: "sz", text: e.is_dir ? "" : human(e.size) }));
      list.append(row);
    }
    const sum = h("span", { class: "muted" });
    const summary = () => { sum.textContent = multi ? `${state.ticked.size} selected` : ""; };
    summary();
    root.replaceChildren(
      h("div", { class: "picker-bar" },
        h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "↑", title: "Parent folder", disabled: !data || !data.parent, onclick: () => go(data.parent) }),
        h("button", { class: "btn btn-ghost btn-sm", type: "button", text: transferDialog.status.local_root ? "Top" : "Home", onclick: () => go("") }),
        h("input", { type: "text", class: "path mono-input", "aria-label": "Folder path", spellcheck: "false",
          value: data ? data.path : "", onkeydown: (ev) => { if (ev.key === "Enter") go(ev.target.value.trim()); } }),
        h("label", { class: "choice" }, h("input", Object.assign({ type: "checkbox", onchange: (ev) => { state.hidden = ev.target.checked; go(state.path); } }, state.hidden ? { checked: true } : {})), "hidden"),
        sum),
      list);
  };
  const go = async (path) => {
    try {
      const data = await api(`local?path=${encodeURIComponent(path || "")}&hidden=${state.hidden ? 1 : 0}`);
      state.path = data.path; state.info = data; render(data);
      if (state.onNavigate) state.onNavigate(data);
    } catch (e) {
      // The Default Folder May Not Exist Yet: Fall Back To The Home Folder.
      if (!state.info && path) return go("");
      render(state.info, e.message);
    }
  };
  go(start);
  return { el: root, state, go };
}

function transferDialog(kind, items) {
  const isDown = kind === "download";
  const status = transferDialog.status;
  let picker, destInput, createCb, warn = h("div", { class: "warn-box", hidden: true });

  if (isDown) {
    destInput = h("input", { type: "text", class: "mono-input", id: "dest", value: status.default_local, spellcheck: "false" });
    picker = localPicker(status.default_local, { multi: false });
    // Ordinary Navigation In The Picker Updates The Destination.
    picker.state.onNavigate = (d) => {
      destInput.value = d.path;
      const low = d.free != null && d.free < 2 * 1024 ** 3;
      warn.hidden = !low && d.writable;
      warn.textContent = !d.writable ? "This folder is not writable." : low ? `Only ${human(d.free)} free here.` : "";
    };
  } else {
    destInput = h("input", { type: "text", class: "mono-input", id: "dest", value: files.cwd, spellcheck: "false" });
    picker = localPicker(status.home, { multi: true });
  }
  createCb = h("input", { type: "checkbox" });

  const body = h("div", { class: "stack" },
    isDown ? h("div", {}, h("div", { class: "muted", text: "Downloading" }), chips(items.map((i) => i.name))) : null,
    h("div", { class: "field" },
      h("span", { text: isDown ? "Local destination" : "Remote destination (a folder in Proton Drive)" }), destInput,
      isDown ? h("label", { class: "choice" }, createCb, "Create it if it does not exist") : null),
    h("div", { class: "field" }, h("span", { text: isDown ? "Browse the local disk" : "Pick local files and folders to upload" }), localHint(), picker.el),
    warn,
    conflictFieldset());

  const preview = h("button", { class: "btn", type: "button", text: "Preview", onclick: async () => {
    let payload;
    if (isDown) {
      payload = { kind, dest: destInput.value.trim(), create_dest: createCb.checked,
        items: items.map((i) => ({ path: join(files.cwd, i.name), is_dir: i.is_dir })) };
    } else {
      const picked = [...picker.state.ticked.entries()];
      if (!picked.length) { say("Tick at least one local file or folder.", "error"); return; }
      payload = { kind, dest: destInput.value.trim(),
        items: picked.map(([p, e]) => ({ path: p, is_dir: e.is_dir })) };
    }
    payload.conflict = conflictValue();
    try { await runPreview(payload, close); } catch (e) { say(e.message, "error"); }
  } });
  const close = openModal(isDown ? "Download" : "Upload", body, [
    h("button", { class: "btn btn-ghost", type: "button", text: "Cancel", onclick: () => close() }), preview]);
}

// Dry-Run First, Then Confirmation: Nothing Moves Without It.
async function runPreview(payload, close) {
  const job = await api("jobs", { ...payload, dry_run: true });
  const log = h("pre", { class: "log", text: "Working…" });
  const go = h("button", { class: "btn", type: "button", text: "Transfer", disabled: true });
  const back = h("button", { class: "btn btn-ghost", type: "button", text: "Back", onclick: () => {
    const ctx = { local: payload.local_dir, remote: payload.remote_dir }, dir = payload.kind.split("_")[0];
    if (payload.mirror) mirrorDialog(dir, ctx, compare.mirrorSets(dir));
    else if (payload.kind.endsWith("_files")) filesTransferDialog(dir, ctx, payload.paths);
    else transferDialog(payload.kind, payload.kind === "download" ? files.chosen() : []);
  } });
  const closePreview = openModal("Preview — no changes made", h("div", { class: "stack" },
    h("div", { class: "muted", text: "This is what rclone would do (--dry-run)." }), log), [back, go]);
  go.onclick = async () => {
    go.disabled = true;
    try {
      const real = await api("jobs", { ...payload, dry_run: false });
      closePreview();
      progressDialog(real.id);
    } catch (e) { say(e.message, "error"); go.disabled = false; }
  };
  for (;;) {
    const s = await api("jobs/" + job.id);
    log.textContent = s.log.join("\n") || "Working…";
    if (s.state !== "running") {
      go.disabled = s.state !== "done";
      if (s.state !== "done") log.textContent += "\n\nPreview failed — nothing was transferred.";
      return;
    }
    await sleep(700);
  }
}

function jobBar(p) {
  const pct = p && p.total > 0 ? Math.min(100, (p.bytes / p.total) * 100) : null;
  const bar = h("div", { class: "bar" + (pct == null ? " indeterminate" : "") }, h("i", { style: pct == null ? "" : `width:${pct.toFixed(1)}%` }));
  const txt = p ? `${human(p.bytes)} / ${human(p.total)}  ·  ${human(p.speed)}/s${p.eta != null ? `  ·  ETA ${p.eta}s` : ""}  ·  ${p.done}/${p.count} files` : "Starting…";
  return h("div", {}, bar, h("div", { class: "muted mono", style: "margin-top:4px", text: txt }));
}

function progressDialog(id) {
  const holder = h("div", { class: "stack" });
  const cancel = h("button", { class: "btn btn-danger-ghost", type: "button", text: "Cancel Transfer", onclick: () => api(`jobs/${id}/cancel`, {}).catch((e) => say(e.message, "error")) });
  const done = h("button", { class: "btn", type: "button", text: "Close", hidden: true, onclick: async () => { close(); await files.load(); compare.afterTransfer(); } });
  const close = openModal("Transferring", holder, [cancel, done]);
  (async () => {
    for (;;) {
      let s;
      try { s = await api("jobs/" + id); } catch (e) { say(e.message, "error"); return; }
      const cur = s.steps.find((x) => x.state === "running");
      holder.replaceChildren(
        h("ul", { class: "steps" }, s.steps.map((st) => h("li", {}, h("span", { class: "badge job-" + st.state, text: st.state }), h("span", { class: "desc", title: st.desc, text: st.desc })))),
        s.state === "running" ? jobBar(cur && cur.progress) : h("div", {}, h("span", { class: "badge job-" + s.state, text: s.state })),
        h("pre", { class: "log", text: s.log.slice(-60).join("\n") }));
      const pre = holder.querySelector("pre"); pre.scrollTop = pre.scrollHeight;
      if (s.state !== "running") {
        cancel.hidden = true; done.hidden = false;
        say(s.state === "done" ? "Transfer finished." : `Transfer ${s.state}.`, s.state === "done" ? "ok" : "error");
        jobsView.refresh();
        return;
      }
      await sleep(900);
    }
  })();
}

function deleteDialog(items) {
  const input = h("input", { type: "text", placeholder: "DELETE", autocomplete: "off" });
  const go = h("button", { class: "btn btn-danger", type: "button", text: "Delete From Proton Drive", disabled: true, onclick: async () => {
    go.disabled = true;
    try {
      const job = await api("jobs", { kind: "delete", confirm: input.value,
        items: items.map((i) => ({ path: join(files.cwd, i.name), is_dir: i.is_dir })) });
      close();
      progressDialog(job.id);
    } catch (e) { say(e.message, "error"); go.disabled = false; }
  } });
  input.addEventListener("input", () => { go.disabled = input.value !== "DELETE"; });
  const close = openModal("Delete", h("div", { class: "stack" },
    h("div", { class: "warn-box danger-box", text: "These will be deleted from Proton Drive. Directories are removed with everything inside." }),
    chips(items.map((i) => (i.is_dir ? i.name + "/" : i.name))),
    h("div", { class: "field" }, h("span", {}, "Type ", h("strong", { text: "DELETE" }), " to confirm"), input)),
    [h("button", { class: "btn btn-ghost", type: "button", text: "Cancel", onclick: () => close() }), go]);
  input.focus();
}

// Folder Picker On Proton Drive: Directories Only, Path Editable.
function remotePicker(start) {
  const state = { path: start || "/" };
  const root = h("div", { class: "picker" });
  const render = (entries, note, loading) => {
    const list = h("div", { class: "picker-list" });
    if (loading) list.append(h("div", { class: "empty" }, h("span", { class: "spinner" }), " Reading the Drive…"));
    else {
      if (note) list.append(h("div", { class: "empty", text: note }));
      const dirs = (entries || []).filter((e) => e.is_dir).sort((a, b) => a.name.localeCompare(b.name));
      if (!note && !dirs.length) list.append(h("div", { class: "empty", text: "(no sub-folders)" }));
      for (const e of dirs) {
        list.append(h("div", { class: "picker-row" },
          h("button", { type: "button", title: e.name, onclick: () => go(join(state.path, e.name)) }, "📁 ", e.name)));
      }
    }
    root.replaceChildren(
      h("div", { class: "picker-bar" },
        h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "↑", title: "Parent folder", disabled: state.path === "/", onclick: () => go(parentOf(state.path)) }),
        h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Top", onclick: () => go("/") }),
        h("input", { type: "text", class: "path mono-input", "aria-label": "Proton folder path", spellcheck: "false", value: state.path,
          oninput: (ev) => { state.path = ev.target.value.trim() || "/"; },
          onkeydown: (ev) => { if (ev.key === "Enter") go(ev.target.value.trim() || "/"); } })),
      list);
  };
  const go = async (path) => {
    state.path = path; render([], "", true);
    try { const r = await api("ls?path=" + encodeURIComponent(path)); state.path = r.path; render(r.entries); }
    catch (e) { render([], e.message); }
  };
  go(state.path);
  return { el: root, state };
}

// "/data" Is The Container's Name For Your Folder: Say Which One It Is.
function localHint() {
  const label = transferDialog.status && transferDialog.status.local_label;
  return label ? h("span", { class: "hint muted", text: `On your computer: ${label}` }) : null;
}

// ------------------------------------------------------------------------ Compare
const CMP = {
  only_local: ["Only Local", "On this machine, not on Proton"],
  local_newer: ["Local Newer", "Changed here, older on Proton"],
  only_remote: ["Only Remote", "On Proton, not on this machine"],
  remote_newer: ["Remote Newer", "Changed on Proton, older here"],
  differs: ["Different", "Size differs, same modification time"],
  same: ["Same", "Same size and time"],
};
const whenTs = (t) => {
  if (t == null) return "?";
  const d = new Date(t * 1000), z = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}`;
};

const compare = {
  local: "", remote: "/", ignoreTime: false, result: null, loading: false, error: "",
  filter: "diff", sel: new Set(), shown: 500,

  start() {
    if (!this.local) this.local = transferDialog.status.default_local;
    this.render();
  },

  // Reads Both Folders In The Background: The Server Reports Progress And Can Cancel.
  // `refresh` Skips The Server's Short-Lived Cache Of Proton Listings.
  async run(refresh = false) {
    this.loading = true; this.error = ""; this.sel.clear(); this.progress = null; this.cachedAt = null; this.render();
    try {
      let snap = await api("compare/start", { local: this.local.trim(), remote: this.remote.trim() || "/", refresh });
      this.scanId = snap.id;
      while (snap.state === "running") {
        this.progress = snap; this.renderProgress();
        await new Promise((r) => setTimeout(r, 1000));
        snap = await api(`compare/${this.scanId}?ignore_time=${this.ignoreTime ? 1 : 0}`);
      }
      if (snap.state === "done") { this.result = snap.result; this.cachedAt = snap.cached_at; this.shown = 500; }
      else { this.result = null; if (snap.state === "failed") this.error = snap.error; }
    } catch (e) { this.error = e.message; this.result = null; }
    this.loading = false; this.render();
  },

  async cancel() { if (this.scanId) try { await api(`compare/${this.scanId}/cancel`, {}); } catch (_) { /* Already Finished */ } },

  // The Ignore-Time Switch Only Changes How The Same Listing Is Classified: No New Read.
  async reclassify() {
    if (!this.scanId || !this.result || this.loading) return;
    try {
      const snap = await api(`compare/${this.scanId}?ignore_time=${this.ignoreTime ? 1 : 0}`);
      if (snap.state === "done") { this.result = snap.result; this.sel.clear(); this.render(); }
    } catch (_) { /* The Scan Is Gone: The Next Compare Reads Again */ }
  },

  renderProgress() {
    const el = document.getElementById("cmp-progress");
    if (!el || !this.progress) return;
    const p = this.progress, secs = Math.round(p.elapsed);
    el.querySelector(".txt").textContent = ` ${p.phase}… ${secs}s` +
      (p.expected && p.phase.startsWith("Reading Proton") ? ` (last time ${Math.round(p.expected)}s)` : "");
  },

  afterTransfer() { if (this.result) this.run(); },

  visible() {
    if (!this.result) return [];
    return this.result.entries.filter((e) =>
      this.filter === "all" ? true : this.filter === "diff" ? e.status !== "same" : e.status === this.filter);
  },

  pick(statuses) {
    this.sel = new Set(this.result.entries.filter((e) => statuses.includes(e.status)).map((e) => e.path));
    this.render();
  },

  // What A Mirror In This Direction Would Copy, And What Only The Destination Has.
  mirrorSets(dir) {
    const src = dir === "upload" ? "local" : "remote", dst = dir === "upload" ? "remote" : "local";
    const copy = this.result.entries.filter((e) => e[src] && e.status !== "same");
    return {
      copy: copy.map((e) => e.path),
      overwrite: copy.filter((e) => e[dst]).length,
      newer: copy.filter((e) => e[dst] && e.status === (dir === "upload" ? "remote_newer" : "local_newer")).length,
      doomed: this.result.entries.filter((e) => e[dst] && !e[src]).map((e) => e.path),
    };
  },

  pathsFor(dir) {
    const side = dir === "upload" ? "local" : "remote";
    return this.result.entries.filter((e) => this.sel.has(e.path) && e[side]).map((e) => e.path);
  },

  chooseLocal() {
    const picker = localPicker(this.local || transferDialog.status.default_local, { multi: false });
    const close = openModal("Choose Local Folder", h("div", { class: "stack" }, localHint(), picker.el), [
      h("button", { class: "btn btn-ghost", type: "button", text: "Cancel", onclick: () => close() }),
      h("button", { class: "btn", type: "button", text: "Use This Folder", onclick: () => { this.local = picker.state.path; close(); this.render(); } })]);
  },

  chooseRemote() {
    const picker = remotePicker(this.remote || "/");
    const close = openModal("Choose Proton Folder", h("div", { class: "stack" },
      h("div", { class: "muted", text: "Pick a folder in Proton Drive. You can also type a path that does not exist yet." }), picker.el), [
      h("button", { class: "btn btn-ghost", type: "button", text: "Cancel", onclick: () => close() }),
      h("button", { class: "btn", type: "button", text: "Use This Folder", onclick: () => { this.remote = picker.state.path; close(); this.render(); } })]);
  },

  render() {
    const root = $("view-compare");
    const r = this.result;
    const localIn = h("input", { type: "text", class: "mono-input", spellcheck: "false", "aria-label": "Local folder", value: this.local,
      oninput: (ev) => { this.local = ev.target.value; } });
    const remoteIn = h("input", { type: "text", class: "mono-input", spellcheck: "false", "aria-label": "Remote folder", value: this.remote,
      oninput: (ev) => { this.remote = ev.target.value; } });
    const ignore = h("input", { type: "checkbox", onchange: (ev) => { this.ignoreTime = ev.target.checked; this.reclassify(); } });
    ignore.checked = this.ignoreTime;
    const form = h("div", { class: "cmp-form" },
      h("div", { class: "field" }, h("span", { text: "Local folder" }),
        h("div", { class: "row" }, localIn, h("button", { class: "btn btn-ghost", type: "button", text: "Browse…", onclick: () => this.chooseLocal() })),
        localHint()),
      h("div", { class: "field" }, h("span", { text: "Proton folder" }),
        h("div", { class: "row" }, remoteIn, h("button", { class: "btn btn-ghost", type: "button", text: "Browse…", onclick: () => this.chooseRemote() }), h("button", { class: "btn btn-ghost", type: "button", text: "Current Folder", title: "Use the folder open in Files", onclick: () => { this.remote = files.cwd; this.render(); } }))),
      h("div", { class: "wide" },
        h("button", { class: "btn", type: "button", text: this.loading ? "Comparing…" : "Compare", disabled: this.loading, onclick: () => this.run() }),
        h("label", { class: "choice" }, ignore, h("span", {}, "Ignore time when sizes match ", h("span", { class: "hint muted", text: "use this if every file shows as newer after an upload" }))),
        this.loading ? h("span", { id: "cmp-progress" }, h("span", { class: "spinner" }), h("span", { class: "txt", text: " Starting…" }), " ",
          h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Cancel", onclick: () => this.cancel() })) : null,
        !this.loading && this.cachedAt ? h("span", { class: "muted" }, `Proton listing from ${Math.max(1, Math.round((Date.now() / 1000 - this.cachedAt) / 60))} min ago `,
          h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Refresh", onclick: () => this.run(true) })) : null));

    let body;
    if (this.error) {
      body = h("div", { class: "empty", text: this.error });
    } else if (!r) {
      body = h("div", { class: "empty", text: this.loading ? "Proton has to be read folder by folder, so large folders take a while." : "Pick two folders and press Compare." });
    } else {
      const vis = this.visible();
      const chosen = this.sel.size;
      const nUp = this.pathsFor("upload").length, nDown = this.pathsFor("download").length;
      const filterBtn = (key, label, n) => h("button", { type: "button", "aria-pressed": this.filter === key ? "true" : "false",
        onclick: () => { this.filter = key; this.shown = 500; this.render(); } }, `${label} ${n}`);
      const c = r.counts;
      const diffCount = r.entries.length - c.same;
      const filters = h("div", { class: "filters" },
        filterBtn("diff", "Differences", diffCount),
        Object.keys(CMP).map((k) => filterBtn(k, CMP[k][0], c[k])),
        filterBtn("all", "All", r.entries.length));

      const all = h("input", { type: "checkbox", "aria-label": "Select all shown",
        onchange: (ev) => { for (const e of vis) ev.target.checked ? this.sel.add(e.path) : this.sel.delete(e.path); this.render(); } });
      all.checked = vis.length > 0 && vis.every((e) => this.sel.has(e.path));

      const side = (x) => (x ? h("td", { class: "side mono" }, `${human(x.size)}  ${whenTs(x.mtime)}`) : h("td", { class: "side" }, h("span", { class: "dash", text: "—" })));
      const rows = vis.slice(0, this.shown).map((e) => {
        const cb = h("input", { type: "checkbox", "aria-label": "Select " + e.path, onchange: (ev) => { ev.target.checked ? this.sel.add(e.path) : this.sel.delete(e.path); this.render(); } });
        cb.checked = this.sel.has(e.path);
        return h("tr", { class: this.sel.has(e.path) ? "selected" : "" },
          h("td", { class: "select" }, cb),
          h("td", { class: "path", title: e.path, text: e.path }),
          h("td", {}, h("span", { class: "badge cmp-" + e.status, title: CMP[e.status][1], text: CMP[e.status][0] })),
          side(e.local), side(e.remote));
      });

      body = h("div", {},
        !r.remote_exists ? h("div", { class: "hint-line", text: `The Proton folder ${r.remote_dir} does not exist yet: everything local counts as new. Uploading creates it.` }) : null,
        filters,
        h("div", { class: "toolbar" },
          h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Mirror To Proton", disabled: r.truncated, title: "Make the Proton folder like the local one",
            onclick: () => mirrorDialog("upload", { local: r.local_dir, remote: r.remote_dir }, this.mirrorSets("upload")) }),
          h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Mirror To Local", disabled: r.truncated, title: "Make the local folder like the Proton one",
            onclick: () => mirrorDialog("download", { local: r.local_dir, remote: r.remote_dir }, this.mirrorSets("download")) }),
          h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Select Local Changes", title: "Only Local + Local Newer", onclick: () => this.pick(["only_local", "local_newer"]) }),
          h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Select Remote Changes", title: "Only Remote + Remote Newer", onclick: () => this.pick(["only_remote", "remote_newer"]) }),
          h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Clear", disabled: !chosen, onclick: () => { this.sel.clear(); this.render(); } }),
          h("span", { class: "grow" }),
          h("button", { class: "btn", type: "button", text: `⬆ Upload (${nUp})`, disabled: !nUp, onclick: () => filesTransferDialog("upload", { local: r.local_dir, remote: r.remote_dir }, this.pathsFor("upload")) }),
          h("button", { class: "btn", type: "button", text: `⬇ Download (${nDown})`, disabled: !nDown, onclick: () => filesTransferDialog("download", { local: r.local_dir, remote: r.remote_dir }, this.pathsFor("download")) })),
        vis.length === 0 ? h("div", { class: "empty", text: this.filter === "diff" ? "No differences: both folders match." : "Nothing in this group." })
          : h("div", { class: "table-wrap" }, h("table", {},
              h("thead", {}, h("tr", {}, h("th", { class: "select" }, all), ["Path", "Status", "Local", "Proton"].map((t) => h("th", { text: t })))),
              h("tbody", {}, rows))),
        h("div", { class: "results-meta" },
          h("span", { text: `${vis.length} shown of ${r.entries.length}${r.truncated ? " (list cut at 30000)" : ""}` }),
          vis.length > this.shown ? h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Show 500 More", onclick: () => { this.shown += 500; this.render(); } }) : h("span", { text: chosen ? `${chosen} selected` : "" })));
    }

    root.replaceChildren(
      h("div", { class: "page-head" }, h("div", {}, h("h1", { text: "Compare" }), h("p", { text: "See what is new or changed on this machine and on Proton Drive, and move only what you choose." }))),
      h("div", { class: "card" }, form, body));
  },
};

// Upload Or Download Only The Files Picked In Compare.
// One-Way Mirror: Copy What Is New Or Different, Optionally Delete What Only The Destination Has.
function mirrorDialog(dir, ctx, set) {
  const up = dir === "upload";
  const target = up ? "Proton" : "your computer";
  const word = h("input", { type: "text", class: "mono-input", placeholder: "DELETE", autocomplete: "off", spellcheck: "false", disabled: true });
  const doIt = h("input", { type: "checkbox", disabled: !set.doomed.length,
    onchange: (ev) => { word.disabled = !ev.target.checked; if (!ev.target.checked) word.value = ""; } });
  const plural = (n) => `${n} file${n === 1 ? "" : "s"}`;
  const body = h("div", { class: "stack" },
    h("div", {}, h("div", { class: "muted", text: up ? "Mirror To Proton" : "Mirror To Local" }),
      h("div", { class: "muted mono", text: up ? `${ctx.local}  →  proton:${ctx.remote}` : `proton:${ctx.remote}  →  ${ctx.local}` })),
    h("div", {}, `${plural(set.copy.length)} will be copied to ${target}`,
      set.overwrite ? ` (${set.overwrite} replace${set.overwrite === 1 ? "s" : ""} an existing file` + (set.newer ? `, ${set.newer} of them newer at the destination` : "") + ")" : ""),
    set.newer ? h("div", { class: "warn-box", text: "Some files at the destination are newer than the source and would be overwritten. Choose Keep Both below to keep the old versions." }) : null,
    set.copy.length ? chips(set.copy) : null,
    h("label", { class: "choice" }, doIt, h("span", {}, `Also delete the ${plural(set.doomed.length)} that exist only on ${target} `,
      h("span", { class: "hint", text: "cannot be undone from here" }))),
    set.doomed.length ? chips(set.doomed) : null,
    h("div", { class: "field" }, h("span", { text: "Type DELETE to allow the deletions" }), word),
    conflictFieldset());
  const preview = h("button", { class: "btn", type: "button", text: "Preview", onclick: async () => {
    const del = doIt.checked;
    if (del && word.value !== "DELETE") { say("Type DELETE to allow the deletions.", "error"); return; }
    if (!set.copy.length && !del) { say("Nothing to do: tick the deletions or close this.", "error"); return; }
    const payload = { kind: dir + "_files", mirror: true, local_dir: ctx.local, remote_dir: ctx.remote, paths: set.copy,
      delete_paths: del ? set.doomed : [], confirm: del ? "DELETE" : "", conflict: conflictValue() };
    try { await runPreview(payload, close); } catch (e) { say(e.message, "error"); }
  } });
  const close = openModal(up ? "Mirror To Proton" : "Mirror To Local", body, [
    h("button", { class: "btn btn-ghost", type: "button", text: "Cancel", onclick: () => close() }), preview]);
}

function filesTransferDialog(dir, ctx, paths) {
  const up = dir === "upload";
  const body = h("div", { class: "stack" },
    h("div", {}, h("div", { class: "muted", text: up ? "Uploading" : "Downloading" }),
      h("div", { class: "mono", text: `${paths.length} file${paths.length === 1 ? "" : "s"}` }),
      h("div", { class: "muted mono", text: up ? `${ctx.local}  →  proton:${ctx.remote}` : `proton:${ctx.remote}  →  ${ctx.local}` })),
    chips(paths),
    conflictFieldset());
  const preview = h("button", { class: "btn", type: "button", text: "Preview", onclick: async () => {
    const payload = { kind: dir + "_files", local_dir: ctx.local, remote_dir: ctx.remote, paths, conflict: conflictValue() };
    try { await runPreview(payload, close); } catch (e) { say(e.message, "error"); }
  } });
  const close = openModal(up ? "Upload Selected" : "Download Selected", body, [
    h("button", { class: "btn btn-ghost", type: "button", text: "Cancel", onclick: () => close() }), preview]);
}

// -------------------------------------------------------------------------- Login
// Username, Password And The 2FA Code Are Typed Here, Sent Once Over Loopback, And Only
// The Session Is Kept. The 2FA Code Is Never Stored.
async function refreshStatus() {
  transferDialog.status = await api("status");
  return transferDialog.status;
}

function showLoggedOut() {
  files.entries = []; files.sel.clear(); files.loading = false; files.render();
  compare.result = null; compare.local = ""; compare.render();
  const card = $("view-files").querySelector(".card");
  if (card) card.replaceChildren(h("div", { class: "empty" }, "Not logged in to Proton. ",
    h("button", { class: "btn-link", type: "button", text: "In", onclick: loginDialog })));
}

function loginDialog() {
  const status = transferDialog.status || {};
  const user = h("input", { type: "text", autocomplete: "off", spellcheck: "false", class: "mono-input",
    "aria-label": "Proton username", value: status.account || "" });
  const pwd = h("input", { type: "password", autocomplete: "new-password", "aria-label": "Proton password" });
  const mailbox = h("input", { type: "password", autocomplete: "off", "aria-label": "Mailbox password" });
  const code = h("input", { type: "text", inputmode: "numeric", autocomplete: "off",
    maxlength: "6", class: "mono-input", "aria-label": "Mfa" });
  const err = h("div", { class: "warn-box danger-box", hidden: true });
  const go = h("button", { class: "btn", type: "button", text: "Log In" });
  const submit = async () => {
    go.disabled = true; err.hidden = true; go.textContent = "Logging in…";
    try {
      await api("login", { username: user.value.trim(), password: pwd.value,
        mailbox_password: mailbox.value, code: code.value.trim() });
      pwd.value = ""; mailbox.value = "";
      close();
      const st = await refreshStatus();
      say("Logged in.", "ok");
      compare.local = ""; compare.start();
      if (!st.sync_dir) folderDialog(true);
      await files.load("/");
    } catch (e) {
      err.textContent = e.message; err.hidden = false;
      go.disabled = false; go.textContent = "Log In"; (e.message.includes("code") ? code : pwd).select();
    }
  };
  go.onclick = submit;
  for (const el of [user, pwd, mailbox, code]) el.addEventListener("keydown", (ev) => { if (ev.key === "Enter") submit(); });
  const close = openModal("Proton Login", h("div", { class: "stack" },
    h("div", { class: "field" }, h("span", { text: "Username" }), user),
    h("div", { class: "field" }, h("span", { text: "Password" }), pwd),
    h("div", { class: "field" }, h("span", { text: "Mfa" }), code),
    h("details", {}, h("summary", { class: "muted", text: "Account with two passwords" }),
      h("div", { class: "field" }, h("span", { text: "Mailbox password" }), mailbox)),
    err),
    [h("button", { class: "btn btn-ghost", type: "button", text: "Later", onclick: () => close() }), go]);
  (user.value ? pwd : user).focus();
}

async function logout() {
  if (!confirm("Log out of Proton? The saved session is removed from this machine.")) return;
  try {
    await api("logout", {});
    await refreshStatus();
    showLoggedOut();
    say("Logged out.", "ok");
    loginDialog();
  } catch (e) { say(e.message, "error"); }
}

// The Local Folder Used By Default For Downloads And Compare, Remembered Between Restarts.
function folderDialog(first) {
  const status = transferDialog.status;
  const start = status.sync_dir || status.default_local;
  const dest = h("input", { type: "text", class: "mono-input", id: "sync-dir", spellcheck: "false", value: start });
  const picker = localPicker(start, { multi: false });
  picker.state.onNavigate = (d) => { dest.value = d.path; };
  const name = h("input", { type: "text", class: "mono-input", placeholder: "New folder name", spellcheck: "false", "aria-label": "New folder name" });
  const err = h("div", { class: "warn-box danger-box", hidden: true });
  const make = h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Create", onclick: async () => {
    err.hidden = true;
    try {
      const r = await api("local_mkdir", { path: picker.state.path, name: name.value.trim() });
      name.value = ""; picker.go(r.path);
    } catch (e) { err.textContent = e.message; err.hidden = false; }
  } });
  const save = h("button", { class: "btn", type: "button", text: "Use This Folder", onclick: async () => {
    err.hidden = true;
    try {
      await api("settings", { sync_dir: dest.value.trim() });
      const old = status.default_local;
      await refreshStatus();
      if (!compare.local || compare.local === old) compare.local = transferDialog.status.default_local;
      close();
      localHintRefresh();
      say("Local folder saved.", "ok");
    } catch (e) { err.textContent = e.message; err.hidden = false; }
  } });
  const body = h("div", { class: "stack" },
    h("div", { class: "muted", text: first
      ? "Choose the folder on this machine to work with. It is the default for downloads and for Compare."
      : "The default folder for downloads and for Compare." }),
    h("div", { class: "field" }, h("span", { text: "Local folder" }), dest),
    h("div", { class: "field" }, h("span", { text: "Browse" }), localHint(), picker.el),
    h("div", { class: "field" }, h("span", { text: "Create a folder inside the one shown above" }),
      h("div", { class: "row" }, name, make)),
    err);
  const close = openModal("Local Folder", body, [
    h("button", { class: "btn btn-ghost", type: "button", text: first ? "Later" : "Cancel", onclick: () => close() }), save]);
}
const localHintRefresh = () => { if (!$("view-compare").hidden) compare.render(); };

// ---------------------------------------------------------------------- Transfers
const jobsView = {
  jobs: [],
  async refresh() {
    try { this.jobs = (await api("jobs")).jobs; } catch (_) { return; }
    const running = this.jobs.filter((j) => j.state === "running").length;
    $("nav-jobs").hidden = !running; $("nav-jobs").textContent = String(running);
    if (!$("view-transfers").hidden) this.render();
  },
  render() {
    const root = $("view-transfers");
    const rows = this.jobs.map((j) => {
      const label = j.kind + (j.dry_run ? " (preview)" : "");
      return h("tr", {},
        h("td", {}, h("span", { class: "badge job-" + j.state, text: j.state })),
        h("td", { text: label }),
        h("td", { class: "mono muted nowrap", text: new Date(j.created * 1000).toLocaleString() }),
        h("td", { class: "mono" }, j.steps.length + (j.steps.length === 1 ? " step" : " steps")),
        h("td", { class: "nowrap" },
          h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Details", onclick: () => this.details(j.id) }),
          j.state === "running" ? null
            : h("button", { class: "btn btn-danger-ghost btn-sm", type: "button", text: "Delete", onclick: () => this.remove(`jobs/${j.id}/delete`) })));
    });
    const finished = this.jobs.some((j) => j.state !== "running");
    root.replaceChildren(
      h("div", { class: "page-head" }, h("div", {}, h("h1", { text: "Transfers" }), h("p", { text: "Operations since pdrive-web was started." })),
        finished ? h("button", { class: "btn btn-danger-ghost", type: "button", text: "Delete All", onclick: () => this.remove("jobs/clear") }) : null),
      h("div", { class: "card" }, rows.length
        ? h("div", { class: "table-wrap" }, h("table", {}, h("thead", {}, h("tr", {}, ["State", "Kind", "Started", "Steps", ""].map((t) => h("th", { text: t })))), h("tbody", {}, rows)))
        : h("div", { class: "empty", text: "Nothing yet." })));
  },
  async remove(route) {
    try { await api(route, {}); } catch (e) { say(e.message, "error"); }
    this.refresh();
  },
  async details(id) {
    const s = await api("jobs/" + id);
    const close = openModal(`${s.kind}${s.dry_run ? " (preview)" : ""}`, h("div", { class: "stack" },
      h("ul", { class: "steps" }, s.steps.map((st) => h("li", {}, h("span", { class: "badge job-" + st.state, text: st.state }), h("span", { class: "desc", title: st.desc, text: st.desc })))),
      h("pre", { class: "log", text: s.log.join("\n") })),
      [h("button", { class: "btn", type: "button", text: "Close", onclick: () => close() })]);
  },
};

// -------------------------------------------------------------------------- Shell
function route() {
  const view = ({ "#transfers": "transfers", "#compare": "compare" })[location.hash] || "files";
  for (const a of document.querySelectorAll(".nav a")) {
    if (a.dataset.view === view) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  }
  $("view-files").hidden = view !== "files";
  $("view-transfers").hidden = view !== "transfers";
  $("view-compare").hidden = view !== "compare";
  if (view === "transfers") jobsView.refresh();
  if (view === "compare" && transferDialog.status) compare.start();
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("overlay").hidden) { $("overlay").hidden = true; $("overlay").replaceChildren(); }
});

(async function init() {
  window.addEventListener("hashchange", route);
  route();
  try {
    await refreshStatus();
    route();
  } catch (e) {
    $("view-files").replaceChildren(h("div", { class: "empty", text: e.message }));
    return;
  }
  $("login").onclick = loginDialog;
  $("logout").onclick = logout;
  $("folder").onclick = () => folderDialog(false);
  if (!transferDialog.status.logged_in) {
    // No Saved Session: Ask For The Login Before Anything Tries To Read The Drive.
    showLoggedOut();
    loginDialog();
  } else {
    files.load("/");
    if (!transferDialog.status.sync_dir) folderDialog(true);
  }
  jobsView.refresh();
  setInterval(() => jobsView.refresh(), 4000);
})();
