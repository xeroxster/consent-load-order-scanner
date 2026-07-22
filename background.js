// Consent Load-Order Scanner - service worker (v0.2.0)
// Orchestrates a scan: clears site state, instruments the tab, reloads it,
// records requests + cookies with timestamps, detects the CMP, computes a
// load-order verdict, and attributes each tag/cookie to hardcoded HTML,
// a tag manager, or another injecting script. Results are stored in
// chrome.storage.session and rendered by the popup.

// ---------------------------------------------------------------------------
// CMP signatures. Order matters: specific CMPs first, the generic IAB TCF
// fallback last (URL/global matching returns the first hit).
// own_cookies entries ending in "*" are treated as name prefixes.
// ---------------------------------------------------------------------------
const CMP_SIGNATURES = {
  TrustArc: {
    url_markers: [
      'consent.trustarc.com',
      'consent.truste.com',
      'choices.trustarc.com',
      'choices-cdn.trustarc.com',
      'trustarc.mgr.consensu.org',
      'consent-pref.trustarc.com'
    ],
    js_globals: ['truste', 'PrivacyManagerAPI'],
    dom_selectors: [
      '#consent_blackbar',
      '#truste-consent-track',
      '#truste-consent-content',
      '#truste-show-consent',
      '.truste_box_overlay'
    ],
    own_cookies: [
      'notice_behavior',
      'notice_preferences',
      'notice_gdpr_prefs',
      'notice_poptime',
      'cmapi_cookie_privacy',
      'cmapi_gtm_bl',
      'TAconsentID'
    ]
  },
  OneTrust: {
    url_markers: [
      'cdn.cookielaw.org',
      'cookielaw.org/scripttemplates',
      'cdn.onetrust.com',
      'geolocation.onetrust.com',
      'onetrust.mgr.consensu.org',
      'otSDKStub.js'
    ],
    js_globals: ['OneTrust', 'OnetrustActiveGroups', 'Optanon'],
    dom_selectors: [
      '#onetrust-banner-sdk',
      '#onetrust-consent-sdk',
      '#onetrust-pc-sdk',
      '.optanon-alert-box-wrapper'
    ],
    own_cookies: ['OptanonConsent', 'OptanonAlertBoxClosed', 'OptanonControl']
  },
  Cookiebot: {
    url_markers: [
      'consent.cookiebot.com',
      'consentcdn.cookiebot.com',
      'consent.cookiebot.eu'
    ],
    js_globals: ['Cookiebot'],
    dom_selectors: ['#CybotCookiebotDialog', '#CookiebotWidget'],
    own_cookies: ['CookieConsent', 'CookieConsentBulkSetting-*']
  },
  Didomi: {
    url_markers: ['sdk.privacy-center.org', 'api.privacy-center.org'],
    js_globals: ['Didomi', 'didomiOnReady'],
    dom_selectors: ['#didomi-host', '#didomi-notice', '#didomi-popup'],
    own_cookies: ['didomi_token']
  },
  Usercentrics: {
    url_markers: [
      'app.usercentrics.eu',
      'api.usercentrics.eu',
      'web.cmp.usercentrics.eu',
      'aggregator.service.usercentrics.eu',
      'uct.service.usercentrics.eu'
    ],
    js_globals: ['UC_UI', '__ucCmp'],
    dom_selectors: ['#usercentrics-root', '#usercentrics-cmp-ui'],
    own_cookies: ['uc_settings']
  },
  Sourcepoint: {
    url_markers: [
      'cdn.privacy-mgmt.com',
      'sp-prod.net',
      'sourcepoint.mgr.consensu.org'
    ],
    js_globals: ['_sp_'],
    dom_selectors: [
      "div[id^='sp_message_container']",
      "iframe[id^='sp_message_iframe']"
    ],
    own_cookies: ['consentUUID', 'sp_landing', 'sp_su']
  },
  'Quantcast Choice': {
    url_markers: ['cmp.quantcast.com', 'quantcast.mgr.consensu.org'],
    js_globals: [],
    dom_selectors: ['#qc-cmp2-container', '#qc-cmp2-ui'],
    own_cookies: []
  },
  Osano: {
    url_markers: ['cmp.osano.com'],
    js_globals: ['Osano'],
    dom_selectors: ['.osano-cm-window', '.osano-cm-dialog'],
    own_cookies: ['osano_consentmanager*']
  },
  CookieYes: {
    url_markers: ['cdn-cookieyes.com', 'app.cookieyes.com'],
    js_globals: ['getCkyConsent'],
    dom_selectors: ['.cky-consent-container', '.cky-consent-bar', '.cky-modal'],
    own_cookies: ['cookieyes-consent']
  },
  Iubenda: {
    url_markers: ['cdn.iubenda.com', 'cs.iubenda.com', 'idb.iubenda.com'],
    js_globals: ['_iub'],
    dom_selectors: ['#iubenda-cs-banner', '.iubenda-cs-container'],
    own_cookies: ['_iub_cs-*']
  },
  Termly: {
    url_markers: ['app.termly.io'],
    js_globals: ['Termly'],
    dom_selectors: ['#termly-code-snippet-support', '#termly-consent-banner'],
    own_cookies: []
  },
  'Complianz (WordPress)': {
    url_markers: ['complianz-gdpr'],
    js_globals: ['complianz', 'cmplz_banner'],
    dom_selectors: ['#cmplz-cookiebanner-container', '.cmplz-cookiebanner'],
    own_cookies: ['cmplz_*']
  },
  'Borlabs (WordPress)': {
    url_markers: ['borlabs-cookie'],
    js_globals: ['BorlabsCookie'],
    dom_selectors: ['#BorlabsCookieBox', '#BorlabsCookieWidget'],
    own_cookies: ['borlabs-cookie']
  },
  Klaro: {
    url_markers: ['klaro.js', 'cdn.kiprotect.com/klaro'],
    js_globals: ['klaro'],
    dom_selectors: ['#klaro', '.klaro .cookie-notice'],
    own_cookies: ['klaro']
  },
  'IAB TCF CMP (unidentified)': {
    url_markers: ['.mgr.consensu.org'],
    js_globals: ['__tcfapi', '__gpp'],
    dom_selectors: [],
    own_cookies: ['euconsent-v2', 'eupubconsent-v2', 'usprivacy', 'us_privacy']
  }
};

