// Runs in the page's MAIN world at document_start (registered only during a scan).
// 1. Timestamps every document.cookie write and captures the call stack so the
//    writing script can be attributed (hardcoded vs tag-manager-delivered).
// 2. Records script elements injected at runtime (appendChild/insertBefore),
//    with the injector's call stack, to attribute dynamically loaded tags.
// performance.now() is relative to navigation start, matching the scan's clock.
(() => {
  if (window.__consentScanHooked) return;
  window.__consentScanHooked = true;
  window.__jsCookieLog = [];
  window.__scriptInjectLog = [];

  const grabStack = () => {
    try { return String((new Error()).stack || '').split('\n').slice(1, 8).join(' | '); }
    catch (e) { return ''; }
  };

  // --- document.cookie writes ---
  try {
    const desc = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
    Object.defineProperty(Document.prototype, 'cookie', {
      configurable: true,
      get() { return desc.get.call(this); },
      set(v) {
        try {
          window.__jsCookieLog.push({
            t: performance.now(),
            cookie: String(v).split(';')[0],
            stack: grabStack()
          });
        } catch (e) { /* never break the page */ }
        return desc.set.call(this, v);
      }
    });
  } catch (e) { /* some pages lock this down; HTTP + observed cookies still work */ }

  // --- runtime script injection (how GTM & co. load tags) ---
  const logScript = (node) => {
    try {
      if (node && node.tagName === 'SCRIPT' && node.src && window.__scriptInjectLog.length < 1000) {
        window.__scriptInjectLog.push({ src: node.src, t: performance.now(), stack: grabStack() });
      }
    } catch (e) {}
  };
  const wrap = (proto, fn) => {
    try {
      const orig = proto[fn];
      proto[fn] = function (node, ...rest) {
        logScript(node);
        return orig.call(this, node, ...rest);
      };
    } catch (e) {}
  };
  wrap(Node.prototype, 'appendChild');
  wrap(Node.prototype, 'insertBefore');
  wrap(Element.prototype, 'append');
  wrap(Element.prototype, 'prepend');
})();
