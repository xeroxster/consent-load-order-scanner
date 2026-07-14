# Consent Load-Order Scanner (Chrome extension)

Interactive extension to review how a website loads cookies and tags in relation to a consent manager. Browse to any site, click **Scan this site**, and the extension reloads the page with a clean cookie jar while recording:

1. Every cookie placed (HTTP `Set-Cookie`, JS `document.cookie`, and cookies
observed via `chrome.cookies.onChanged`), each with a timestamp
2. Every network request, with known trackers classified (GA, GTM, Meta, Adobe, etc.)
3. Whether a consent manager loads, when it was requested, whether its API is
present and its banner visible
4. A verdict: **PASS** (CMP requested before any non-CMP cookie/tracker),
**REVIEW** (things fired first — highlighted red), or **NO CMP DETECTED**

## Install (load unpacked — no store needed)

1. Open `chrome://extensions` (works in Edge/Brave/etc. too)
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** and select this folder
4. Pin the extension, browse to a site, click the icon → **Scan this site**

## How the scan works

* Clears the site's cookies, localStorage, and caches so the reload behaves like a
first visit with no consent stored
* Reloads the tab (cache bypassed) with listeners attached from navigation start
* A hook injected at `document\\\_start` timestamps every `document.cookie` write
* \~4 s after page load completes, it inspects the page for CMP globals and banner,
computes the verdict, and shows results in the popup (JSON/CSV export included)
* The toolbar badge shows progress: `…` scanning, `OK` pass, `!` review/no CMP

## Notes \& limitations

* **Keep the tab focused during the scan** (\~5–35 s). Navigating away mid-scan
aborts the page-side collection.
* Third-party cookies from *other* sites you've visited aren't cleared (only the
scanned site's state is), so a rare tracker may skip re-setting a cookie it
already has. For a fully pristine run, use a fresh profile or the Python script.
* "Before CMP?" compares against the moment the CMP script was **requested** —
the strictest, most defensible baseline.
* Detected CMPs: TrustArc, OneTrust, Cookiebot, Didomi, Usercentrics,
Sourcepoint, Quantcast Choice, Osano, CookieYes, Iubenda, Termly,
Complianz, Borlabs, Klaro, plus a generic IAB TCF fallback (`\\\_\\\_tcfapi` /
`\\\*.mgr.consensu.org`) when a TCF CMP is present but not specifically
identified. To add more, extend `CMP\\\_SIGNATURES` at the top of
`background.js` (URL markers, JS globals, DOM selectors, own cookie names —
a trailing `\\\*` in a cookie name matches as a prefix).
* Usercentrics stores consent in localStorage rather than cookies, so its
"own cookies" footprint is minimal by design.
* MV3 service workers can be suspended by Chrome, but the scan's event stream
keeps it alive for the \~35 s window in practice.

## Author

Ryan Vinelli, 2026

## 