// ---------------------------------------------------------------------------
// Tag manager signatures (substring match on the LOADING script's URL)
// ---------------------------------------------------------------------------
const TAG_MANAGERS = {
  'Google Tag Manager': ['googletagmanager.com/gtm.js'],
  'Google tag (gtag.js)': ['googletagmanager.com/gtag/js'],
  'Adobe Launch/DTM': ['adobedtm.com'],
  'Tealium iQ': ['tiqcdn.com', 'utag.js'],
  'Segment': ['cdn.segment.com', 'cdn.segment.io'],
  'Ensighten': ['nexus.ensighten.com']
};

const TRACKER_DOMAINS = {
  'google-analytics.com': 'Google Analytics',
  'analytics.google.com': 'Google Analytics',
  'googletagmanager.com': 'Google Tag Manager',
  'doubleclick.net': 'Google Ads/DoubleClick',
  'googleadservices.com': 'Google Ads',
  'googlesyndication.com': 'Google AdSense',
  'connect.facebook.net': 'Meta Pixel',
  'facebook.com': 'Meta',
  'hotjar.com': 'Hotjar',
  'clarity.ms': 'Microsoft Clarity',
  'bat.bing.com': 'Microsoft Ads (UET)',
  'px.ads.linkedin.com': 'LinkedIn Insight',
  'snap.licdn.com': 'LinkedIn Insight',
  'analytics.tiktok.com': 'TikTok Pixel',
  'static.ads-twitter.com': 'X/Twitter Pixel',
  'segment.com': 'Segment',
  'segment.io': 'Segment',
  'amplitude.com': 'Amplitude',
  'mixpanel.com': 'Mixpanel',
  'heapanalytics.com': 'Heap',
  'fullstory.com': 'FullStory',
  'quantserve.com': 'Quantcast',
  'scorecardresearch.com': 'Comscore',
  'criteo.com': 'Criteo',
  'criteo.net': 'Criteo',
  'adroll.com': 'AdRoll',
  'taboola.com': 'Taboola',
  'outbrain.com': 'Outbrain',
  'hs-scripts.com': 'HubSpot',
  'hs-analytics.net': 'HubSpot',
  'track.hubspot.com': 'HubSpot',
  'marketo.net': 'Marketo',
  'mktoresp.com': 'Marketo',
  'pardot.com': 'Pardot',
  'demandbase.com': 'Demandbase',
  '6sc.co': '6sense',
  'drift.com': 'Drift',
  'intercom.io': 'Intercom',
  'ws.zoominfo.com': 'ZoomInfo',
  'mc.yandex.ru': 'Yandex Metrica',
  'matomo.cloud': 'Matomo',
  'nr-data.net': 'New Relic',
  'cdn.pendo.io': 'Pendo',
  'qualtrics.com': 'Qualtrics',
  'omtrdc.net': 'Adobe Analytics',
  'demdex.net': 'Adobe Audience Manager',
  'adobedtm.com': 'Adobe Launch',
  'everesttech.net': 'Adobe Advertising',
  'tealiumiq.com': 'Tealium',
  'tiqcdn.com': 'Tealium',
  'ensighten.com': 'Ensighten',
  'branch.io': 'Branch',
  'bizible.com': 'Bizible',
  'chartbeat.com': 'Chartbeat',
  'parsely.com': 'Parse.ly',
  'onesignal.com': 'OneSignal',
  'addtoany.com': 'AddToAny',
  'sharethis.com': 'ShareThis'
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function registrableDomain(host) {
  if (!host) return '';
  const parts = host.toLowerCase().split('.');
  const second = parts[parts.length - 2];
  if (parts.length >= 3 && ['co', 'com', 'org', 'net', 'gov', 'ac', 'edu'].includes(second)) {
    return parts.slice(-3).join('.');
  }
  return parts.length >= 2 ? parts.slice(-2).join('.') : host;
}

function hostOf(url) {
  try { return new URL(url).hostname; } catch (e) { return ''; }
}

function classifyTracker(host) {
  host = (host || '').toLowerCase();
  for (const [dom, name] of Object.entries(TRACKER_DOMAINS)) {
    if (host === dom || host.endsWith('.' + dom) || host.includes(dom)) return name;
  }
  return null;
}

function matchCmpUrl(url) {
  for (const [name, sig] of Object.entries(CMP_SIGNATURES)) {
    if (sig.url_markers.some((m) => url.includes(m))) return name;
  }
  return null;
}

function cmpOwnCookie(name) {
  for (const [cmpName, sig] of Object.entries(CMP_SIGNATURES)) {
    for (const pattern of sig.own_cookies) {
      if (pattern.endsWith('*')) {
        if (name.startsWith(pattern.slice(0, -1))) return cmpName;
      } else if (name === pattern) {
        return cmpName;
      }
    }
  }
  return null;
}

function matchTagManager(url) {
  for (const [name, markers] of Object.entries(TAG_MANAGERS)) {
    if (markers.some((m) => (url || '').includes(m))) return name;
  }
  return null;
}

function stripLineCol(url) {
  return (url || '').replace(/:\d+:\d+$/, '');
}

function firstUrlInStack(stackStr) {
  const m = /https?:\/\/[^\s\)\|]+/.exec(stackStr || '');
  return m ? stripLineCol(m[0]) : null;
}

