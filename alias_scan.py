#!/usr/bin/env python3
"""Scan an Obsidian vault for [[wikilink]] targets that look like the same
person/entity under multiple aliases. Outputs a markdown report.
Modeled on extract_links.py in the vault."""
import os, re, sys, unicodedata
from collections import defaultdict
from difflib import SequenceMatcher

VAULT = sys.argv[1] if len(sys.argv) > 1 else "."
OUT = sys.argv[2] if len(sys.argv) > 2 else "alias_report.md"

LINK_RE = re.compile(r'\[\[([^\]]+)\]\]')

def strip_accents(s):
    return ''.join(c for c in unicodedata.normalize('NFKD', s) if not unicodedata.combining(c))

def squash(name):
    """Aggressive key: accents stripped, lowercase, alnum only."""
    return re.sub(r'[^a-z0-9]', '', strip_accents(name).lower())

def tokens(name):
    return [t for t in re.split(r'[\s.]+', strip_accents(name).lower()) if t]

# --- collect link targets and where they appear ---
usage = defaultdict(lambda: defaultdict(int))  # name -> {source_file: count}
for dirpath, dirnames, filenames in os.walk(VAULT):
    dirnames[:] = [d for d in dirnames if not d.startswith('.')]
    for fn in filenames:
        if not fn.lower().endswith('.md') or fn == 'Alias Report.md': continue
        rel = os.path.relpath(os.path.join(dirpath, fn), VAULT)
        try:
            content = open(os.path.join(dirpath, fn), encoding='utf-8').read()
        except Exception:
            continue
        for m in LINK_RE.findall(content):
            target = m.split('|')[0].split('#')[0].strip()  # [[Target|alias]] / [[Target#sec]]
            if target:
                usage[target][rel] += 1

names = sorted(usage)

# --- tier 1: identical squashed keys ---
by_key = defaultdict(list)
for n in names:
    k = squash(n)
    if k: by_key[k].append(n)
strong = [v for v in by_key.values() if len(v) > 1]
in_strong = {n for grp in strong for n in grp}

# --- tier 2: fuzzy, same surname (last token), high similarity ---
by_surname = defaultdict(list)
for n in names:
    t = tokens(n)
    if len(t) >= 2:  # only multi-token names (people-ish)
        by_surname[t[-1]].append(n)

fuzzy = []
seen_pairs = set()
for surname, group in by_surname.items():
    if len(group) < 2: continue
    for i in range(len(group)):
        for j in range(i+1, len(group)):
            a, b = group[i], group[j]
            if squash(a) == squash(b): continue  # already in strong tier
            ta, tb = tokens(a), tokens(b)
            # initial-vs-fullname match: first tokens compatible?
            fa, fb = ta[0], tb[0]
            initial_compat = fa[0] == fb[0] and (len(fa) <= 2 or len(fb) <= 2 or fa == fb)
            ratio = SequenceMatcher(None, squash(a), squash(b)).ratio()
            # middle-name variant: one name's tokens are a subset of the other's
            subset = set(ta) <= set(tb) or set(tb) <= set(ta)
            if (ratio >= 0.87) or (initial_compat and subset):
                key = tuple(sorted((a, b)))
                if key not in seen_pairs:
                    seen_pairs.add(key)
                    fuzzy.append((max(ratio, 0.99 if subset else ratio), a, b))
fuzzy.sort(reverse=True)

# --- report ---
def oddchars(n):
    notes = []
    if '\xa0' in n: notes.append("non-breaking space")
    if n != n.strip(): notes.append("leading/trailing space")
    if '  ' in n: notes.append("double space")
    return f" \u26a0\ufe0f {', '.join(notes)}" if notes else ""

def fmt_name(n):
    files = usage[n]
    total = sum(files.values())
    top = sorted(files, key=files.get, reverse=True)[:3]
    return f"  - `[[{n}]]`{oddchars(n)} — {total} use(s) in {len(files)} file(s), e.g. {', '.join(top)}"

lines = [f"# Alias duplicate scan", f"Vault: {os.path.basename(os.path.abspath(VAULT))} — {len(names)} distinct link targets\n"]
lines.append(f"## Strong candidates (identical after normalizing punctuation/spacing/accents): {len(strong)}\n")
for grp in sorted(strong, key=lambda g: -sum(sum(usage[n].values()) for n in g)):
    lines.append(f"- **{' ≈ '.join(grp)}**")
    for n in grp: lines.append(fmt_name(n))
    lines.append("")
lines.append(f"## Fuzzy candidates (same surname, similar/subset names — review needed): {len(fuzzy)}\n")
for ratio, a, b in fuzzy:
    lines.append(f"- **{a} ≈ {b}** (similarity {ratio:.2f})")
    lines.append(fmt_name(a)); lines.append(fmt_name(b)); lines.append("")

open(OUT, 'w', encoding='utf-8').write('\n'.join(lines))
print(f"{len(names)} targets | {len(strong)} strong groups | {len(fuzzy)} fuzzy pairs -> {OUT}")
