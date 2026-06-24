/**
 * SEORANKO — Universal SEO Fix Injection Script v1.1
 * <script src="https://seoranko.com/seoranko.js" data-site-id="yourdomain.com" async></script>
 * Fails silently — never breaks the host site.
 */
(function () {
  'use strict';

  var script = document.currentScript || (function () {
    var all = document.getElementsByTagName('script');
    return all[all.length - 1];
  })();

  var siteId = script && script.getAttribute('data-site-id');
  if (!siteId) return;

  var apiBase = (script.getAttribute('data-api') || 'https://seoranko.com') + '/api/fixes';

  // Normalize current page URL to match stored canonical form
  function pageUrl() {
    try {
      var u = new URL(location.href);
      u.protocol = 'https:';
      u.hostname = u.hostname.replace(/^www\./, '');
      u.hash = '';
      u.search = '';
      var p = u.pathname;
      if (p.length > 1 && p.slice(-1) === '/') p = p.slice(0, -1);
      return 'https://' + u.hostname + p;
    } catch (e) { return location.href; }
  }

  // Set or create a <meta> by attribute + value
  function setMeta(attr, attrVal, content) {
    var el = document.querySelector('meta[' + attr + '="' + attrVal + '"]');
    if (el) {
      el.setAttribute('content', content);
    } else {
      var m = document.createElement('meta');
      m.setAttribute(attr, attrVal);
      m.setAttribute('content', content);
      document.head.appendChild(m);
    }
  }

  // Apply one fix object to the DOM
  function applyOne(fix) {
    var t = fix.fix_type, v = fix.new_value;
    if (!t || !v) return;

    if (t === 'meta_title') {
      document.title = v;
      var title = document.querySelector('title');
      if (title) { title.textContent = v; }
      else { var nt = document.createElement('title'); nt.textContent = v; document.head.appendChild(nt); }
    }

    else if (t === 'meta_description')  { setMeta('name', 'description', v); }
    else if (t === 'og_title')          { setMeta('property', 'og:title', v); }
    else if (t === 'og_description')    { setMeta('property', 'og:description', v); }
    else if (t === 'og_image')          { setMeta('property', 'og:image', v); }
    else if (t === 'twitter_title')     { setMeta('name', 'twitter:title', v); }
    else if (t === 'twitter_description') { setMeta('name', 'twitter:description', v); }
    else if (t === 'twitter_image')     { setMeta('name', 'twitter:image', v); }
    else if (t === 'viewport')          { setMeta('name', 'viewport', v); }

    else if (t === 'canonical') {
      var cl = document.querySelector('link[rel="canonical"]');
      if (cl) { cl.setAttribute('href', v); }
      else { var nl = document.createElement('link'); nl.rel = 'canonical'; nl.href = v; document.head.appendChild(nl); }
    }

    else if (t === 'h1') {
      var h = document.querySelector('h1');
      if (h) { h.textContent = v; }
      else { var nh = document.createElement('h1'); nh.textContent = v; if (document.body) document.body.insertBefore(nh, document.body.firstChild); }
    }

    else if (t === 'schema') {
      var s = document.createElement('script');
      s.type = 'application/ld+json';
      s.textContent = v;
      document.head.appendChild(s);
    }

    else if (t === 'alt_text' && fix.selector) {
      var imgs = document.querySelectorAll(fix.selector);
      for (var i = 0; i < imgs.length; i++) {
        if (!imgs[i].getAttribute('alt')) imgs[i].setAttribute('alt', v);
      }
    }
  }

  function applyFixes(fixes) {
    for (var i = 0; i < fixes.length; i++) {
      try { applyOne(fixes[i]); } catch (e) { /* silent */ }
    }
  }

  function run() {
    var url = pageUrl();
    var endpoint = apiBase + '?site_id=' + encodeURIComponent(siteId) + '&url=' + encodeURIComponent(url);
    var xhr = new XMLHttpRequest();
    xhr.open('GET', endpoint, true);
    xhr.timeout = 5000;
    xhr.onload = function () {
      if (xhr.status === 200) {
        try { applyFixes(JSON.parse(xhr.responseText).fixes || []); } catch (e) { /* silent */ }
      }
    };
    xhr.onerror = xhr.ontimeout = function () { /* silent */ };
    xhr.send();
  }

  // Fire as early as possible — head is already parsed when async scripts run
  if (document.head) { run(); }
  else { document.addEventListener('DOMContentLoaded', run); }
})();