function noHash(url) {
  return (url || '').split('#')[0];
}

async function setState(patch) {
  const { scan } = await chrome.storage.session.get('scan');
  await chrome.storage.session.set({ scan: { ...(scan || {}), ...patch } });
}

// ---------------------------------------------------------------------------
// Origin attribution (hardcoded vs tag-managed vs injected).
// injectMap: script URL -> injector call stack (from the page hook). A script
// request NOT in the map was loaded by a <script> tag in the HTML (hardcoded).
// ---------------------------------------------------------------------------
function resolveScriptOrigin(url, injectMap, pageUrl, depth = 0) {
  if (depth > 8) return 'Unknown';
  const stack = injectMap.get(noHash(url));
  if (stack === undefined) return 'Hardcoded (HTML)';
  const setter = firstUrlInStack(stack);
  if (!setter) return 'Injected (unknown source)';
  if (noHash(setter) === noHash(pageUrl)) return 'Hardcoded (inline script)';
  const tm = matchTagManager(setter);
  if (tm) return `Via ${tm}`;
  if (noHash(setter) === noHash(url)) return 'Unknown';
  const parent = resolveScriptOrigin(setter, injectMap, pageUrl, depth + 1);
  if (parent.startsWith('Via ')) return parent;
  return `Injected by ${hostOf(setter) || '?'}`;
}

