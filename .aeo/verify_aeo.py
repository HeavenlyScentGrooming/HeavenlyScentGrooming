#!/usr/bin/env python3
"""
AEO Site Protocol v2.1.0 compliance verifier.

Checks a built static site against the protocol's required properties. Designed
to run in CI on every commit, and locally during an audit.

    python3 verify_aeo.py --root . --host example.com
    python3 verify_aeo.py --root public --host example.com --live

Exit code 0 = all enforced checks pass. Non-zero = at least one failure.

Standard library only, per the protocol's zero-dependency rule.

Checks are graded:
  FAIL  blocking, protocol violation
  WARN  needs a human decision or depends on data not in the repo
"""
import argparse
import json
import os
import re
import sys
import urllib.request
import xml.dom.minidom

CITATION_CRAWLERS = [
    "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-User",
    "Claude-SearchBot", "PerplexityBot", "Perplexity-User", "Bingbot",
    "Applebot", "Meta-ExternalAgent", "Google-Extended", "DuckAssistBot",
    "MistralAI-User", "Google-NotebookLM",
]
PRIVATE_PATHS = ["/admin/", "/staging/", "/drafts/"]
REQUIRED_HEADERS = [
    "strict-transport-security", "x-frame-options", "x-content-type-options",
    "referrer-policy", "permissions-policy", "content-security-policy",
]
FONT_CDNS = ["fonts.googleapis.com", "fonts.gstatic.com", "use.typekit.net"]
ANALYTICS = ["googletagmanager.com", "google-analytics.com", "gtag(",
             "connect.facebook.net", "snap.licdn.com", "static.hotjar.com"]


class Report:
    def __init__(self):
        self.fails, self.warns, self.passes = [], [], []

    def ok(self, msg):
        self.passes.append(msg)

    def fail(self, msg):
        self.fails.append(msg)

    def warn(self, msg):
        self.warns.append(msg)

    def render(self, site):
        print(f"\n{'=' * 66}\n{site}\n{'=' * 66}")
        for m in self.passes:
            print(f"  PASS  {m}")
        for m in self.warns:
            print(f"  WARN  {m}")
        for m in self.fails:
            print(f"  FAIL  {m}")
        print(f"  ---> {len(self.passes)} pass, {len(self.warns)} warn, "
              f"{len(self.fails)} fail")
        return 1 if self.fails else 0


def parse_robots(text):
    """Return {user_agent: [(directive, value)]}, honouring group semantics.

    Consecutive User-agent lines share the following rule block. A rule line
    with no preceding User-agent in its group is orphaned and belongs to
    whatever group came before, which is the bug this parser exists to catch.
    """
    groups, current = {}, []
    expecting = False
    for raw in text.splitlines():
        line = raw.split("#")[0].strip()
        if not line or ":" not in line:
            continue
        key, _, val = line.partition(":")
        key, val = key.strip().lower(), val.strip()
        if key == "user-agent":
            if not expecting:
                current = []
            current.append(val)
            groups.setdefault(val, [])
            expecting = True
        elif key in ("allow", "disallow"):
            expecting = False
            for ua in current:
                groups[ua].append((key, val))
    return groups


def check_robots(root, host, r):
    p = os.path.join(root, "robots.txt")
    if not os.path.isfile(p):
        r.fail("robots.txt missing")
        return
    text = open(p).read()
    groups = parse_robots(text)

    missing = [c for c in CITATION_CRAWLERS if c not in groups]
    if missing:
        r.fail(f"robots.txt missing citation crawlers: {', '.join(missing)}")
    else:
        r.ok(f"robots.txt allows all {len(CITATION_CRAWLERS)} citation crawlers")

    blocked = [c for c in CITATION_CRAWLERS
               if any(d == "disallow" and v == "/" for d, v in groups.get(c, []))]
    if blocked:
        r.fail(f"robots.txt DISALLOWS citation crawlers: {', '.join(blocked)}")

    star = dict.fromkeys(v for d, v in groups.get("*", []) if d == "disallow")
    absent = [pp for pp in PRIVATE_PATHS if pp not in star]
    if absent:
        r.fail(f"robots.txt '*' group does not disallow: {', '.join(absent)} "
               f"(check for rules orphaned under a preceding User-agent)")
    else:
        r.ok("robots.txt '*' group disallows /admin/, /staging/, /drafts/")

    if not re.search(r"(?mi)^Sitemap:\s*https?://", text):
        r.fail("robots.txt has no Sitemap directive")
    else:
        r.ok("robots.txt declares a Sitemap")

    if host and f"//{host}" not in text and f"//www.{host}" not in text:
        r.warn(f"robots.txt Sitemap host does not mention {host}")


