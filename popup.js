// Popup renderer. All scan state lives in chrome.storage.session (written by
// the service worker), so the popup can be closed/reopened during a scan.

const content = document.getElementById('content');
const scanBtn = document.getElementById('scanBtn');

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
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

  // Cookies table
  const cookieRows = r.cookies.map((c) => {
    const before = c.t === null || cmpT === null ? 'n/a' : c.t < cmpT ? 'YES' : 'no';
    const cls = c.cmpCookie ? 'cmp' : before === 'YES' ? 'pre' : '';
    return `<tr class="${cls}">
      <td class="num">${fmtMs(c.t)}</td>
      <td>${esc(c.name)}${c.cmpCookie ? ' <span class="tag">CMP</span>' : ''}</td>
      <td>${esc(c.domain)}</td>
      <td>${esc(c.source)}</td>
      <td>${c.thirdParty ? 'yes' : 'no'}</td>
      <td>${before}</td>
    </tr>`;
  }).join('');

  // Tags table: CMP requests, known trackers, and other third-party scripts/XHR
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
    return `<tr class="${cls}">
      <td class="num">${fmtMs(q.t)}</td>
      <td>${esc(q.host)}</td>
      <td>${q.cmp ? `<span class="tag">CMP: ${esc(q.cmp)}</span>` : esc(q.tracker || '')}</td>
      <td>${esc(q.type)}</td>
      <td>${before}</td>
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
    </div>

    <h2>Cookies (${r.cookies.length})</h2>
    ${r.cookies.length ? `<table>
      <tr><th>First seen</th><th>Name</th><th>Domain</th><th>Via</th><th>3rd-party</th><th>Before CMP?</th></tr>
      ${cookieRows}</table>` : '<div class="empty">No cookies observed.</div>'}

    <h2>Tags &amp; third-party requests (deduped by host)</h2>
    ${tagRows ? `<table>
      <tr><th>Time</th><th>Host</th><th>Tag</th><th>Type</th><th>Before CMP?</th></tr>
      ${tagRows}</table>` : '<div class="empty">No third-party requests observed.</div>'}

    <div class="exports">
      <button class="secondary" id="exportJson">Download JSON</button>
      <button class="secondary" id="exportCsv">Download CSV</button>
    </div>
    <div class="note">Red rows fired before the consent manager was requested. Blue rows are the
    CMP itself (its own cookies/requests are not violations). Times are ms after navigation start.
    "Before CMP?" compares against the moment the CMP script was <i>requested</i> — the strictest baseline.</div>`;

  document.getElementById('exportJson').addEventListener('click', () => {
    download(`consent_scan_${scan.siteDomain}.json`, JSON.stringify({ url: scan.url, scannedAt: new Date(scan.finishedAt).toISOString(), ...r }, null, 2), 'application/json');
  });
  document.getElementById('exportCsv').addEventListener('click', () => {
    const lines = [['record', 'time_ms', 'name_or_host', 'domain', 'detail', 'third_party', 'before_cmp'].join(',')];
    const q = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
    for (const c of r.cookies) {
      const before = c.t === null || cmpT === null ? 'n/a' : c.t < cmpT ? 'YES' : 'no';
      lines.push(['cookie', c.t, q(c.name), q(c.domain), q(c.cmpCookie ? 'CMP cookie' : c.source), c.thirdParty ? 'yes' : 'no', before].join(','));
    }
    for (const req of r.requests) {
      const before = cmpT === null ? 'n/a' : req.t < cmpT ? 'YES' : 'no';
      lines.push(['request', req.t, q(req.host), q(''), q(req.cmp ? `CMP: ${req.cmp}` : req.tracker || req.type), req.thirdParty ? 'yes' : 'no', before].join(','));
    }
    download(`consent_scan_${scan.siteDomain}.csv`, lines.join('\n'), 'text/csv');
  });
}

function download(filename, text, mime) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: mime }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

getScan().then(render);