function cookieOrigin(stackStr, injectMap, pageUrl) {
  const setter = firstUrlInStack(stackStr);
  if (!setter) return 'Unknown';
  if (noHash(setter) === noHash(pageUrl)) return 'Hardcoded (inline script)';
  const tm = matchTagManager(setter);
  if (tm) return `Via ${tm}`;
  const label = resolveScriptOrigin(setter, injectMap, pageUrl);
  const host = hostOf(setter) || '?';
  if (label.startsWith('Via ')) return `${label} (${host})`;
  if (label.startsWith('Hardcoded')) return `Script on page (${host})`;
  if (label.startsWith('Injected')) return `${label} -> ${host}`;
  return `Script (${host})`;
}

// ---------------------------------------------------------------------------
// Scan lifecycle
// ---------------------------------------------------------------------------
let active = null; // in-memory state for the running scan

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'START_SCAN') {
    startScan(msg.tabId)
      .then(() => sendResponse({ ok: true }))
      .catch(async (e) => {
        await setState({ status: 'error', error: String(e.message || e) });
        cleanup();
        sendResponse({ ok: false, error: String(e.message || e) });
      });
    return true; // async response
  }
  if (msg.type === 'WD_START') {
    startWithdrawalTest(msg.tabId)
      .then(() => sendResponse({ ok: true }))
      .catch(async (e) => {
        await setWDState({ status: 'error', error: String(e.message || e) });
        cleanupWD();
        sendResponse({ ok: false, error: String(e.message || e) });
      });
    return true;
  }
  if (msg.type === 'WD_MARK') {
    markWithdrawal()
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: String(e.message || e) }));
    return true;
  }
  if (msg.type === 'WD_RESET') {
    cleanupWD();
    chrome.storage.session.set({ withdrawal: { status: 'idle' } }).then(() => sendResponse({ ok: true }));
    return true;
  }
});

async function startScan(tabId) {
  if (active) throw new Error('A scan is already running');
  const tab = await chrome.tabs.get(tabId);
  if (!/^https?:/.test(tab.url || '')) throw new Error('Only http(s) pages can be scanned');

  const url = tab.url;
  const siteDomain = registrableDomain(new URL(url).hostname);

  active = {
    tabId,
    url,
    siteDomain,
    t0: null,
    requests: [],
    cookieEvents: [],
    httpCookies: new Map(), // name -> {t, domain, viaUrl}
    cmp: { detected: null, firstRequestMs: null, loadedMs: null, apiPresent: false, bannerVisible: false },
    finalized: false,
    listeners: {}
  };

  await setState({ status: 'scanning', url, siteDomain, startedAt: Date.now(), result: null, error: null });
  await chrome.action.setBadgeText({ text: '…' });
  await chrome.action.setBadgeBackgroundColor({ color: '#888888' });

  // 1. Clear the site's state so the scan reflects a first visit with no consent.
  try {
    await chrome.browsingData.remove(
      { origins: [new URL(url).origin] },
      { cookies: true, localStorage: true, cacheStorage: true, indexedDB: true, serviceWorkers: true }
    );
  } catch (e) { /* browsingData can fail on some setups; cookie removal below still runs */ }
  try {
    const cookies = await chrome.cookies.getAll({ domain: siteDomain });
    for (const c of cookies) {
      const cookieUrl = (c.secure ? 'https://' : 'http://') + c.domain.replace(/^\./, '') + c.path;
      await chrome.cookies.remove({ url: cookieUrl, name: c.name, storeId: c.storeId });
    }
  } catch (e) { /* non-fatal */ }

  // 2. Install the page hook (cookie writes + script injections) for the reload.
  try { await chrome.scripting.unregisterContentScripts({ ids: ['cookie-hook'] }); } catch (e) { /* not registered */ }
  await chrome.scripting.registerContentScripts([{
    id: 'cookie-hook',
    js: ['hook.js'],
    matches: ['<all_urls>'],
    runAt: 'document_start',
    world: 'MAIN',
    persistAcrossSessions: false
  }]);

  // 3. Listen, then reload.
  installListeners();
  await chrome.tabs.reload(tabId, { bypassCache: true });
  active.hardTimeout = setTimeout(() => finalize('timeout'), 35000);
}

function rel(epochMs) {
  if (!active || active.t0 === null) return 0;
  return Math.max(0, Math.round((epochMs - active.t0) * 10) / 10);
}

