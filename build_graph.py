#!/usr/bin/env python3
"""
build_graph.py — turn this Obsidian vault into data for the web explorer.

Usage:
    python3 build_graph.py            # builds into ./_site
    python3 build_graph.py --out dist

What it writes (into the output folder):
    index.html, app.js, style.css   copied from ./site/
    data/graph.json                 notes + "bridge" people + edges + color groups
    data/people.json                every linked name -> the notes that link it
    data/notes/<n>.txt              raw text of each note (loaded on demand)
    data/files/...                  embedded attachments (![[image.png]])

Each block below is independent — tweak one without touching the others.
"""
import argparse, json, re, shutil
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SKIP_DIRS = {".git", ".obsidian", ".trash", ".github", "site", "_site", "node_modules"}
MIN_BRIDGE = 2  # a person becomes a graph node when linked from this many notes

# ---------------------------------------------------------------- block: find notes
def find_notes(root):
    notes = []
    for p in sorted(root.rglob("*.md")):
        rel = p.relative_to(root)
        if any(part in SKIP_DIRS for part in rel.parts):
            continue
        notes.append(rel)
    return notes

# ---------------------------------------------------------------- block: parse links
LINK_RE = re.compile(r"(!?)\[\[([^\]]+?)\]\]")
TAG_RE = re.compile(r"(?:^|\s)#([A-Za-z][\w/-]*)")

def link_target(raw):
    """[[Target|Alias]] -> Target ; [[Target#Heading]] -> Target ; handles \\| in tables."""
    raw = raw.replace("\\|", "|")
    target = raw.split("|", 1)[0]
    if "#" in target:
        before = target.split("#", 1)[0]
        target = before if before.strip() else target.lstrip("#")
    target = target.strip()
    if not target:  # e.g. [[|Nicté Toxqui]] — fall back to the alias text
        target = raw.split("|", 1)[-1].strip()
    return target

def parse_note(text):
    links, embeds = [], []
    for bang, raw in LINK_RE.findall(text):
        t = link_target(raw)
        if not t:
            continue
        (embeds if bang else links).append(t)
    tags = sorted(set(TAG_RE.findall(text)))
    return links, embeds, tags

# ---------------------------------------------------------------- block: color groups
def load_groups(root):
    """Read Obsidian's own graph color groups so the web colors match."""
    cfg = root / ".obsidian" / "graph.json"
    groups = []
    if cfg.exists():
        data = json.loads(cfg.read_text(encoding="utf-8"))
        for g in data.get("colorGroups", []):
            m = re.match(r'\s*path:\s*"?([^"]+?)"?\s*$', g.get("query", ""))
            if not m:
                continue
            rgb = g["color"]["rgb"]
            groups.append({"name": m.group(1).strip(), "query": m.group(1).strip(),
                           "color": "#%06x" % rgb})
    return groups

def group_for(rel, groups):
    path = rel.as_posix()
    for i, g in enumerate(groups):  # first match wins, like Obsidian
        if g["query"].lower() in path.lower():
            return i
    return -1

# ---------------------------------------------------------------- block: build graph
def build(root, out):
    notes = find_notes(root)
    groups = load_groups(root)
    by_name = {n.stem.lower(): i for i, n in enumerate(notes)}

    nodes, edges = [], set()
    person_links = defaultdict(set)   # person name -> {note index}
    person_label = {}                  # lowercase -> first spelling seen
    attachments = set()

    for i, rel in enumerate(notes):
        text = (root / rel).read_text(encoding="utf-8", errors="replace")
        links, embeds, tags = parse_note(text)
        people = set()
        for t in links:
            key = t.lower()
            if key in by_name:
                j = by_name[key]
                if j != i:
                    edges.add((i, j))
            else:
                person_label.setdefault(key, t)
                person_links[key].add(i)
                people.add(key)
        attachments.update(embeds)
        nodes.append({"id": i, "label": rel.stem, "path": rel.as_posix(),
                      "folder": rel.parent.as_posix() if rel.parent.as_posix() != "." else "",
                      "group": group_for(rel, groups), "tags": tags,
                      "people": len(people), "kind": "note"})

    # bridges: people linked from 2+ notes become nodes
    n_notes = len(nodes)
    people_index = {}
    for key, srcs in sorted(person_links.items()):
        people_index[person_label[key]] = sorted(srcs)
        if len(srcs) >= MIN_BRIDGE:
            pid = len(nodes)
            nodes.append({"id": pid, "label": person_label[key], "kind": "person",
                          "group": -1, "venues": len(srcs)})
            for s in srcs:
                edges.add((s, pid))

    graph = {
        "groups": groups,
        "nodes": nodes,
        "edges": sorted(edges),
        "stats": {"notes": n_notes, "people": len(person_links),
                  "bridges": len(nodes) - n_notes,
                  "links": sum(len(v) for v in person_links.values()),
                  "minBridge": MIN_BRIDGE},
    }
    write_site(root, out, notes, graph, people_index, attachments)
    return graph["stats"]

# ---------------------------------------------------------------- block: write files
def write_site(root, out, notes, graph, people_index, attachments):
    if out.exists():
        shutil.rmtree(out)
    (out / "data" / "notes").mkdir(parents=True)
    (out / "data" / "files").mkdir(parents=True)

    site_src = root / "site"
    if site_src.exists():
        for f in site_src.iterdir():
            if f.is_file():
                shutil.copy2(f, out / f.name)
    (out / ".nojekyll").write_text("")

    (out / "data" / "graph.json").write_text(
        json.dumps(graph, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (out / "data" / "people.json").write_text(
        json.dumps(people_index, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    for i, rel in enumerate(notes):
        shutil.copy2(root / rel, out / "data" / "notes" / f"{i}.txt")

    # attachments are looked up by file name anywhere in the vault (Obsidian-style)
    for name in attachments:
        hits = [p for p in root.rglob(name) if not any(s in SKIP_DIRS for s in p.relative_to(root).parts)]
        if hits:
            shutil.copy2(hits[0], out / "data" / "files" / name)

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="_site")
    args = ap.parse_args()
    stats = build(ROOT, ROOT / args.out)
    print("Built:", json.dumps(stats))
