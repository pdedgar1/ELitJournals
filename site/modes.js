/* modes.js — the map's layout settings (used by app.js).
 *
 * ================================================================== TWEAKABLE NUMBERS
 * The map is force-directed and settles live in the visitor's browser, like Obsidian's graph.
 * Change a number here, save, and push (or preview locally).
 */
(function (root) {
"use strict";

const LAYOUT = {
  steps: 600,          // how many animation steps before the layout stops moving
  slowDown: 6,         // higher = calmer, smaller moves per step; lower = faster but jittery
  seedRadius: 800,     // size of the starting "pie" the groups begin in (Antarctica wedges)
  seed: 2024,          // random seed for the starting positions: same number = same start every visit
};

// The forces — the web equivalent of Obsidian's Graph "Forces" sliders.
const FORCES = {
  gravity: 0.005,      // Center force: pull toward the middle. 0 = none, 1 = strong. (Obsidian: 0.00–0.01)
                       //   Keep it above 0, or loosely connected nodes drift off forever.
  scalingRatio: 40,    // Repel force: how hard nodes push apart, relative to the links pulling them together. (Obsidian: 19)
  hubsSpread: true,    // true = big hubs (EBR, ELO) don't drag everything into one clump
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

// ForceAtlas2 settings (fa2 = the graphology-layout-forceatlas2 module).
function fa2Settings(fa2, graph) {
  return { ...fa2.inferSettings(graph), barnesHutOptimize: true, slowDown: LAYOUT.slowDown,
    gravity: FORCES.gravity, scalingRatio: FORCES.scalingRatio,
    outboundAttractionDistribution: FORCES.hubsSpread };
}

const api = { LAYOUT, FORCES, makeRandom, seedPositions, fa2Settings };
if (typeof module !== "undefined" && module.exports) module.exports = api;
else root.ELIT_LAYOUT = api;
})(typeof window !== "undefined" ? window : globalThis);
