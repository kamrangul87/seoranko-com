// SEORANKO Auto-Fix — popup script

const FIX_TYPE_ICONS = {
  meta_title:       '📄',
  meta_description: '📝',
  canonical:        '🔗',
  h1:               '📰',
  og_title:         '🖼️',
  og_description:   '🖼️',
  og_image:         '🖼️',
  twitter_card:     '🐦',
  schema:           '🔷',
  viewport:         '📱',
  lang:             '🌐',
  alt_text:         '🖼️',
};

const FIX_TYPE_LABELS = {
  meta_title:       'Title tag',
  meta_description: 'Meta description',
  canonical:        'Canonical URL',
  h1:               'H1 heading',
  og_title:         'OG title',
  og_description:   'OG description',
  og_image:         'OG image',
  twitter_card:     'Twitter Card',
  schema:           'Schema JSON-LD',
  viewport:         'Viewport meta',
  lang:             'Language attribute',
  alt_text:         'Image alt text',
};

const $ = id => document.getElementById(id);

function showView(name) {
  $('loading-view').style.display = 'none';
  $('connect-view').style.display = 'none';
  $('connected-view').style.display = 'none';
  $(name).style.display = name === 'connect-view' ? 'block' : 'block';
}

function renderFixList(fixes) {
  const countNum = $('fix-count-num');
  const countLabel = $('fix-count-label');
  const fixList = $('fix-list');

  if (!fixes || fixes.length === 0) {
    countNum.textContent = '0';
    countNum.style.color = '#9b9b9b';
    countLabel.textContent = 'No fixes active on this page';
    fixList.style.display = 'none';
    return;
  }

  countNum.textContent = String(fixes.length);
  countNum.style.color = '#00d48a';
  countLabel.textContent = `fix${fixes.length !== 1 ? 'es' : ''} active on this page`;

  fixList.innerHTML = '';
  for (const fix of fixes) {
    const icon = FIX_TYPE_ICONS[fix.fix_type] || '🔧';
    const label = FIX_TYPE_LABELS[fix.fix_type] || fix.fix_type;
    const preview = (fix.new_value || '').slice(0, 50);
    const item = document.createElement('div');
    item.className = 'fix-item';
    item.innerHTML = `
      <span>${icon}</span>
      <span class="fix-type-badge">${label}</span>
      <span class="fix-value" title="${escHtml(fix.new_value || '')}">${escHtml(preview)}</span>
    `;
    fixList.appendChild(item);
  }
  fixList.style.display = fixes.length > 0 ? 'flex' : 'none';
}

function escHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  const { siteId } = await chrome.storage.sync.get('siteId');

  if (!siteId) {
    showView('connect-view');
    return;
  }

  // Show connected view immediately
  showView('connected-view');
  $('connected-domain-label').textContent = siteId;

  // Ask background for current tab's fix state
  chrome.runtime.sendMessage({ type: 'GET_TAB_FIXES' }, response => {
    if (chrome.runtime.lastError) {
      $('fix-count-num').textContent = '?';
      $('fix-count-label').textContent = 'Could not load fixes';
      return;
    }
    const { count, fixes } = response || {};
    renderFixList(fixes || (count > 0 ? [{ fix_type: 'unknown', new_value: `${count} fixes applied` }] : []));
  });
}

// ── Connect button ────────────────────────────────────────────────────────────

$('btn-connect').addEventListener('click', async () => {
  const input = $('site-id-input');
  const errorEl = $('connect-error');
  let siteId = input.value.trim().toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0];

  errorEl.style.display = 'none';

  if (!siteId || !siteId.includes('.')) {
    errorEl.textContent = 'Enter a valid domain (e.g. yourdomain.com)';
    errorEl.style.display = 'block';
    return;
  }

  $('btn-connect').disabled = true;
  $('btn-connect').textContent = 'Connecting…';

  // Quick validation: try to fetch fixes for this site
  try {
    const res = await fetch(`https://seoranko.com/api/fixes?site_id=${encodeURIComponent(siteId)}&url=https://${siteId}/`);
    if (!res.ok) throw new Error('API unreachable');
  } catch {
    // Non-fatal: save anyway, user might not have any fixes yet
  }

  await chrome.storage.sync.set({ siteId });
  $('btn-connect').disabled = false;
  $('btn-connect').textContent = 'Connect';

  // Switch to connected view
  $('connected-domain-label').textContent = siteId;
  showView('connected-view');
  $('fix-count-num').textContent = '—';
  $('fix-count-label').textContent = 'Reload the page to see fixes';
});

// Allow Enter key in input
$('site-id-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') $('btn-connect').click();
});

// ── Disconnect button ─────────────────────────────────────────────────────────

$('btn-disconnect').addEventListener('click', async () => {
  await chrome.storage.sync.remove('siteId');
  showView('connect-view');
  $('site-id-input').value = '';
});

// ── Start ─────────────────────────────────────────────────────────────────────

init().catch(err => {
  console.error('[SEORANKO popup]', err);
  showView('connect-view');
});
