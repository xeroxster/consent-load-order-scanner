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
