/* E-Lit Borderlands — explorer for the ELitJournals Obsidian vault.
 * Data comes from build_graph.py (data/graph.json, data/people.json, data/notes/<id>.txt).
 * Sections: state · load · graph · layout · highlight · reader · search · controls · routing
 */
(() => {
"use strict";

// ------------------------------------------------------------------ state
const S = {
  data: null,           // graph.json
  people: null,         // people.json (lazy)
  graph: null,          // graphology instance
  renderer: null,       // sigma instance
  byLabel: new Map(),   // lowercase note label -> node id
  personNode: new Map(),// lowercase person name -> node id (bridges only)
  hovered: null, selected: null, focus: new Set(),
  hiddenGroups: new Set(), showPeople: true, minVenues: 2,
  layoutOn: true, readme: null,
};
const $ = (id) => document.getElementById(id);
const UNGROUPED = "#8a8a8a";
const PERSON = "#8f8a80";
const fold = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ------------------------------------------------------------------ load
async function load() {
  S.data = await (await fetch("data/graph.json")).json();
  for (const n of S.data.nodes) {
    if (n.kind === "note") S.byLabel.set(n.label.toLowerCase(), n.id);
    else S.personNode.set(n.label.toLowerCase(), n.id);
  }
  S.readme = S.data.nodes.find((n) => n.kind === "note" && n.path.toLowerCase() === "readme.md");
  buildGraph();
  buildLegend();
  startLayout();
  route();
  // people index is only needed for search + person pages; fetch it quietly afterwards
  fetch("data/people.json").then((r) => r.json()).then((p) => { S.people = p; buildSearchIndex(); if (location.hash.startsWith("#person/")) route(); });
  buildSearchIndex();
}

// ------------------------------------------------------------------ graph
const colorOf = (n) => (n.kind === "person" ? PERSON : n.group >= 0 ? S.data.groups[n.group].color : UNGROUPED);

function buildGraph() {
  const g = new graphology.Graph({ type: "undirected", multi: false });
  const groups = S.data.groups;
  const sectors = groups.length + 1;
  // Seed positions as a pie around a pole, like the README's Antarctica image:
  // ELO conferences near the centre, every other group in its own wedge.
  const eloIdx = groups.findIndex((gr) => /ELO Conferences/i.test(gr.name));
  for (const n of S.data.nodes) {
    if (n.kind !== "note") continue;
    const k = n.group >= 0 ? n.group : groups.length;
    const angle = (k / sectors) * Math.PI * 2 + Math.random() * (Math.PI * 2 / sectors);
    const r = n.group === eloIdx ? 40 + Math.random() * 60 : 300 + Math.random() * 500;
    g.addNode(n.id, {
      x: Math.cos(angle) * r, y: Math.sin(angle) * r,
      size: 3 + Math.sqrt(n.people || 1) * 0.35, label: n.label, color: colorOf(n), kind: "note", group: n.group,
    });
  }
  // People start at the average position of the venues that name them.
  const venuesOf = new Map();
  for (const [a, b] of S.data.edges) {
    if (S.data.nodes[b].kind === "person") (venuesOf.get(b) || venuesOf.set(b, []).get(b)).push(a);
  }
  for (const n of S.data.nodes) {
    if (n.kind !== "person") continue;
    const vs = venuesOf.get(n.id) || [];
    let x = 0, y = 0;
    for (const v of vs) { x += g.getNodeAttribute(v, "x"); y += g.getNodeAttribute(v, "y"); }
    const d = vs.length || 1;
    g.addNode(n.id, {
      x: x / d + (Math.random() - 0.5) * 40, y: y / d + (Math.random() - 0.5) * 40,
      size: 0.8 + Math.min(n.venues, 30) * 0.18, label: n.label, color: PERSON, kind: "person", venues: n.venues,
    });
  }
  for (const [a, b] of S.data.edges) if (!g.hasEdge(a, b)) g.addEdge(a, b, { size: 0.3 });
  S.graph = g;

  S.renderer = new Sigma(g, $("graph"), {
    labelRenderedSizeThreshold: 7, labelDensity: 0.6, labelGridCellSize: 90,
    labelColor: { color: "#e6e3dc" }, labelFont: "system-ui, sans-serif", labelSize: 12,
    defaultEdgeColor: "#3a3f47", zIndex: true, minCameraRatio: 0.02, maxCameraRatio: 4,
    nodeReducer, edgeReducer, defaultDrawNodeHover: drawHover,
  });
  S.renderer.once("afterRender", () => setTimeout(() => $("loading").classList.add("done"), 1200));
  S.renderer.on("enterNode", ({ node }) => { S.hovered = +node; refocus(); });
  S.renderer.on("leaveNode", () => { S.hovered = null; refocus(); });
  S.renderer.on("clickNode", ({ node }) => openNode(+node));
  S.renderer.on("clickStage", () => { if (S.selected !== null) location.hash = ""; });
}

// dark hover label (sigma's default is a white box)
function drawHover(ctx, d, st) {
  const size = st.labelSize, font = st.labelFont;
  ctx.font = `600 ${size}px ${font}`;
  const w = d.label ? ctx.measureText(d.label).width + 12 : 0;
  ctx.fillStyle = "#22262d"; ctx.strokeStyle = "#e8b44c"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(d.x, d.y, d.size + 3, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  if (!d.label) return;
  const h = size + 10;
  ctx.fillRect(d.x + d.size + 4, d.y - h / 2, w, h);
  ctx.fillStyle = "#e6e3dc"; ctx.fillText(d.label, d.x + d.size + 10, d.y + size / 3);
}

// ------------------------------------------------------------------ layout (ForceAtlas2, animated in small steps)
let layoutTicks = 0;
function startLayout() {
  const fa2 = graphologyLibrary.layoutForceAtlas2;
  const settings = { ...fa2.inferSettings(S.graph), barnesHutOptimize: true, gravity: 0.6, scalingRatio: 12, slowDown: 8 };
  const step = () => {
    if (!S.layoutOn) return;
    fa2.assign(S.graph, { iterations: 1, settings });
    if (++layoutTicks < 400) requestAnimationFrame(step);
    else setLayout(false);
  };
  requestAnimationFrame(step);
}
function setLayout(on) {
  S.layoutOn = on;
  $("layout-btn").textContent = on ? "Pause layout" : "Resume layout";
  if (on) { layoutTicks = Math.min(layoutTicks, 250); startLayout(); }
}

// ------------------------------------------------------------------ highlight / filtering (sigma reducers)
function refocus() {
  const c = S.hovered ?? S.selected;
  S.focus = c === null ? new Set() : new Set([c, ...S.graph.neighbors(c).map(Number)]);
  S.renderer.refresh({ skipIndexation: true });
}
function isHidden(id, a) {
  if (a.kind === "person") return !S.showPeople || a.venues < S.minVenues;
  return S.hiddenGroups.has(a.group);
}
function nodeReducer(id, a) {
  const n = +id;
  if (isHidden(n, a) && !S.focus.has(n)) return { ...a, hidden: true };
  if (S.focus.size) {
    if (S.focus.has(n)) {
      const r = { ...a, zIndex: 2, forceLabel: n === S.hovered || n === S.selected || a.kind === "note" };
      if (a.kind === "person") r.color = "#8fb8e8";
      if (n === S.selected) r.highlighted = true;
      return r;
    }
    return { ...a, color: "#1d2026", label: "", zIndex: 0 };
  }
  return a;
}
function edgeReducer(id, a) {
  const [s, t] = S.graph.extremities(id).map(Number);
  const sa = S.graph.getNodeAttributes(s), ta = S.graph.getNodeAttributes(t);
  if ((isHidden(s, sa) && !S.focus.has(s)) || (isHidden(t, ta) && !S.focus.has(t))) return { ...a, hidden: true };
  if (S.focus.size) {
    const c = S.hovered ?? S.selected;
    return s === c || t === c ? { ...a, color: "#e8b44c88", size: 0.8, zIndex: 1 } : { ...a, hidden: true };
  }
  return a;
}
function flyTo(n) {
  const pos = S.renderer.getNodeDisplayData(n);
  if (pos) S.renderer.getCamera().animate({ x: pos.x, y: pos.y, ratio: 0.25 }, { duration: 600 });
}

// ------------------------------------------------------------------ reader: markdown + wikilinks
function linkTarget(raw) {                       // mirrors link_target() in build_graph.py
  raw = raw.replace(/\\\|/g, "|");
  let t = raw.split("|")[0];
  if (t.includes("#")) { const b = t.split("#")[0]; t = b.trim() ? b : t.replace(/^#+/, ""); }
  t = t.trim();
  if (!t) t = raw.split("|").pop().trim();
  return t;
}
function wikify(md) {
  md = md.replace(/!\[\[([^\]]+?)\]\]/g, (_, f) => {
    const name = f.split("|")[0].trim();
    return /\.(png|jpe?g|gif|webp|svg)$/i.test(name)
      ? `![${name}](data/files/${encodeURIComponent(name)})`
      : `<a href="data/files/${encodeURIComponent(name)}" target="_blank">📎 ${esc(name)}</a>`;
  });
  md = md.replace(/\[\[([^\]]+?)\]\]/g, (_, raw) => {
    const t = linkTarget(raw);
    const shown = raw.includes("|") ? raw.replace(/\\\|/g, "|").split("|").slice(1).join("|").trim() || t : t;
    const key = t.toLowerCase();
    if (S.byLabel.has(key)) return `<a class="wl note" data-note="${S.byLabel.get(key)}">${esc(shown)}</a>`;
    const bridge = S.personNode.has(key) ? " bridge" : "";
    return `<a class="wl person${bridge}" data-person="${esc(t)}">${esc(shown)}</a>`;
  });
  md = md.replace(/(^|\s)#([A-Za-z][\w/-]*)/g, (_, pre, tag) => `${pre}<span class="tag">#${tag}</span>`);
  return md;
}
const noteCache = new Map();
async function noteText(id) {
  if (!noteCache.has(id)) noteCache.set(id, fetch(`data/notes/${id}.txt`).then((r) => r.text()));
  return noteCache.get(id);
}
function groupChip(n) {
  const name = n.group >= 0 ? S.data.groups[n.group].name : "Uncategorized";
  return `<span class="chip"><span class="dot" style="background:${colorOf(n)}"></span>${esc(name)}</span>`;
}
function setCrumbs(parts) {
  $("crumbs").innerHTML = [`<button data-home>Introduction</button>`, ...parts.map(esc)].join(" <span>›</span> ");
}

async function showWelcome() {
  setCrumbs([]);
  const st = S.data.stats;
  const intro = S.readme ? marked.parse(wikify(await noteText(S.readme.id))) : "";
  $("reader").innerHTML = `
    <div class="stats">
      <div class="stat"><b>${st.notes.toLocaleString()}</b><span>venues & notes</span></div>
      <div class="stat"><b>${st.people.toLocaleString()}</b><span>people with bylines</span></div>
      <div class="stat"><b>${st.bridges.toLocaleString()}</b><span>bridges (in ${st.minBridge}+ venues)</span></div>
      <div class="stat"><b>${st.links.toLocaleString()}</b><span>venue–person links</span></div>
    </div>
    <p class="hint">Hover a node to see its neighbours; click to read it. Blue names in a note are bridges — people who connect it to other venues. Toggle groups in the legend below the map.</p>
    ${intro}`;
  bindLinks();
}

async function showNote(id) {
  const n = S.data.nodes[id];
  setCrumbs([...(n.folder ? n.folder.split("/") : []), n.label]);
  const neighbours = S.graph.neighbors(id).map(Number);
  const bridges = neighbours.filter((x) => S.data.nodes[x].kind === "person").length;
  const linkedNotes = neighbours.filter((x) => S.data.nodes[x].kind === "note");
  const md = await noteText(id);
  $("reader").innerHTML = `
    <h1>${esc(n.label)}</h1>
    <div class="meta">${groupChip(n)}
      <span class="chip">${n.people.toLocaleString()} people named</span>
      <span class="chip">${bridges.toLocaleString()} bridges</span></div>
    ${linkedNotes.length ? `<p class="muted">Linked notes: ${linkedNotes.map((x) => `<a class="wl note" data-note="${x}">${esc(S.data.nodes[x].label)}</a>`).join(", ")}</p>` : ""}
    ${marked.parse(wikify(md))}`;
  bindLinks();
  $("panel").scrollTop = 0;
}

function showPerson(name) {
  setCrumbs(["People", name]);
  const key = name.toLowerCase();
  const entry = S.people && Object.keys(S.people).find((k) => k.toLowerCase() === key);
  const venues = entry ? S.people[entry] : null;
  if (!venues) {
    $("reader").innerHTML = `<h1>${esc(name)}</h1><p class="muted">${S.people ? "No venues found for this name." : "Loading people index…"}</p>`;
    return;
  }
  const items = venues.map((v) => S.data.nodes[v])
    .sort((a, b) => a.group - b.group || a.label.localeCompare(b.label))
    .map((v) => `<li><span class="dot" style="background:${colorOf(v)}"></span><a class="wl note" data-note="${v.id}">${esc(v.label)}</a></li>`).join("");
  $("reader").innerHTML = `
    <h1>${esc(entry)}</h1>
    <div class="meta"><span class="chip">appears in ${venues.length} ${venues.length === 1 ? "venue" : "venues"}</span>
      ${venues.length >= S.data.stats.minBridge ? '<span class="chip">bridge</span>' : ""}</div>
    ${venues.length === 1 ? '<p class="hint">A one-off byline — like 4 of every 5 people in this corpus. Not drawn on the map.</p>' : ""}
    <ul class="venue-list">${items}</ul>`;
  bindLinks();
  $("panel").scrollTop = 0;
}

function bindLinks() {
  document.querySelectorAll("#reader a.wl, #crumbs [data-home]").forEach((a) => {
    a.onclick = (e) => {
      e.preventDefault();
      if (a.dataset.home !== undefined) location.hash = "";
      else if (a.dataset.note) location.hash = `note/${a.dataset.note}`;
      else location.hash = `person/${encodeURIComponent(a.dataset.person)}`;
    };
  });
}

// ------------------------------------------------------------------ search
let searchIndex = [];
function buildSearchIndex() {
  searchIndex = S.data.nodes.filter((n) => n.kind === "note").map((n) => ({ kind: "note", id: n.id, label: n.label, f: fold(n.label), color: colorOf(n), w: 0 }));
  const names = S.people ? Object.keys(S.people) : S.data.nodes.filter((n) => n.kind === "person").map((n) => n.label);
  for (const name of names) {
    const v = S.people ? S.people[name].length : S.data.nodes[S.personNode.get(name.toLowerCase())].venues;
    searchIndex.push({ kind: "person", label: name, f: fold(name), color: v > 1 ? "#8fb8e8" : PERSON, w: v });
  }
}
function runSearch(q) {
  const f = fold(q.trim());
  const ul = $("results");
  if (f.length < 2) { ul.hidden = true; return; }
  const hits = [];
  for (const it of searchIndex) {
    const i = it.f.indexOf(f);
    if (i >= 0) hits.push([it, (i === 0 ? 0 : 1) + (it.kind === "note" ? 0 : 0.5) - Math.log1p(it.w) / 10]);
  }
  hits.sort((a, b) => a[1] - b[1]);
  ul.innerHTML = hits.slice(0, 14).map(([it], k) =>
    `<li role="option" data-k="${k}" aria-selected="${k === 0}"><span class="dot" style="background:${it.color}"></span>${esc(it.label)}
      <span class="kind">${it.kind === "note" ? "venue" : it.w + (it.w === 1 ? " venue" : " venues")}</span></li>`).join("")
    || `<li class="muted">No matches</li>`;
  ul.hidden = false;
  ul.querySelectorAll("li[data-k]").forEach((li) => {
    const it = hits[+li.dataset.k][0];
    li.onmousedown = (e) => { e.preventDefault(); pick(it); };
  });
  ul._hits = hits;
}
function pick(it) {
  $("results").hidden = true; $("search").value = ""; $("search").blur();
  location.hash = it.kind === "note" ? `note/${it.id}` : `person/${encodeURIComponent(it.label)}`;
}

// ------------------------------------------------------------------ controls
function buildLegend() {
  const counts = {};
  S.data.nodes.forEach((n) => n.kind === "note" && (counts[n.group] = (counts[n.group] || 0) + 1));
  const items = S.data.groups.map((g, i) => [i, g.name, g.color]);
  if (counts[-1]) items.push([-1, "Uncategorized", UNGROUPED]);
  $("legend").innerHTML = items.map(([i, name, c]) =>
    `<button data-g="${i}" title="Show / hide"><span class="dot" style="background:${c}"></span>${esc(name)} <span class="muted">${counts[i] || 0}</span></button>`).join("");
  $("legend").querySelectorAll("button").forEach((b) => b.onclick = () => {
    const g = +b.dataset.g;
    S.hiddenGroups.has(g) ? S.hiddenGroups.delete(g) : S.hiddenGroups.add(g);
    b.classList.toggle("off");
    S.renderer.refresh({ skipIndexation: true });
  });
}
function bindControls() {
  $("show-people").onchange = (e) => { S.showPeople = e.target.checked; S.renderer.refresh({ skipIndexation: true }); };
  $("min-venues").oninput = (e) => { S.minVenues = +e.target.value; $("min-venues-out").textContent = e.target.value; S.renderer.refresh({ skipIndexation: true }); };
  $("layout-btn").onclick = () => setLayout(!S.layoutOn);
  $("fit-btn").onclick = () => S.renderer.getCamera().animatedReset({ duration: 500 });
  $("toggle-panel").onclick = () => { document.body.classList.toggle("panel-hidden"); setTimeout(() => S.renderer.resize(), 0); };
  const input = $("search");
  let sel = 0;
  input.oninput = () => { sel = 0; runSearch(input.value); };
  input.onblur = () => setTimeout(() => ($("results").hidden = true), 150);
  input.onkeydown = (e) => {
    const hits = $("results")._hits || [];
    const lis = $("results").querySelectorAll("li[data-k]");
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      sel = Math.max(0, Math.min(lis.length - 1, sel + (e.key === "ArrowDown" ? 1 : -1)));
      lis.forEach((li, k) => li.setAttribute("aria-selected", k === sel));
    } else if (e.key === "Enter" && hits[sel]) pick(hits[sel][0]);
    else if (e.key === "Escape") $("results").hidden = true;
  };
}

// ------------------------------------------------------------------ routing (#note/<id>, #person/<name>)
function openNode(n) {
  const node = S.data.nodes[n];
  location.hash = node.kind === "note" ? `note/${n}` : `person/${encodeURIComponent(node.label)}`;
}
function route() {
  const h = decodeURIComponent(location.hash.slice(1));
  if (h.startsWith("note/")) {
    const id = +h.slice(5);
    if (S.data.nodes[id]) { S.selected = id; showNote(id); flyTo(id); }
  } else if (h.startsWith("person/")) {
    const name = h.slice(7);
    const pid = S.personNode.get(name.toLowerCase());
    S.selected = pid ?? null;
    showPerson(name);
    if (pid !== undefined) flyTo(pid);
  } else {
    S.selected = null;
    showWelcome();
  }
  refocus();
}
window.addEventListener("hashchange", route);

marked.setOptions({ breaks: true });
bindControls();
load().catch((err) => {
  console.error(err);
  $("reader").innerHTML = `<p>Couldn't load <code>data/graph.json</code>. Run <code>python3 build_graph.py</code> and serve the <code>_site</code> folder.</p>`;
});
})();