function installListeners() {
  const filter = { urls: ['<all_urls>'], tabId: active.tabId };
  const L = active.listeners;

  L.onBeforeNavigate = (d) => {
    if (d.tabId === active.tabId && d.frameId === 0 && active.t0 === null) active.t0 = d.timeStamp;
  };
  chrome.webNavigation.onBeforeNavigate.addListener(L.onBeforeNavigate);

  L.onRequest = (d) => {
    if (active.t0 === null && d.type === 'main_frame') active.t0 = d.timeStamp;
    const t = rel(d.timeStamp);
    const host = hostOf(d.url);
    const cmpName = matchCmpUrl(d.url);
    if (cmpName && active.cmp.firstRequestMs === null) {
      active.cmp.detected = cmpName;
      active.cmp.firstRequestMs = t;
    }
    if (active.requests.length < 2000) {
      active.requests.push({
        t,
        url: d.url.slice(0, 500),
        host,
        type: d.type,
        thirdParty: registrableDomain(host) !== active.siteDomain,
        tracker: classifyTracker(host),
        cmp: cmpName
      });
    }
  };
  chrome.webRequest.onBeforeRequest.addListener(L.onRequest, filter);

  L.onHeaders = (d) => {
    const t = rel(d.timeStamp);
    if (matchCmpUrl(d.url) && active.cmp.loadedMs === null) active.cmp.loadedMs = t;
    for (const h of d.responseHeaders || []) {
      if (h.name.toLowerCase() === 'set-cookie' && h.value) {
        const name = h.value.split('=')[0].trim();
        if (name && !active.httpCookies.has(name)) {
          active.httpCookies.set(name, { t, domain: hostOf(d.url), viaUrl: d.url });
        }
      }
    }
  };
  chrome.webRequest.onHeadersReceived.addListener(L.onHeaders, filter, ['responseHeaders', 'extraHeaders']);

  L.onCookieChanged = (info) => {
    if (info.removed || active.t0 === null) return;
    active.cookieEvents.push({
      t: rel(Date.now()),
      name: info.cookie.name,
      domain: (info.cookie.domain || '').replace(/^\./, ''),
      secure: info.cookie.secure,
      expirationDate: info.cookie.expirationDate || null
    });
  };
  chrome.cookies.onChanged.addListener(L.onCookieChanged);

  L.onCompleted = (d) => {
    if (d.tabId === active.tabId && d.frameId === 0) {
      setTimeout(() => finalize('completed'), 4000);
    }
  };
  chrome.webNavigation.onCompleted.addListener(L.onCompleted);
}

// Runs inside the page (MAIN world) at the end of the scan.
function collectPageData(sigs) {
  const out = { jsCookieLog: [], scriptInjectLog: [], apiPresent: false, bannerVisible: false, detected: null };
  try { out.jsCookieLog = (window.__jsCookieLog || []).slice(0, 500); } catch (e) {}
  try { out.scriptInjectLog = (window.__scriptInjectLog || []).slice(0, 1000); } catch (e) {}
  for (const [name, sig] of Object.entries(sigs)) {
    for (const g of sig.js_globals) {
      try {
        if (typeof window[g] !== 'undefined') { out.apiPresent = true; out.detected = out.detected || name; }
      } catch (e) {}
    }
    for (const sel of sig.dom_selectors) {
      try {
        const el = document.querySelector(sel);
        if (el) {
          out.detected = out.detected || name;
          const r = el.getBoundingClientRect();
          const st = getComputedStyle(el);
          if (r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none') {
            out.bannerVisible = true;
          }
        }
      } catch (e) {}
    }
  }
  return out;
}

