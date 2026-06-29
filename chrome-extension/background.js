// SEORANKO Auto-Fix — background service worker
// Caches fixes per domain with a 5-minute TTL so content scripts
// don't hammer the API on every navigation.

const API_BASE = 'https://autodun-ev-finders-projects.vercel.app/api/fixes';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// In-memory cache (lives for the service worker session)
const cache = new Map(); // key: "siteId::pageUrl" → { fixes: [], ts: Date.now() }

function cacheKey(siteId, pageUrl) {
  return `${siteId}::${pageUrl}`;
}

async function fetchFixes(siteId, pageUrl) {
  const key = cacheKey(siteId, pageUrl);
  const now = Date.now();

  // Check in-memory cache first
  const cached = cache.get(key);
  if (cached && now - cached.ts < CACHE_TTL_MS) {
    return cached.fixes;
  }

  // Also check chrome.storage.session (survives worker restarts within the session)
  try {
    const stored = await chrome.storage.session.get(key);
    if (stored[key] && now - stored[key].ts < CACHE_TTL_MS) {
      cache.set(key, stored[key]);
      return stored[key].fixes;
    }
  } catch { /* storage.session may not be available in all Chrome versions */ }

  // Fetch from SEORANKO API
  try {
    const url = `${API_BASE}?site_id=${encodeURIComponent(siteId)}&url=${encodeURIComponent(pageUrl)}`;
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const fixes = data.fixes ?? [];

    // Store in both caches
    const entry = { fixes, ts: now };
    cache.set(key, entry);
    try { await chrome.storage.session.set({ [key]: entry }); } catch { /* ignore */ }

    return fixes;
  } catch (err) {
    console.warn('[SEORANKO background] fetch failed:', err.message);
    return [];
  }
}

// Update the extension badge on the current tab
function updateBadge(tabId, count) {
  if (count > 0) {
    chrome.action.setBadgeText({ text: String(count), tabId });
    chrome.action.setBadgeBackgroundColor({ color: '#00d48a', tabId });
  } else {
    chrome.action.setBadgeText({ text: '', tabId });
  }
}

// Listen for messages from content.js
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'GET_FIXES') {
    const { siteId, pageUrl } = msg;
    fetchFixes(siteId, pageUrl)
      .then(fixes => sendResponse({ fixes }))
      .catch(() => sendResponse({ fixes: [] }));
    return true; // keep channel open for async response
  }

  if (msg.type === 'FIXES_APPLIED') {
    const { count } = msg;
    const tabId = sender.tab?.id;
    if (tabId != null) updateBadge(tabId, count);
    // Store per-tab state so the popup can read it
    chrome.storage.session.set({ [`tab_fixes_${tabId}`]: { count, url: msg.url, fixes: msg.fixes } })
      .catch(() => { /* ignore */ });
    sendResponse({ ok: true });
    return false;
  }

  if (msg.type === 'GET_TAB_FIXES') {
    // Popup asking for current tab's fix state
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      const tabId = tabs[0]?.id;
      if (tabId == null) { sendResponse({ count: 0, fixes: [] }); return; }
      chrome.storage.session.get(`tab_fixes_${tabId}`)
        .then(data => sendResponse(data[`tab_fixes_${tabId}`] || { count: 0, fixes: [] }))
        .catch(() => sendResponse({ count: 0, fixes: [] }));
    });
    return true;
  }

  return false;
});
