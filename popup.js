// Popup renderer. All scan state lives in chrome.storage.session (written by
// the service worker), so the popup can be closed/reopened during a scan.

const content = document.getElementById('content');
const scanBtn = document.getElementById('scanBtn');

// Version (from manifest.json) and last-updated date shown in the header.
const UPDATED = '2026-07-22'; // v0.3.3
try {
  document.getElementById('meta').textContent =
    `v${chrome.runtime.getManifest().version} · updated ${UPDATED}`;
} catch (e) { /* non-fatal */ }

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// Cell with ellipsis truncation (CSS) + full value on hover (title attribute).
function cell(value, extraHtml = '', cls = '') {
  const v = esc(value);
  return `<td${cls ? ` class="${cls}"` : ''} title="${v}">${v}${extraHtml}</td>`;
}

function fmtMs(t) {
  return t === null || t === undefined ? '—' : `${t} ms`;
}

async function getScan() {
  const { scan } = await chrome.storage.session.get('scan');
  return scan || { status: 'idle' };
}

scanBtn.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  scanBtn.disabled = true;
  const resp = await chrome.runtime.sendMessage({ type: 'START_SCAN', tabId: tab.id }).catch((e) => ({ ok: false, error: String(e) }));
  if (resp && !resp.ok) {
    content.innerHTML = `<div class="verdict bad">Could not start scan: ${esc(resp.error)}</div>`;
    scanBtn.disabled = false;
  }
});

chrome.storage.session.onChanged.addListener((changes) => {
  if (changes.scan) render(changes.scan.newValue);
  if (changes.withdrawal) renderWD(changes.withdrawal.newValue);
});

