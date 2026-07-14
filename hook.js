// Runs in the page's MAIN world at document_start (registered only during a scan).
// Timestamps every document.cookie write so JS-set cookies can be ordered
// against the consent manager's load time. performance.now() is relative to
// navigation start, matching the scan's clock.
(() => {
  if (window.__consentScanHooked) return;
  window.__consentScanHooked = true;
  window.__jsCookieLog = [];
  try {
    const desc = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
    Object.defineProperty(Document.prototype, 'cookie', {
      configurable: true,
      get() { return desc.get.call(this); },
      set(v) {
        try {
          window.__jsCookieLog.push({ t: performance.now(), cookie: String(v).split(';')[0] });
        } catch (e) { /* never break the page */ }
        return desc.set.call(this, v);
      }
    });
  } catch (e) { /* some pages lock this down; HTTP + observed cookies still work */ }
})();
