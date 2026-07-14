#!/usr/bin/env python3
"""Normalize problem characters in vault .md files before alias scanning.
Safe, mechanical fixes only: non-breaking spaces -> regular spaces,
curly/slanted quotes -> straight quotes. Skips Alias Report.md.
Prints a summary of what changed."""
import os, sys

VAULT = sys.argv[1] if len(sys.argv) > 1 else "."
REPL = {'\xa0': ' ',
        '‘': "'", '’': "'", '‛': "'", '′': "'",
        '“': '"', '”': '"', '„': '"', '″': '"'}

nfiles = nchars = 0
for dirpath, dirnames, filenames in os.walk(VAULT):
    dirnames[:] = [d for d in dirnames if not d.startswith('.')]
    for fn in filenames:
        if not fn.lower().endswith('.md') or fn == 'Alias Report.md': continue
        p = os.path.join(dirpath, fn)
        try:
            c = open(p, encoding='utf-8').read()
        except Exception:
            continue
        if any(k in c for k in REPL):
            n = sum(c.count(k) for k in REPL)
            for k, v in REPL.items(): c = c.replace(k, v)
            open(p, 'w', encoding='utf-8').write(c)
            nfiles += 1; nchars += n
print(f"Normalized {nchars} character(s) in {nfiles} file(s)" if nfiles else "Nothing to normalize — vault already clean")
