#!/usr/bin/env python3
"""Normalize vault text so wiki-link aliases match, before alias scanning.

SCOPE — deliberately narrow:
  Vault-wide (invisible characters are always errors):
    1. non-breaking space -> regular space; zero-width space -> removed
  INSIDE [[wikilinks]] ONLY (these affect link identity; elsewhere they are
  legitimate prose typography, URLs, or table alignment and must be left alone):
    2. curly/slanted quotes -> straight quotes
    3. double spaces        -> single space
    4. missing space after an initial -> [[E.M. de Melo]] -> [[E. M. de Melo]]
       (single capital + period + capital; ACRONYMS below are exempt)
  Note files whose names change under 2-4 are renamed to match, so links stay intact.

Usage: python3 normalize_chars.py [VAULT_DIR] [--dry]
"""
import os, re, sys

args = [a for a in sys.argv[1:] if not a.startswith('-')]
DRY   = '--dry' in sys.argv
VAULT = args[0] if args else "."

INVISIBLE = {'\xa0': ' ', '​': ''}
QUOTES    = {'‘': "'", '’': "'", '‛': "'", '′': "'",
             '“': '"', '”': '"', '„': '"', '″': '"'}

# initial runs that are acronyms/collectives, not people — left alone
ACRONYMS = {'U.S.', 'U.S.A.', 'U.K.', 'U.N.', 'E.U.', 'A.I.', 'D.C.',
            'A.D.', 'A.M.', 'P.M.', 'M.A.', 'B.A.', 'M.S.', 'B.S.',
            'PH.D.', 'M.F.A.', 'B.F.A.', 'D.I.Y.', 'R.I.P.',
            'F.A.T.', 'E.V.', 'C.N.S.'}

RUN  = re.compile(r'(?<![A-Za-z0-9])((?:[A-Z]\.){1,5})(?=[A-Z])')
LINK = re.compile(r'\[\[([^\[\]\n]+)\]\]')

def space_initials(s):
    def fix(m):
        run  = m.group(1)
        nxt  = m.string[m.end():m.end()+2]
        full = run + nxt if nxt.endswith('.') else run
        if run.upper() in ACRONYMS or full.upper() in ACRONYMS:
            return run
        return run.replace('.', '. ').rstrip() + ' '
    return RUN.sub(fix, s)

def normalize_target(s):
    """Apply rules 2-4 to the inside of a wikilink (or to a note filename)."""
    for k, v in QUOTES.items(): s = s.replace(k, v)
    s = re.sub(r'  +', ' ', s)
    return space_initials(s).strip()

def fix_links(text):
    """Rewrite only the text inside [[...]]; everything else untouched."""
    def one(m):
        inner = m.group(1)
        if not inner.strip():          # leave empty/whitespace-only links alone
            return m.group(0)
        # keep |display-alias and #section structure intact, normalize each part
        parts = re.split(r'([|#])', inner)
        return '[[' + ''.join(p if p in '|#' else normalize_target(p) for p in parts) + ']]'
    return LINK.sub(one, text)

changes, renames = {}, []
for dirpath, dirnames, filenames in os.walk(VAULT):
    dirnames[:] = [d for d in dirnames if not d.startswith('.')]
    for fn in filenames:
        if not fn.lower().endswith('.md') or fn == 'Alias Report.md': continue
        p = os.path.join(dirpath, fn)
        try: orig = open(p, encoding='utf-8').read()
        except Exception: continue
        c = orig
        for k, v in INVISIBLE.items(): c = c.replace(k, v)   # vault-wide
        c = fix_links(c)                                     # links only
        if c != orig: changes[p] = c
        stem = fn[:-3]
        new_stem = normalize_target(stem.replace('\xa0', ' ').replace('​', ''))
        if new_stem != stem:
            renames.append((p, os.path.join(dirpath, new_stem + '.md')))

if DRY:
    print(f"[DRY RUN] {len(changes)} file(s) would change, {len(renames)} rename(s)")
    for p, c in list(changes.items())[:5]:
        orig = open(p, encoding='utf-8').read()
        for a, b in zip(orig.split('\n'), c.split('\n')):
            if a != b: print(f"  {os.path.basename(p)}:\n    - {a[:100]}\n    + {b[:100]}"); break
    for old, new in renames: print(f"  RENAME: {os.path.basename(old)} -> {os.path.basename(new)}")
else:
    for p, c in changes.items(): open(p, 'w', encoding='utf-8').write(c)
    for old, new in renames:
        if os.path.exists(new): print(f"  ! skipped rename, target exists: {os.path.basename(new)}"); continue
        os.rename(old, new); print(f"  renamed: {os.path.basename(old)} -> {os.path.basename(new)}")
    print(f"Normalized {len(changes)} file(s)" if changes or renames else "Nothing to normalize - vault already clean")
