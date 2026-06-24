/**
 * SEORANKO — Universal SEO Fix Injection Script
 * Paste one <script> tag to apply SEO fixes to any site in real-time.
 * Fails silently — never breaks your page.
 *
 * Usage:
 *   <script src="https://seoranko.com/seoranko.js" data-site-id="yourdomain.com" async></script>
 */
(function () {
  'use strict';

  var script = document.currentScript || (function () {
    var scripts = document.getElementsByTagName('script');
    return scripts[scripts.length - 1];
  })();

  var siteId = script && script.getAttribute('data-site-id');
  if (!siteId) return;

  var apiBase = (script.getAttribute('data-api') || 'https://seoranko.com') + '/api/fixes';

  // Normalize current URL to match stored format (no www, no trailing slash, https)
  function getCanonicalUrl() {
    try {
      var u = new URL(window.location.href);
      u.protocol = 'https:';
      u.hostname = u.hostname.replace(/^www\./, '');
      u.hash = '';
      u.search = '';
      var path = u.pathname;
      if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
      return 'https://' + u.hostname + path;
    } catch (e) {
      return window.location.href;
    }
  }

  function applyFixes(fixes) {
    if (!fixes || !fixes.length) return;

    fixes.forEach(function (fix) {
      try {
        applyOneFix(fix);
      } catch (e) {
        // Silently ignore per-fix errors
      }
    });
  }

  function applyOneFix(fix) {
    var type = fix.fix_type;
    var value = fix.new_value;
    if (!type || !value) return;

    if (type === 'meta_title') {
      document.title = value;
      var titleEl = document.querySelector('title');
      if (titleEl) {
        titleEl.textContent = value;
      } else {
        var t = document.createElement('title');
        t.textContent = value;
        document.head.appendChild(t);
      }
    }

    else if (type === 'meta_description') {
      var meta = document.querySelector('meta[name="description"]');
      if (meta) {
        meta.setAttribute('content', value);
      } else {
        var m = document.createElement('meta');
        m.setAttribute('name', 'description');
        m.setAttribute('content', value);
        document.head.appendChild(m);
      }
    }

    else if (type === 'h1') {
      var h1 = document.querySelector('h1');
      if (h1) {
        h1.textContent = value;
      } else {
        var newH1 = document.createElement('h1');
        newH1.textContent = value;
        var body = document.querySelector('body');
        if (body) body.insertBefore(newH1, body.firstChild);
      }
    }

    else if (type === 'og_title') {
      setMeta('property', 'og:title', value);
    }

    else if (type === 'og_image') {
      setMeta('property', 'og:image', value);
    }

    else if (type === 'canonical') {
      var existing = document.querySelector('link[rel="canonical"]');
      if (existing) {
        existing.setAttribute('href', value);
      } else {
        var link = document.createElement('link');
        link.setAttribute('rel', 'canonical');
        link.setAttribute('href', value);
        document.head.appendChild(link);
      }
    }

    else if (type === 'schema') {
      var jsonLd = document.createElement('script');
      jsonLd.type = 'application/ld+json';
      jsonLd.textContent = value;
      document.head.appendChild(jsonLd);
    }

    else if (type === 'alt_text' && fix.selector) {
      var imgs = document.querySelectorAll(fix.selector);
      imgs.forEach(function (img) {
        if (!img.getAttribute('alt')) img.setAttribute('alt', value);
      });
    }
  }

  function setMeta(attr, attrValue, content) {
    var sel = 'meta[' + attr + '="' + attrValue + '"]';
    var el = document.querySelector(sel);
    if (el) {
      el.setAttribute('content', content);
    } else {
      var m = document.createElement('meta');
      m.setAttribute(attr, attrValue);
      m.setAttribute('content', content);
      document.head.appendChild(m);
    }
  }

  function fetchAndApply() {
    var url = getCanonicalUrl();
    var endpoint = apiBase + '?site_id=' + encodeURIComponent(siteId) + '&url=' + encodeURIComponent(url);

    // Use XHR for broadest browser support (script may run in old environments)
    var xhr = new XMLHttpRequest();
    xhr.open('GET', endpoint, true);
    xhr.timeout = 5000;
    xhr.onload = function () {
      if (xhr.status === 200) {
        try {
          var data = JSON.parse(xhr.responseText);
          applyFixes(data.fixes);
        } catch (e) { /* silent */ }
      }
    };
    xhr.onerror = function () { /* silent */ };
    xhr.ontimeout = function () { /* silent */ };
    xhr.send();
  }

  // Run as early as possible — before DOMContentLoaded if head is available,
  // otherwise as soon as DOM is ready
  if (document.head) {
    fetchAndApply();
  } else {
    document.addEventListener('DOMContentLoaded', fetchAndApply);
  }
})();