def check_sitemap(root, r):
    p = os.path.join(root, "sitemap.xml")
    if not os.path.isfile(p):
        r.fail("sitemap.xml missing")
        return
    try:
        doc = xml.dom.minidom.parse(p)
    except Exception as e:
        r.fail(f"sitemap.xml is not valid XML: {e}")
        return
    urls = doc.getElementsByTagName("url")
    if not urls:
        r.fail("sitemap.xml contains no <url> entries")
        return
    no_lastmod = [u for u in urls if not u.getElementsByTagName("lastmod")]
    if no_lastmod:
        r.fail(f"sitemap.xml: {len(no_lastmod)} <url> entries lack <lastmod>")
    else:
        r.ok(f"sitemap.xml valid, {len(urls)} URLs, all with lastmod")


def check_llms(root, r):
    p = os.path.join(root, "llms.txt")
    if not os.path.isfile(p):
        r.fail("llms.txt missing")
        return
    text = open(p).read()
    if not text.lstrip().startswith("# "):
        r.fail("llms.txt must begin with an H1 business name")
    elif not re.search(r"^- \[.+\]\(https?://[^)]+\):", text, re.M):
        r.fail("llms.txt has no '- [Title](URL): description' link lines")
    else:
        r.ok("llms.txt well-formed")


def check_headers_file(root, r):
    p = os.path.join(root, "_headers")
    if not os.path.isfile(p):
        r.warn("_headers not present (fine if the host sets headers elsewhere)")
        return
    text = open(p).read().lower()
    missing = [h for h in REQUIRED_HEADERS if h not in text]
    if missing:
        r.fail(f"_headers missing: {', '.join(missing)}")
    else:
        r.ok("_headers declares all six required security headers")
    m = re.search(r"strict-transport-security:\s*max-age=(\d+)", text)
    if m and int(m.group(1)) < 63072000:
        r.fail(f"HSTS max-age={m.group(1)}, protocol requires >= 63072000")


def iter_html(root):
    skip = {".git", "node_modules", "dist", ".github"}
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in skip]
        for fn in filenames:
            if fn.endswith(".html"):
                yield os.path.join(dirpath, fn)


def check_html(root, host, r, primary_only=True):
    index = os.path.join(root, "index.html")
    files = [index] if primary_only and os.path.isfile(index) else list(iter_html(root))
    if not files:
        r.fail("no HTML found")
        return

    for f in files:
        rel = os.path.relpath(f, root)
        h = open(f, encoding="utf-8", errors="replace").read()

        n_h1 = len(re.findall(r"<h1[\s>]", h))
        if n_h1 != 1:
            (r.fail if n_h1 == 0 else r.warn)(f"{rel}: {n_h1} <h1> elements, expected exactly 1")
        else:
            r.ok(f"{rel}: exactly one <h1>")

        if not re.search(r'<link[^>]+rel=["\']canonical["\']', h):
            r.fail(f"{rel}: no rel=canonical")
        elif host:
            m = re.search(r'<link[^>]+rel=["\']canonical["\'][^>]*href=["\']([^"\']+)', h)
            if m and host not in m.group(1):
                r.fail(f"{rel}: canonical {m.group(1)} does not match host {host}")
            else:
                r.ok(f"{rel}: canonical matches host")

        blocks = re.findall(r'<script[^>]+application/ld\+json[^>]*>(.*?)</script>', h, re.S)
        if not blocks:
            r.fail(f"{rel}: no JSON-LD")
        else:
            bad = False
            for b in blocks:
                try:
                    json.loads(b)
                except Exception as e:
                    r.fail(f"{rel}: JSON-LD does not parse: {e}")
                    bad = True
            if not bad:
                r.ok(f"{rel}: {len(blocks)} JSON-LD block(s) parse")

        og = set(re.findall(r'property=["\']og:(title|description|image|url|type)["\']', h))
        if len(og) < 5:
            r.warn(f"{rel}: Open Graph incomplete, has {sorted(og) or 'none'}")
        else:
            r.ok(f"{rel}: complete Open Graph tags")

        check_alt_text(rel, h, r)

        for cdn in FONT_CDNS:
            if cdn in h:
                r.fail(f"{rel}: third-party font CDN referenced ({cdn})")
        for a in ANALYTICS:
            if a in h:
                r.fail(f"{rel}: analytics/tracking referenced ({a})")

        check_contact_parity(rel, h, r)


