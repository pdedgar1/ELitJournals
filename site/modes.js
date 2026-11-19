/* modes.js — layout settings shared by the page (app.js) and the build step (layout.js).
 *
 * ================================================================== TWEAKABLE NUMBERS
 * The map's layout is worked out ONCE when the site is built (by layout.js, in the
 * GitHub Action) and saved into data/graph.json, so visitors see a settled map instantly.
 * Change a number here, push, and the next build bakes in the new shape.
 */
(function (root) {
"use strict";

const LAYOUT = {
  startMode: "archipelago", // which mode the page opens in: "continent" or "archipelago"
  buildSteps: 800,          // layout steps run at build time (more = more settled, slower build)
  liveSteps: 600,           // steps for the in-browser fallback (only if positions weren't built)
  slowDown: 6,              // higher = calmer, smaller moves per step
  seedRadius: 800,          // size of the starting "pie" the groups begin in (Antarctica wedges)
  seed: 2024,               // random seed: same number = same map every build. Change it to "reshuffle".
  glideMs: 1100,            // how long the glide between modes takes, in milliseconds
};

// The two modes behind the ELO Continent / Archipelago toggle.
//   gravity      = Center force: pull toward the middle (0 = none, 1 = strong; Obsidian 0.00–0.01)
//   scalingRatio = Repel force: how hard nodes push apart (Obsidian 19)
//   hubsSpread   = true stops big hubs (EBR, ELO) dragging everything into one clump
//   linLog       = true pushes each community out toward its own "coastline"
const MODES = {
  continent:   { label: "ELO Continent", gravity: 0.6,   scalingRatio: 12, hubsSpread: false, linLog: false },
  archipelago: { label: "Archipelago",   gravity: 0.005, scalingRatio: 30, hubsSpread: true,  linLog: true  },
};
// ==================================================================

// Seeded random numbers, so the build is repeatable.
function makeRandom(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Starting positions: a pie around a pole, like the README's Antarctica image.
// ELO conferences near the centre, every other group in its own wedge;
// people start at the average position of the venues that name them.
// Returns {x: [...], y: [...]} indexed by node id.
function seedPositions(data, rand) {
  const groups = data.groups, sectors = groups.length + 1, n = data.nodes.length;
  const x = new Array(n).fill(0), y = new Array(n).fill(0);
  const eloIdx = groups.findIndex((g) => /ELO Conferences/i.test(g.name));
  for (const node of data.nodes) {
    if (node.kind !== "note") continue;
    const k = node.group >= 0 ? node.group : groups.length;
    const angle = (k / sectors) * Math.PI * 2 + rand() * (Math.PI * 2 / sectors);
    const r = node.group === eloIdx ? rand() * LAYOUT.seedRadius * 0.12 : LAYOUT.seedRadius * (0.35 + rand() * 0.65);
    x[node.id] = Math.cos(angle) * r; y[node.id] = Math.sin(angle) * r;
  }
  const sx = new Array(n).fill(0), sy = new Array(n).fill(0), cnt = new Array(n).fill(0);
  for (const [a, b] of data.edges) {
    if (data.nodes[b].kind === "person") { sx[b] += x[a]; sy[b] += y[a]; cnt[b]++; }
  }
  for (const node of data.nodes) {
    if (node.kind !== "person") continue;
    const d = cnt[node.id] || 1;
    x[node.id] = sx[node.id] / d + (rand() - 0.5) * 40;
    y[node.id] = sy[node.id] / d + (rand() - 0.5) * 40;
  }
  return { x, y };
}

// ForceAtlas2 settings for one mode (fa2 = the graphology-layout-forceatlas2 module).
function fa2Settings(fa2, graph, mode) {
  const m = MODES[mode];
  return { ...fa2.inferSettings(graph), barnesHutOptimize: true, slowDown: LAYOUT.slowDown,
    gravity: m.gravity, scalingRatio: m.scalingRatio,
    outboundAttractionDistribution: m.hubsSpread, linLogMode: m.linLog };
}

const api = { LAYOUT, MODES, makeRandom, seedPositions, fa2Settings };
if (typeof module !== "undefined" && module.exports) module.exports = api;
else root.ELIT_LAYOUT = api;
})(typeof window !== "undefined" ? window : globalThis);