async function finalize(reason) {
  if (!active || active.finalized) return;
  active.finalized = true;
  clearTimeout(active.hardTimeout);

  // Page-side data: JS cookie log, script injections, CMP globals/banner.
  let pageData = { jsCookieLog: [], scriptInjectLog: [], apiPresent: false, bannerVisible: false, detected: null };
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: active.tabId },
      world: 'MAIN',
      func: collectPageData,
      args: [CMP_SIGNATURES]
    });
    if (results && results[0] && results[0].result) pageData = results[0].result;
  } catch (e) { /* tab may have navigated away */ }

  active.cmp.apiPresent = pageData.apiPresent;
  active.cmp.bannerVisible = pageData.bannerVisible;
  active.cmp.detected = active.cmp.detected || pageData.detected;

  // Injection map for origin attribution (earliest injector per script URL).
  const injectMap = new Map();
  for (const e of pageData.scriptInjectLog || []) {
    const key = noHash(e.src);
    if (key && !injectMap.has(key)) injectMap.set(key, e.stack || '');
  }

  // Attribute origins to script requests (pixels/XHR can't be attributed
  // without the debugger API, so they get '—').
  for (const q of active.requests) {
    q.origin = q.type === 'script' ? resolveScriptOrigin(q.url, injectMap, active.url) : '—';
  }

  // Merge cookie observations, keeping the earliest sighting per name.
  const timed = new Map();
  const consider = (name, ev) => {
    if (!name) return;
    const cur = timed.get(name);
    if (!cur || ev.t < cur.t) timed.set(name, ev);
  };
  for (const [name, info] of active.httpCookies) {
    consider(name, {
      t: info.t, domain: info.domain, source: 'http',
      origin: resolveScriptOrigin(info.viaUrl, injectMap, active.url) === 'Hardcoded (HTML)'
        ? 'HTTP response (see request origin)'
        : resolveScriptOrigin(info.viaUrl, injectMap, active.url)
    });
  }
  for (const e of pageData.jsCookieLog) {
    const name = String(e.cookie || '').split('=')[0].trim();
    consider(name, {
      t: Math.round(e.t * 10) / 10, domain: hostOf(active.url), source: 'js',
      origin: cookieOrigin(e.stack || '', injectMap, active.url)
    });
  }
  for (const e of active.cookieEvents) {
    const cur = timed.get(e.name);
    if (!cur) timed.set(e.name, { t: e.t, domain: e.domain, source: 'observed', origin: 'Unknown' });
  }

  // Final jar for the site domain (what actually persisted).
  let jarNames = new Set();
  try {
    const jar = await chrome.cookies.getAll({ domain: active.siteDomain });
    jarNames = new Set(jar.map((c) => c.name));
  } catch (e) {}
  for (const e of active.cookieEvents) jarNames.add(e.name);

  const cookies = [];
  const allNames = new Set([...timed.keys(), ...jarNames]);
  for (const name of allNames) {
    const ev = timed.get(name);
    const domain = ev ? ev.domain : active.siteDomain;
    cookies.push({
      t: ev ? ev.t : null,
      name,
      domain,
      source: ev ? ev.source : 'unknown',
      origin: ev ? (ev.origin || 'Unknown') : 'Unknown',
      thirdParty: domain ? registrableDomain(domain) !== active.siteDomain : null,
      cmpCookie: cmpOwnCookie(name),
      inFinalJar: jarNames.has(name)
    });
  }
  cookies.sort((a, b) => (a.t === null) - (b.t === null) || (a.t || 0) - (b.t || 0));

  // Verdict
  const cmpT = active.cmp.firstRequestMs;
  const preCmpCookies = cookies.filter((c) => !c.cmpCookie && c.t !== null && cmpT !== null && c.t < cmpT);
  const preCmpTrackers = active.requests.filter((q) => q.tracker && !q.cmp && cmpT !== null && q.t < cmpT);
  const totalTrackers = active.requests.filter((q) => q.tracker && !q.cmp).length;
  const totalCookies = cookies.filter((c) => !c.cmpCookie).length;

  // Origin breakdown for tracker script requests
  const originCounts = {};
  for (const q of active.requests) {
    if (q.tracker && !q.cmp && q.origin && q.origin !== '—') {
      originCounts[q.origin] = (originCounts[q.origin] || 0) + 1;
    }
  }

  let verdict, verdictClass;
  if (!active.cmp.detected) {
    verdict = 'NO CMP DETECTED';
    verdictClass = 'bad';
  } else if (preCmpCookies.length === 0 && preCmpTrackers.length === 0) {
    verdict = 'PASS — CMP loads before cookies/tags';
    verdictClass = 'good';
  } else {
    verdict = `REVIEW — ${preCmpCookies.length} cookie(s) and ${preCmpTrackers.length} tracker request(s) before CMP`;
    verdictClass = 'warn';
  }

  const result = {
    reason,
    cmp: { ...active.cmp },
    cookies,
    requests: active.requests,
    verdict,
    verdictClass,
    stats: {
      totalCookies,
      totalTrackers,
      preCmpCookies: preCmpCookies.map((c) => c.name),
      preCmpTrackers: [...new Set(preCmpTrackers.map((q) => q.host))],
      totalRequests: active.requests.length,
      originCounts
    }
  };

  await setState({ status: 'done', finishedAt: Date.now(), result });
  await chrome.action.setBadgeText({ text: verdictClass === 'good' ? 'OK' : '!' });
  await chrome.action.setBadgeBackgroundColor({
    color: verdictClass === 'good' ? '#1a7f37' : verdictClass === 'warn' ? '#b35900' : '#c62828'
  });

  cleanup();
}

