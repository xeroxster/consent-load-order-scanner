# Consent Load-Order Scanner (Chrome extension)

Interactive extension to review how a website loads cookies and tags in relation to a consent manager. This is very useful to test if anything is loading prior to a required action for consent compliance. Browse to any site, click **Scan this site**, and the extension reloads the page with a clean cookie jar while recording:

1. Every cookie placed (HTTP `Set-Cookie`, JS `document.cookie`, and cookies
observed via `chrome.cookies.onChanged`), each with a timestamp
2. Every network request, with known trackers classified (GA, GTM, Meta, Adobe, etc.)
3. Whether a consent manager loads, when it was requested, whether its API is
present and its banner visible
4. A verdict: **PASS** (CMP requested before any non-CMP cookie/tracker),
**REVIEW** (things fired first — highlighted red), or **NO CMP DETECTED**
5. The **origin** of each tag and cookie: hardcoded in the page HTML, delivered
through a tag manager (Google Tag Manager, gtag.js, Adobe Launch/DTM, Tealium iQ,
Segment, Ensighten), or injected at runtime by another script (piggybacking)
6. A **consent withdrawal test**: whether tracking actually stops once you
withdraw consent through the site's own controls (see below)

## Install (load unpacked — no store needed)

1. Open `chrome://extensions` (works in Edge/Brave/etc. too)
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** and select this folder
4. Pin the extension, browse to a site, click the icon → **Scan this site**

## How the scan works

