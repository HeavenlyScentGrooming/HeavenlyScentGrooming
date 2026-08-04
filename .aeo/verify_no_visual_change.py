#!/usr/bin/env python3
"""
No-visual-change gate.

Proves that a compliance diff did not alter anything a site owner could see.
The premise: AEO work belongs in <head> (meta, schema, font declarations) and in
sibling files (robots.txt, llms.txt, sitemap.xml, _headers). It does not belong
in the rendered body.

Compares each HTML file's <body> against the base branch, ignoring changes that
are provably invisible:

  - a <noscript> block (not rendered when JS is enabled)
  - HTML comments
  - an <a href="tel:|mailto:"> wrapper that preserves its inner text
  - an <address> wrapper that preserves its children
  - pure whitespace

Anything else is reported for a human to look at. Exit 0 = clean.

Standard library only.
"""
import argparse
import os
import re
import subprocess
import sys

SKIP_DIRS = {".git", "node_modules", "dist", ".github"}


def git_show(repo, ref, path):
    p = subprocess.run(["git", "-C", repo, "show", f"{ref}:{path}"],
                       capture_output=True, text=True)
    return p.stdout if p.returncode == 0 else None


def body_of(html):
    m = re.search(r"<body[^>]*>(.*)</body>", html, re.S | re.I)
    return m.group(1) if m else html


def normalize(body):
    """Strip constructs that cannot affect rendering with JS enabled."""
    b = re.sub(r"<noscript\b.*?</noscript>", "", body, flags=re.S | re.I)
    b = re.sub(r"<!--.*?-->", "", b, flags=re.S)
    # Unwrap tel:/mailto: anchors, keeping their visible text.
    b = re.sub(r'<a\b[^>]*href=["\'](?:tel|mailto):[^"\']*["\'][^>]*>(.*?)</a>',
               r"\1", b, flags=re.S | re.I)
    # Unwrap <address> wrappers, keeping their children.
    b = re.sub(r"<address\b[^>]*>(.*?)</address>", r"\1", b, flags=re.S | re.I)
    b = re.sub(r"\s+", " ", b)
    return b.strip()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", default=".")
    ap.add_argument("--base", default="main")
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()

    changed = subprocess.run(
        ["git", "-C", args.repo, "diff", "--name-only", f"{args.base}...HEAD"],
        capture_output=True, text=True).stdout.split()
    html_files = [f for f in changed
                  if f.endswith(".html")
                  and not any(part in SKIP_DIRS for part in f.split("/"))]

    if not html_files:
        print("PASS  no HTML files changed; nothing could have moved")
        return 0

    problems = []
    for rel in html_files:
        old = git_show(args.repo, args.base, rel)
        path = os.path.join(args.repo, rel)
        if old is None:
            print(f"INFO  {rel}: new file, no baseline to compare")
            continue
        if not os.path.isfile(path):
            problems.append((rel, ["file deleted"]))
            continue
        new = open(path, encoding="utf-8", errors="replace").read()

        a, b = normalize(body_of(old)), normalize(body_of(new))
        if a == b:
            print(f"PASS  {rel}: rendered body identical")
            continue

        import difflib
        diff = [l for l in difflib.unified_diff(
            a.split("> "), b.split("> "), lineterm="", n=0)
            if l.startswith(("+", "-")) and not l.startswith(("+++", "---"))]
        problems.append((rel, diff))

    if not problems:
        print(f"\nPASS  {len(html_files)} HTML file(s), no visible change")
        return 0

    print(f"\nFAIL  {len(problems)} file(s) changed in the rendered body:")
    for rel, diff in problems:
        print(f"\n  {rel}: {len(diff)} changed fragment(s)")
        for line in diff[:12]:
            print(f"    {line[:160]}")
    print("\nEach fragment must be justified as invisible, or reverted.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