function cleanup() {
  if (!active) return;
  const L = active.listeners || {};
  try { if (L.onBeforeNavigate) chrome.webNavigation.onBeforeNavigate.removeListener(L.onBeforeNavigate); } catch (e) {}
  try { if (L.onCompleted) chrome.webNavigation.onCompleted.removeListener(L.onCompleted); } catch (e) {}
  try { if (L.onRequest) chrome.webRequest.onBeforeRequest.removeListener(L.onRequest); } catch (e) {}
  try { if (L.onHeaders) chrome.webRequest.onHeadersReceived.removeListener(L.onHeaders); } catch (e) {}
  try { if (L.onCookieChanged) chrome.cookies.onChanged.removeListener(L.onCookieChanged); } catch (e) {}
  chrome.scripting.unregisterContentScripts({ ids: ['cookie-hook'] }).catch(() => {});
  active = null;
}

// ---------------------------------------------------------------------------
// Consent withdrawal test
//
// Unlike the load-order scan, this does NOT reload the tab: reloading would
// wipe the very consent state we're trying to test. Instead it monitors the
// live tab continuously while you interact with the page normally:
//   1. WD_START  - snapshot the site's current cookies, start recording every
//                  request and cookie change from this moment on.
//   2. You use the site's own UI to grant consent, browse a bit, then use the
//      site's own "reject" / "withdraw" / "do not sell" control.
//   3. WD_MARK   - click "Mark withdrawal" the instant after you've withdrawn
//                  consent. This timestamps the boundary and schedules the
//                  verdict WD_MONITOR_MS later.
// The verdict is based on what happens AFTER the mark: any tracker request
// that still fires is live evidence that processing continued past
// withdrawal (the actual compliance-relevant behavior); cookies that persist
// unexpired are reported separately since a stale inert cookie is a weaker
// signal than a live outbound request.
// ---------------------------------------------------------------------------
const WD_MONITOR_MS = 15000;

let activeWD = null;

async function setWDState(patch) {
  const { withdrawal } = await chrome.storage.session.get('withdrawal');
  await chrome.storage.session.set({ withdrawal: { ...(withdrawal || {}), ...patch } });
}

async function snapshotCookies(domain) {
  const map = new Map();
  try {
    const cookies = await chrome.cookies.getAll({ domain });
    for (const c of cookies) map.set(c.name, { value: c.value, domain: c.domain, expirationDate: c.expirationDate || null });
  } catch (e) { /* non-fatal */ }
  return map;
}

function snapshotCmpCookies(cookieMap) {
  const out = {};
  for (const [name, info] of cookieMap) {
    const cmp = cmpOwnCookie(name);
    if (cmp) out[name] = { cmp, value: info.value };
  }
  return out;
}

async function startWithdrawalTest(tabId) {
  if (active) throw new Error('A load-order scan is currently running - let it finish first');
  if (activeWD) throw new Error('A withdrawal test is already running');
  const tab = await chrome.tabs.get(tabId);
  if (!/^https?:/.test(tab.url || '')) throw new Error('Only http(s) pages can be tested');

  const url = tab.url;
  const siteDomain = registrableDomain(new URL(url).hostname);
  const baseline = await snapshotCookies(siteDomain);

  activeWD = {
    tabId,
    url,
    siteDomain,
    t0: Date.now(),
    requests: [],
    cookieEvents: [],
    baselineNames: new Set(baseline.keys()),
    cmpSnapshotStart: snapshotCmpCookies(baseline),
    markedAtMs: null,
    finalized: false,
    listeners: {}
  };

  await setWDState({
    status: 'monitoring',
    url,
    siteDomain,
    startedAt: Date.now(),
    markedAt: null,
    result: null,
    error: null
  });

  installWDListeners();
}

function relWD(epochMs) {
  if (!activeWD) return 0;
  return Math.max(0, Math.round((epochMs - activeWD.t0) * 10) / 10);
}