* Clears the site's cookies, localStorage, and caches so the reload behaves like a
first visit with no consent stored
* Reloads the tab (cache bypassed) with listeners attached from navigation start
* A hook injected at `document_start` timestamps every `document.cookie` write
(capturing the writer's call stack) and records every script element injected at
runtime (with the injector's call stack)
* ~4 s after page load completes, it inspects the page for CMP globals and banner,
computes the verdict, and shows results in the popup (JSON/CSV export included)
* The toolbar badge shows progress: `…` scanning, `OK` pass, `!` review/no CMP

## Tag origin attribution

Each script request and JS-set cookie gets an **Origin** label:

* **Hardcoded (HTML)** — a `<script>` tag written directly into the page source
* **Hardcoded (inline script)** — set by inline JavaScript in the page source
* **Via Google Tag Manager / Adobe Launch / Tealium / …** — delivered through a
tag manager; resolved recursively, so a tracker loaded by a script that GTM
injected still attributes to GTM
* **Injected by \<host\>** — loaded at runtime by another (non-tag-manager)
script: piggybacking, worth reviewing in audits
* **Unknown / —** — attribution needs a script call stack, so image pixels,
XHR beacons, and HTTP-response cookies can't always be attributed; scripts and
JS-set cookies can

## Consent withdrawal test

A separate, collapsible panel ("Consent withdrawal test") tests the other half of
consent compliance: does tracking actually stop once a user withdraws consent?
This does **not** reload the page — reloading would wipe the consent state being
tested — so it works alongside your normal browsing:

1. **Start test** — snapshots the site's current cookies and starts recording every
network request and cookie change from that moment.
2. Interact with the page as a real visitor would: accept the consent banner,
browse around so trackers/cookies get set.
3. Use the site's **own** controls to withdraw consent — reject all, disable
categories, "Do Not Sell," reopen preferences and opt out, whatever it offers.
4. **Mark withdrawal** the instant after you've done that. The extension then
watches for 15 more seconds and reports:
   * **Verdict**: PASS if no tracker request fired after the mark, REVIEW listing
   the offending host(s) if one did — a live outbound request after withdrawal is
   the strongest evidence that processing continued past the point of withdrawal.
   * **Consent cookie check**: whether the CMP's own consent-state cookie (e.g.
   `OptanonConsent`, `CookieConsent`, `euconsent-v2`) actually changed value after
   the mark — a sanity check that the withdrawal registered with the CMP at all.
   * **Cookies still present**: non-CMP cookies that existed before the mark and
   remain in the jar afterward. Reported separately and not part of the verdict,
   since a stale, unused cookie is a weaker signal than a live request — plenty of
   compliant sites leave inert cookies in place rather than deleting them outright.

Click **Reset** to clear the test and run it again (e.g., on a different page or
after fixing something).

## Notes & limitations

* **Keep the tab focused during the scan** (~5–35 s). Navigating away mid-scan
aborts the page-side collection.
* Third-party cookies from *other* sites you've visited aren't cleared (only the
scanned site's state is), so a rare tracker may skip re-setting a cookie it
already has. For a fully pristine run, use a fresh browser profile.
* "Before CMP?" compares against the moment the CMP script was **requested** —
the strictest, most defensible baseline.
* Detected CMPs: TrustArc, OneTrust, Cookiebot, Didomi, Usercentrics,
Sourcepoint, Quantcast Choice, Osano, CookieYes, Iubenda, Termly,
Complianz, Borlabs, Klaro, plus a generic IAB TCF fallback (`__tcfapi` /
`*.mgr.consensu.org`) when a TCF CMP is present but not specifically
identified. To add more, extend `CMP_SIGNATURES` at the top of
`background.js` (URL markers, JS globals, DOM selectors, own cookie names —
a trailing `*` in a cookie name matches as a prefix).
* Usercentrics stores consent in localStorage rather than cookies, so its
"own cookies" footprint is minimal by design.
* Origin attribution is a heuristic based on wrapping `appendChild`/`insertBefore`
and capturing call stacks; scripts inserted via `document.write` or exotic
methods may show as hardcoded. Full per-request initiator chains would require
the `chrome.debugger` API.
* MV3 service workers can be suspended by Chrome, but the scan's event stream
keeps it alive for the ~35 s window in practice.

## Update log

### v0.3.3 — 2026-07-22
* Fixed the withdrawal panel disappearing (and its "Test consent withdrawal"
button doing nothing) after a scan completed. The panel was nested inside the
same container the scan results get drawn into, so finishing a scan wiped it
out along with its buttons. It's now a permanent sibling section that survives
every scan re-render.

### v0.3.2 — 2026-07-22
* Fixed a dead end in the withdrawal panel: "Mark withdrawal" started disabled
until a test was running, with no obvious way to recover. It's now a single
dynamic button — "Mark withdrawal" while a test is monitoring, and "Reset" at
every other point (before starting, mid-countdown, after results, or on
error) — so there's always something clickable to move the test forward or
restart it. A failed mark attempt also falls back to Reset automatically.

### v0.3.1 — 2026-07-22
* A **"Test consent withdrawal →"** button appears in the scan results, right
next to the export buttons, so you can jump straight from a completed scan
into the withdrawal test without hunting for the collapsed panel

### v0.3.0 — 2026-07-22
* **Consent withdrawal test**: a new panel that monitors the live tab (no
reload) while you accept consent, browse, then withdraw it through the site's
own controls; reports whether any tracker request fires after the marked
withdrawal point, whether the CMP's own consent cookie changed value, and
which non-CMP cookies remain present afterward
* Manual "Mark withdrawal" trigger with a 15-second post-mark monitoring window

### v0.2.0 — 2026-07-15
* **Tag origin attribution**: every script request and JS-set cookie is labeled
Hardcoded (HTML), Hardcoded (inline script), Via \<tag manager\> (GTM, gtag.js,
Adobe Launch/DTM, Tealium iQ, Segment, Ensighten), or Injected by \<host\>
(piggybacking); resolved recursively through injection chains
* Page hook now records runtime script injections and cookie-write call stacks
* Origin column added to both popup tables, origin summary added to the scan
overview, and origin field added to CSV/JSON exports
* Version and updated date shown in the popup header (version reads live from
`manifest.json`)
* Long values (cookie names, domains, hosts, origins) truncate with "…" and show
the full text on hover; columns use percentage widths so the layout adapts to
any popup width/resolution; exports always contain untruncated data
* Origin column in the Tags & third-party table widened and set to wrap so the
full attribution is always visible

### v0.1.1 — 2026-07-14
* CMP detection expanded from TrustArc to 14 providers: OneTrust, Cookiebot,
Didomi, Usercentrics, Sourcepoint, Quantcast Choice, Osano, CookieYes, Iubenda,
Termly, Complianz, Borlabs, Klaro, plus a generic IAB TCF fallback
* CMP own-cookie matching supports prefix patterns (trailing `*`)
* MIT license and standalone LICENSE file added

### v0.1.0 — 2026-07-14
* Initial release: one-click scan of the current site with a clean cookie jar
* Records cookies (HTTP, JS, observed) and network requests with timestamps
* TrustArc CMP detection (script URLs, JS API, banner, own cookies)
* Load-order verdict (PASS / REVIEW / NO CMP DETECTED) with pre-CMP violations
highlighted; toolbar badge status; JSON/CSV export