function render(scan) {
  scanBtn.disabled = scan.status === 'scanning';

  if (!scan || scan.status === 'idle') return;

  if (scan.status === 'scanning') {
    content.innerHTML = `
      <div class="url">${esc(scan.url)}</div>
      <div id="status"><span class="spinner">&#9696;</span> Scanning… the page is reloading with a clean cookie jar. Keep the tab in the foreground.</div>`;
    return;
  }

  if (scan.status === 'error') {
    content.innerHTML = `<div class="verdict bad">Scan failed: ${esc(scan.error)}</div>`;
    return;
  }

  const r = scan.result;
  if (!r) return;
  const cmpT = r.cmp.firstRequestMs;

  // Origin summary line for tracker scripts
  const originCounts = (r.stats && r.stats.originCounts) || {};
  const originSummary = Object.entries(originCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${v} ${k}`)
    .join(', ');

  // Cookies table (percentage widths adapt to the popup's rendered width)
  const cookieCols = `<colgroup>
      <col style="width:12%"><col style="width:26%"><col style="width:20%">
      <col style="width:8%"><col style="width:10%"><col style="width:24%">
    </colgroup>`;
  const cookieRows = r.cookies.map((c) => {
    const before = c.t === null || cmpT === null ? 'n/a' : c.t < cmpT ? 'YES' : 'no';
    const cls = c.cmpCookie ? 'cmp' : before === 'YES' ? 'pre' : '';
    return `<tr class="${cls}">
      <td class="num">${fmtMs(c.t)}</td>
      ${cell(c.name, c.cmpCookie ? ' <span class="tag">CMP</span>' : '')}
      ${cell(c.domain)}
      ${cell(c.source)}
      <td>${before}</td>
      ${cell(c.origin || 'Unknown')}
    </tr>`;
  }).join('');

  // Tags table: CMP requests, known trackers, and other third-party scripts/XHR
  const tagCols = `<colgroup>
      <col style="width:9%"><col style="width:24%"><col style="width:14%">
      <col style="width:8%"><col style="width:9%"><col style="width:36%">
    </colgroup>`;
  const tagReqs = r.requests.filter((q) => q.cmp || q.tracker || (q.thirdParty && ['script', 'xmlhttprequest', 'ping', 'image', 'sub_frame'].includes(q.type)));
  const seen = new Set();
  const tagRows = tagReqs.filter((q) => {
    const key = q.host + '|' + (q.tracker || q.cmp || q.type);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 200).map((q) => {
    const before = cmpT === null ? 'n/a' : q.t < cmpT ? 'YES' : 'no';
    const cls = q.cmp ? 'cmp' : before === 'YES' && q.tracker ? 'pre' : '';
    const tagCell = q.cmp
      ? `<td title="CMP: ${esc(q.cmp)}"><span class="tag">CMP: ${esc(q.cmp)}</span></td>`
      : cell(q.tracker || '');
    return `<tr class="${cls}">
      <td class="num">${fmtMs(q.t)}</td>
      ${cell(q.host)}
      ${tagCell}
      ${cell(q.type)}
      <td>${before}</td>
      ${cell(q.origin || '—', '', 'wrap')}
    </tr>`;
  }).join('');

  content.innerHTML = `
    <div class="url">${esc(scan.url)}</div>
    <div class="verdict ${r.verdictClass}">${esc(r.verdict)}</div>
    <div class="kv">
      <div>Consent manager</div><div>${esc(r.cmp.detected || 'none detected')}</div>
      <div>CMP requested</div><div>${fmtMs(r.cmp.firstRequestMs)}</div>
      <div>CMP response</div><div>${fmtMs(r.cmp.loadedMs)}</div>
      <div>CMP API present</div><div>${r.cmp.apiPresent ? 'yes' : 'no'}</div>
      <div>Banner visible</div><div>${r.cmp.bannerVisible ? 'yes' : 'no'}</div>
      <div>Cookies (non-CMP)</div><div>${r.stats.totalCookies}</div>
      <div>Tracker requests</div><div>${r.stats.totalTrackers} (${r.stats.totalRequests} requests total)</div>
      ${originSummary ? `<div>Tracker origins</div><div title="${esc(originSummary)}">${esc(originSummary)}</div>` : ''}
    </div>

    <h2>Cookies (${r.cookies.length})</h2>
    ${r.cookies.length ? `<table>${cookieCols}
      <tr><th>First seen</th><th>Name</th><th>Domain</th><th>Via</th><th>Before CMP?</th><th>Origin</th></tr>
      ${cookieRows}</table>` : '<div class="empty">No cookies observed.</div>'}

    <h2>Tags &amp; third-party requests (deduped by host)</h2>
    ${tagRows ? `<table>${tagCols}
      <tr><th>Time</th><th>Host</th><th>Tag</th><th>Type</th><th>Before CMP?</th><th>Origin</th></tr>
      ${tagRows}</table>` : '<div class="empty">No third-party requests observed.</div>'}

    <div class="exports">
      <button class="secondary" id="exportJson">Download JSON</button>
      <button class="secondary" id="exportCsv">Download CSV</button>
      <button class="secondary" id="showWdBtn">Test consent withdrawal →</button>
    </div>
    <div class="note">Long names are truncated with "…" — hover any cell to see the full value;
    exports always contain untruncated data. Red rows fired before the consent manager was requested.
    Blue rows are the CMP itself (its own cookies/requests are not violations). Times are ms after
    navigation start. <b>Origin</b>: "Hardcoded (HTML)" = a tag written directly into the page source;
    "Via Google Tag Manager" etc. = delivered through a tag manager; "Injected by &lt;host&gt;" =
    loaded at runtime by another script (piggybacking). Only script requests and JS-set cookies
    can be attributed; pixels/XHR show "—".</div>`;

  document.getElementById('exportJson').addEventListener('click', () => {
    download(`consent_scan_${scan.siteDomain}.json`, JSON.stringify({ url: scan.url, scannedAt: new Date(scan.finishedAt).toISOString(), ...r }, null, 2), 'application/json');
  });
  document.getElementById('exportCsv').addEventListener('click', () => {
    const lines = [['record', 'time_ms', 'name_or_host', 'domain', 'detail', 'third_party', 'before_cmp', 'origin'].join(',')];
    const q = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
    for (const c of r.cookies) {
      const before = c.t === null || cmpT === null ? 'n/a' : c.t < cmpT ? 'YES' : 'no';
      lines.push(['cookie', c.t, q(c.name), q(c.domain), q(c.cmpCookie ? 'CMP cookie' : c.source), c.thirdParty ? 'yes' : 'no', before, q(c.origin || 'Unknown')].join(','));
    }
    for (const req of r.requests) {
      const before = cmpT === null ? 'n/a' : req.t < cmpT ? 'YES' : 'no';
      lines.push(['request', req.t, q(req.host), q(''), q(req.cmp ? `CMP: ${req.cmp}` : req.tracker || req.type), req.thirdParty ? 'yes' : 'no', before, q(req.origin || '—')].join(','));
    }
    download(`consent_scan_${scan.siteDomain}.csv`, lines.join('\n'), 'text/csv');
  });

  document.getElementById('showWdBtn').addEventListener('click', () => {
    const panel = document.getElementById('wdPanel');
    panel.classList.remove('collapsed');
    document.getElementById('wdToggle').textContent = '▾ Consent withdrawal test';
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

function download(filename, text, mime) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: mime }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---------------------------------------------------------------------------
// Consent withdrawal test panel
// ---------------------------------------------------------------------------
const wdToggle = document.getElementById('wdToggle');
const wdPanel = document.getElementById('wdPanel');
const wdStartBtn = document.getElementById('wdStartBtn');
const wdActionBtn = document.getElementById('wdActionBtn'); // dynamic: "Mark withdrawal" while monitoring, "Reset" otherwise
const wdStatusLine = document.getElementById('wdStatusLine');
const wdResults = document.getElementById('wdResults');

wdToggle.addEventListener('click', () => {
  const collapsed = wdPanel.classList.toggle('collapsed');
  wdToggle.textContent = (collapsed ? '▸' : '▾') + ' Consent withdrawal test';
});

async function getWD() {
  const { withdrawal } = await chrome.storage.session.get('withdrawal');
  return withdrawal || { status: 'idle' };
}

wdStartBtn.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  wdStartBtn.disabled = true;
  const resp = await chrome.runtime.sendMessage({ type: 'WD_START', tabId: tab.id }).catch((e) => ({ ok: false, error: String(e) }));
  if (resp && !resp.ok) {
    wdStatusLine.innerHTML = `<span style="color:var(--bad)">Could not start: ${esc(resp.error)}</span>`;
    wdStartBtn.disabled = false;
  }
});

// Single button whose action follows the test's state: it marks withdrawal
// while a test is actively monitoring, and resets at every other point
// (idle, countdown, done, error) so there's always something to click.
wdActionBtn.addEventListener('click', async () => {
  if (wdActionBtn.classList.contains('mark')) {
    wdActionBtn.disabled = true;
    const resp = await chrome.runtime.sendMessage({ type: 'WD_MARK' }).catch((e) => ({ ok: false, error: String(e) }));
    if (resp && !resp.ok) {
      wdStatusLine.innerHTML = `<span style="color:var(--bad)">Could not mark withdrawal: ${esc(resp.error)}. Click Reset and try again.</span>`;
      // Fall back to Reset immediately so a broken/expired test can't get stuck.
      wdActionBtn.classList.remove('mark');
      wdActionBtn.classList.add('reset');
      wdActionBtn.textContent = 'Reset';
      wdActionBtn.disabled = false;
    }
  } else {
    await chrome.runtime.sendMessage({ type: 'WD_RESET' }).catch(() => {});
  }
});

function setWDButtons(state) {
  // state: 'idle' | 'monitoring' | 'withdrawn' | 'done' | 'error'
  wdStartBtn.disabled = state === 'monitoring' || state === 'withdrawn';
  if (state === 'idle') {
    wdActionBtn.hidden = true;
  } else if (state === 'monitoring') {
    wdActionBtn.hidden = false;
    wdActionBtn.disabled = false;
    wdActionBtn.classList.remove('reset');
    wdActionBtn.classList.add('mark');
    wdActionBtn.textContent = 'Mark withdrawal';
  } else {
    // withdrawn (mid-countdown, can abort), done, error - all resettable
    wdActionBtn.hidden = false;
    wdActionBtn.disabled = false;
    wdActionBtn.classList.remove('mark');
    wdActionBtn.classList.add('reset');
    wdActionBtn.textContent = 'Reset';
  }
}

function renderWD(wd) {
  if (!wd || wd.status === 'idle') {
    wdStatusLine.textContent = '';
    wdResults.innerHTML = '';
    setWDButtons('idle');
    return;
  }

  if (wd.status === 'monitoring') {
    setWDButtons('monitoring');
    wdStatusLine.innerHTML = `<span class="spinner">&#9696;</span> Monitoring ${esc(wd.url || '')} — grant consent, browse, then withdraw it on the page, then click <b>Mark withdrawal</b>.`;
    wdResults.innerHTML = '';
    return;
  }

  if (wd.status === 'withdrawn') {
    setWDButtons('withdrawn');
    wdStatusLine.innerHTML = `<span class="spinner">&#9696;</span> Withdrawal marked — checking for ~15s to see if any tracker still fires… (click Reset to abort early)`;
    wdResults.innerHTML = '';
    return;
  }

  if (wd.status === 'error') {
    setWDButtons('error');
    wdStatusLine.innerHTML = `<span style="color:var(--bad)">Test failed: ${esc(wd.error)}</span>`;
    wdResults.innerHTML = '';
    return;
  }

  if (wd.status === 'done') {
    const r = wd.result;
    setWDButtons('done');
    wdStatusLine.textContent = '';
    if (!r) { wdResults.innerHTML = ''; return; }

    const reqRows = r.requestsAfterMark.slice(0, 100).map((q) => `<tr class="pre">
        <td class="num">${fmtMs(q.t)}</td>
        ${cell(q.host)}
        ${cell(q.tracker || '')}
        ${cell(q.type)}
      </tr>`).join('');

    const cmpLine = r.cmpConsentChanged === null
      ? 'No CMP consent cookie detected to check'
      : r.cmpConsentChanged
        ? 'CMP consent cookie value changed after withdrawal (it registered the action)'
        : '<span style="color:var(--bad)">CMP consent cookie value did NOT change after withdrawal</span>';

    wdResults.innerHTML = `
      <div class="verdict ${r.verdictClass}" style="margin-top:8px;">${esc(r.verdict)}</div>
      <div class="kv">
        <div>Consent cookie check</div><div>${cmpLine}</div>
        <div>Cookies still present*</div><div>${r.stillPresentCookies.length ? esc(r.stillPresentCookies.join(', ')) : 'none'}</div>
      </div>
      ${reqRows ? `<h2>Tracker requests after withdrawal</h2>
        <table><colgroup><col style="width:12%"><col style="width:34%"><col style="width:32%"><col style="width:22%"></colgroup>
        <tr><th>+ms after mark</th><th>Host</th><th>Tracker</th><th>Type</th></tr>
        ${reqRows}</table>` : ''}
      <div class="note">*Cookies still present were set before withdrawal and remain in the jar
      afterward — a weaker signal than a live request, since an inert leftover cookie isn't
      necessarily still being used. The tracker-request table above is the stronger evidence of
      continued processing after consent was withdrawn.</div>`;
  }
}

getScan().then(render);
getWD().then(renderWD);