function installWDListeners() {
  const filter = { urls: ['<all_urls>'], tabId: activeWD.tabId };
  const L = activeWD.listeners;

  L.onRequest = (d) => {
    const t = relWD(d.timeStamp);
    const host = hostOf(d.url);
    if (activeWD.requests.length < 4000) {
      activeWD.requests.push({
        t,
        host,
        type: d.type,
        thirdParty: registrableDomain(host) !== activeWD.siteDomain,
        tracker: classifyTracker(host),
        cmp: matchCmpUrl(d.url)
      });
    }
  };
  chrome.webRequest.onBeforeRequest.addListener(L.onRequest, filter);

  L.onCookieChanged = (info) => {
    activeWD.cookieEvents.push({
      t: relWD(Date.now()),
      name: info.cookie.name,
      domain: (info.cookie.domain || '').replace(/^\./, ''),
      removed: !!info.removed
    });
  };
  chrome.cookies.onChanged.addListener(L.onCookieChanged);
}

async function markWithdrawal() {
  if (!activeWD) throw new Error('Start a withdrawal test first');
  if (activeWD.markedAtMs !== null) throw new Error('Withdrawal already marked for this test');

  activeWD.markedAtMs = relWD(Date.now());
  const snap = await snapshotCookies(activeWD.siteDomain);
  activeWD.cmpSnapshotAtMark = snapshotCmpCookies(snap);

  await setWDState({ status: 'withdrawn', markedAt: Date.now() });
  activeWD.timeout = setTimeout(() => finalizeWithdrawal().catch(() => {}), WD_MONITOR_MS);
}

async function finalizeWithdrawal() {
  if (!activeWD || activeWD.finalized) return;
  activeWD.finalized = true;
  clearTimeout(activeWD.timeout);

  const finalSnap = await snapshotCookies(activeWD.siteDomain);
  const cmpSnapshotEnd = snapshotCmpCookies(finalSnap);

  const markT = activeWD.markedAtMs;
  const requestsAfterMark = activeWD.requests.filter((q) => q.tracker && !q.cmp && q.t >= markT);
  const trackerHostsAfter = [...new Set(requestsAfterMark.map((q) => q.host))];

  // Non-CMP cookies known before the mark (baseline or set/changed before it)
  // that are still present, unexpired, in the final snapshot.
  const knownBeforeMark = new Set(activeWD.baselineNames);
  for (const e of activeWD.cookieEvents) {
    if (!e.removed && e.t < markT) knownBeforeMark.add(e.name);
  }
  const stillPresent = [];
  for (const name of knownBeforeMark) {
    if (cmpOwnCookie(name)) continue;
    if (finalSnap.has(name)) stillPresent.push(name);
  }

  // Did the CMP's own consent-state cookie(s) actually change value once
  // withdrawal was marked? A sanity check that the CMP registered the action.
  let cmpConsentChanged = null;
  const beforeMap = activeWD.cmpSnapshotAtMark || activeWD.cmpSnapshotStart;
  const afterNames = new Set([...Object.keys(beforeMap), ...Object.keys(cmpSnapshotEnd)]);
  if (afterNames.size > 0) {
    cmpConsentChanged = false;
    for (const name of afterNames) {
      const before = beforeMap[name]?.value;
      const after = cmpSnapshotEnd[name]?.value;
      if (before !== after) { cmpConsentChanged = true; break; }
    }
  }

  let verdict, verdictClass;
  if (requestsAfterMark.length === 0) {
    verdict = 'PASS — no tracker requests observed after withdrawal was marked';
    verdictClass = 'good';
  } else {
    verdict = `REVIEW — ${requestsAfterMark.length} tracker request(s) fired after withdrawal (${trackerHostsAfter.slice(0, 5).join(', ')}${trackerHostsAfter.length > 5 ? ', …' : ''})`;
    verdictClass = 'bad';
  }

  const result = {
    verdict,
    verdictClass,
    monitorMs: WD_MONITOR_MS,
    markedAtMs: markT,
    requestsAfterMark,
    trackerHostsAfter,
    stillPresentCookies: stillPresent.sort(),
    cmpConsentChanged
  };

  await setWDState({ status: 'done', finishedAt: Date.now(), result });
  cleanupWD();
}

function cleanupWD() {
  if (!activeWD) return;
  clearTimeout(activeWD.timeout);
  const L = activeWD.listeners || {};
  try { if (L.onRequest) chrome.webRequest.onBeforeRequest.removeListener(L.onRequest); } catch (e) {}
  try { if (L.onCookieChanged) chrome.cookies.onChanged.removeListener(L.onCookieChanged); } catch (e) {}
  activeWD = null;
}
