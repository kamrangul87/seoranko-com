// SEORANKO Auto-Fix — content script
// Runs at document_start; applies fixes from the SEORANKO seo_fixes table
// to the live DOM so search engines see the corrected values.

(function () {
  'use strict';

  let appliedFixes = [];

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function getMeta(name) {
    return document.querySelector(`meta[name="${name}"]`);
  }

  function getMetaProperty(prop) {
    return document.querySelector(`meta[property="${prop}"]`);
  }

  function setOrCreateMeta(name, value) {
    let el = getMeta(name);
    if (!el) {
      el = document.createElement('meta');
      el.setAttribute('name', name);
      document.head.appendChild(el);
    }
    el.setAttribute('content', value);
  }

  function setOrCreateMetaProperty(prop, value) {
    let el = getMetaProperty(prop);
    if (!el) {
      el = document.createElement('meta');
      el.setAttribute('property', prop);
      document.head.appendChild(el);
    }
    el.setAttribute('content', value);
  }

  function setOrCreateLink(rel, attr, value) {
    let el = document.querySelector(`link[rel="${rel}"]`);
    if (!el) {
      el = document.createElement('link');
      el.setAttribute('rel', rel);
      document.head.appendChild(el);
    }
    el.setAttribute(attr, value);
  }

  // ── Apply a single fix ────────────────────────────────────────────────────────

  function applyFix(fix) {
    const val = fix.new_value;
    if (!val) return false;

    try {
      switch (fix.fix_type) {
        case 'meta_title':
          document.title = val;
          {
            let titleEl = document.querySelector('title');
            if (!titleEl) {
              titleEl = document.createElement('title');
              document.head.prepend(titleEl);
            }
            titleEl.textContent = val;
          }
          return true;

        case 'meta_description':
          setOrCreateMeta('description', val);
          return true;

        case 'canonical':
          setOrCreateLink('canonical', 'href', val);
          return true;

        case 'h1':
          {
            const h1 = document.querySelector('h1');
            if (h1) { h1.textContent = val; return true; }
          }
          return false;

        case 'og_title':
          setOrCreateMetaProperty('og:title', val);
          return true;

        case 'og_description':
          setOrCreateMetaProperty('og:description', val);
          return true;

        case 'og_image':
          setOrCreateMetaProperty('og:image', val);
          return true;

        case 'twitter_card':
          setOrCreateMeta('twitter:card', val);
          return true;

        case 'schema':
          {
            const script = document.createElement('script');
            script.type = 'application/ld+json';
            script.textContent = val;
            document.head.appendChild(script);
          }
          return true;

        case 'viewport':
          setOrCreateMeta('viewport', val);
          return true;

        case 'lang':
          document.documentElement.setAttribute('lang', val);
          return true;

        case 'alt_text':
          // fix.selector should be a CSS selector or img src pattern
          {
            const selector = fix.selector;
            if (!selector) return false;
            const imgs = document.querySelectorAll(selector);
            imgs.forEach(img => img.setAttribute('alt', val));
            return imgs.length > 0;
          }

        default:
          return false;
      }
    } catch { return false; }
  }

  // ── Show the SEORANKO indicator ────────────────────────────────────────────────

  function showIndicator(count) {
    // Remove any existing indicator
    const existing = document.getElementById('seoranko-indicator');
    if (existing) existing.remove();

    if (count === 0) return;

    const el = document.createElement('div');
    el.id = 'seoranko-indicator';
    el.setAttribute('role', 'status');
    el.style.cssText = [
      'position:fixed',
      'bottom:16px',
      'right:16px',
      'z-index:2147483647',
      'background:#00d48a',
      'color:#fff',
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
      'font-size:12px',
      'font-weight:600',
      'padding:8px 12px',
      'border-radius:20px',
      'box-shadow:0 2px 12px rgba(0,0,0,0.15)',
      'cursor:pointer',
      'user-select:none',
      'display:flex',
      'align-items:center',
      'gap:6px',
      'transition:opacity 0.3s',
    ].join(';');
    el.innerHTML = `<span>✅</span><span>SEORANKO: ${count} fix${count !== 1 ? 'es' : ''} active</span>`;

    // Dismiss on click
    el.addEventListener('click', () => {
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 300);
    });

    // Auto-dismiss after 6 seconds
    document.body.appendChild(el);
    setTimeout(() => {
      if (el.parentNode) {
        el.style.opacity = '0';
        setTimeout(() => el.remove(), 300);
      }
    }, 6000);
  }

  // ── Main: get siteId, fetch fixes, apply ─────────────────────────────────────

  function run() {
    chrome.storage.sync.get('siteId', ({ siteId }) => {
      if (!siteId) return; // User hasn't connected yet

      const pageUrl = window.location.href;

      chrome.runtime.sendMessage(
        { type: 'GET_FIXES', siteId, pageUrl },
        response => {
          if (chrome.runtime.lastError) return;
          const fixes = response?.fixes ?? [];
          if (fixes.length === 0) return;

          // Apply fixes once DOM is ready
          function applyAll() {
            appliedFixes = [];
            for (const fix of fixes) {
              if (applyFix(fix)) appliedFixes.push(fix);
            }

            // Notify background (updates badge)
            chrome.runtime.sendMessage({
              type: 'FIXES_APPLIED',
              count: appliedFixes.length,
              url: pageUrl,
              fixes: appliedFixes.map(f => ({ fix_type: f.fix_type, new_value: f.new_value?.slice(0, 80) })),
            });

            if (appliedFixes.length > 0) showIndicator(appliedFixes.length);
          }

          if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', applyAll, { once: true });
          } else {
            applyAll();
          }
        }
      );
    });
  }

  // Don't run in iframes
  if (window.self === window.top) run();
})();
