#!/usr/bin/env node
/*
 * layout.js — settle the map once, at build time, and save the positions.
 *
 * Usage (after build_graph.py):
 *     npm install            # first time only: installs the two layout libraries
 *     node layout.js         # reads and updates _site/data/graph.json
 *     node layout.js dist    # if you built into another folder
 *
 * For every mode in site/modes.js it starts from the same seeded "pie", runs
 * ForceAtlas2 to the end, scales the result to a common size, and stores it as
 * graph.json -> layouts -> { modeName: [x0, y0, x1, y1, ...] } (one pair per node).
 * The page then shows the settled map instantly and glides between modes.
 */
const fs = require("fs");
const path = require("path");
const { Graph } = require("graphology");
const fa2 = require("graphology-layout-forceatlas2");
const { LAYOUT, MODES, makeRandom, seedPositions, fa2Settings } = require("./site/modes.js");

const out = process.argv[2] || "_site";
const file = path.join(__dirname, out, "data", "graph.json");
const data = JSON.parse(fs.readFileSync(file, "utf8"));

// same seed for every mode, so the two layouts share an orientation and the glide reads well
const seed = seedPositions(data, makeRandom(LAYOUT.seed));
const SIZE = 1000; // every layout is scaled to fit a circle of this radius

data.layouts = {};
for (const mode of Object.keys(MODES)) {
  const t0 = Date.now();
  const g = new Graph({ type: "undirected" });
  for (const n of data.nodes) g.addNode(n.id, { x: seed.x[n.id], y: seed.y[n.id] });
  for (const [a, b] of data.edges) if (!g.hasEdge(a, b)) g.addEdge(a, b);
  fa2.assign(g, { iterations: LAYOUT.buildSteps, settings: fa2Settings(fa2, g, mode) });

  // centre and scale
  let cx = 0, cy = 0;
  g.forEachNode((_, a) => { cx += a.x; cy += a.y; });
  cx /= g.order; cy /= g.order;
  let r = 0;
  g.forEachNode((_, a) => { r = Math.max(r, Math.hypot(a.x - cx, a.y - cy)); });
  const k = SIZE / (r || 1);
  const flat = new Array(data.nodes.length * 2);
  g.forEachNode((id, a) => {
    flat[id * 2] = Math.round((a.x - cx) * k * 10) / 10;
    flat[id * 2 + 1] = Math.round((a.y - cy) * k * 10) / 10;
  });
  data.layouts[mode] = flat;
  console.log(`layout ${mode}: ${g.order} nodes, ${LAYOUT.buildSteps} steps, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

fs.writeFileSync(file, JSON.stringify(data));
console.log("Saved positions into", path.relative(process.cwd(), file));