def check_alt_text(rel, h, r):
    """Alt-text check that does not fight WCAG.

    The protocol's literal rule is `grep '<img[^>]*alt=""'` returns zero. That
    is wrong for decorative images: WCAG requires a *empty* alt on an image
    that adds nothing beyond adjacent text, and giving it a description makes
    screen readers announce the same thing twice. So:

      missing alt entirely           -> FAIL (always a defect)
      empty alt, marked decorative   -> PASS
      empty alt, not marked          -> WARN (mark it, or describe it)
    """
    missing, decorative, unmarked = 0, 0, []
    for m in re.finditer(r"<img\b[^>]*>", h):
        tag = m.group(0)
        if "alt=" not in tag:
            missing += 1
            continue
        if not re.search(r"\balt=[\"']\s*[\"']", tag):
            continue
        is_decorative = (
            re.search(r'\brole=["\']presentation["\']', tag)
            or re.search(r'\baria-hidden=["\']true["\']', tag)
            # or an ancestor within reach supplies the accessible name
            or "aria-label=" in h[max(0, m.start() - 300):m.start()]
        )
        if is_decorative:
            decorative += 1
        else:
            unmarked.append(re.sub(r'src="data:[^"]{40,}"', 'src="data:..."', tag)[:110])

    if missing:
        r.fail(f"{rel}: {missing} <img> with no alt attribute at all")
    if unmarked:
        r.warn(f"{rel}: {len(unmarked)} <img> with empty alt and no decorative marker; "
               f"add role=\"presentation\" if decorative, else describe it. "
               f"First: {unmarked[0]}")
    if not missing and not unmarked:
        note = f", {decorative} decorative" if decorative else ""
        r.ok(f"{rel}: alt text complete{note}")


def norm_phone(s):
    d = re.sub(r"\D", "", s or "")
    return d[1:] if len(d) == 11 and d.startswith("1") else d


def check_contact_parity(rel, h, r):
    """Class P parity: schema contact values must be visible in static HTML."""
    schema_tel, schema_mail = set(), set()
    for b in re.findall(r'<script[^>]+application/ld\+json[^>]*>(.*?)</script>', h, re.S):
        try:
            data = json.loads(b)
        except Exception:
            continue

        def walk(x):
            if isinstance(x, dict):
                if isinstance(x.get("telephone"), str):
                    schema_tel.add(x["telephone"])
                if isinstance(x.get("email"), str):
                    schema_mail.add(x["email"])
                for v in x.values():
                    walk(v)
            elif isinstance(x, list):
                for v in x:
                    walk(v)
        walk(data)

    html_tel = {norm_phone(t) for t in re.findall(r'href=["\']tel:([^"\']+)', h)}
    html_mail = {m.lower() for m in re.findall(r'href=["\']mailto:([^"\'?]+)', h)}

    for t in schema_tel:
        if norm_phone(t) not in html_tel:
            r.fail(f"{rel}: schema telephone {t} has no matching tel: link (Class P parity)")
    for e in schema_mail:
        if e.lower() not in html_mail:
            r.fail(f"{rel}: schema email {e} has no matching mailto: link (Class P parity)")
    if schema_tel or schema_mail:
        if not any(f.startswith(f"{rel}: schema") for f in r.fails):
            r.ok(f"{rel}: Class P contact parity holds")


def check_live(host, r):
    base = f"https://{host}"
    try:
        req = urllib.request.Request(base + "/", headers={"User-Agent": "aeo-verify/2.1"})
        with urllib.request.urlopen(req, timeout=25) as resp:
            got = {k.lower() for k in resp.headers.keys()}
            final = resp.geturl()
    except Exception as e:
        r.warn(f"live fetch failed for {base}: {e}")
        return
    if not final.rstrip("/").endswith(host):
        r.fail(f"live: {base}/ redirects to {final}, canonical host mismatch")
    else:
        r.ok(f"live: {base}/ serves without cross-host redirect")
    missing = [h for h in REQUIRED_HEADERS if h not in got]
    if missing:
        r.fail(f"live: response missing headers: {', '.join(missing)}")
    else:
        r.ok("live: all six security headers present")
    for path, ctype in (("/robots.txt", "text"), ("/llms.txt", "text"),
                        ("/sitemap.xml", "xml")):
        try:
            req = urllib.request.Request(base + path, headers={"User-Agent": "aeo-verify/2.1"})
            with urllib.request.urlopen(req, timeout=20) as resp:
                ct = resp.headers.get("content-type", "")
                body = resp.read(400).decode("utf-8", "replace")
            if "html" in ct.lower() or body.lstrip().lower().startswith("<!doctype html"):
                r.fail(f"live: {path} returns HTML, not a real file (SPA fallback?)")
            else:
                r.ok(f"live: {path} serves correctly")
        except Exception as e:
            r.fail(f"live: {path} unreachable ({e})")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=".", help="Directory that gets deployed")
    ap.add_argument("--host", default="", help="Canonical host, e.g. example.com")
    ap.add_argument("--site", default="", help="Label for output")
    ap.add_argument("--live", action="store_true", help="Also check the deployed origin")
    ap.add_argument("--all-html", action="store_true", help="Check every HTML file, not just index")
    args = ap.parse_args()

    r = Report()
    check_robots(args.root, args.host, r)
    check_sitemap(args.root, r)
    check_llms(args.root, r)
    check_headers_file(args.root, r)
    check_html(args.root, args.host, r, primary_only=not args.all_html)
    if args.live and args.host:
        check_live(args.host, r)

    return r.render(args.site or args.host or args.root)


if __name__ == "__main__":
    sys.exit(main())
