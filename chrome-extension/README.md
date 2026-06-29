# SEORANKO Auto-Fix Chrome Extension

Automatically applies SEO fixes from your SEORANKO audit to your live website — no code changes needed. Fixes are active within 60 seconds of being queued in the dashboard.

## How It Works

1. You run a site audit in SEORANKO and click "Apply Fix Now" on any issue
2. The fix is stored in the SEORANKO database
3. This extension reads those fixes and applies them live to your DOM
4. Search engines that execute JavaScript see the corrected values

## Loading in Chrome (Developer Mode)

1. Open Chrome and go to `chrome://extensions/`
2. Enable **Developer mode** (toggle in top-right corner)
3. Click **Load unpacked**
4. Select the `chrome-extension/` folder from this repo
5. The SEORANKO icon appears in your toolbar

## Connecting Your Site

1. Click the SEORANKO icon in the toolbar
2. Enter your **Site ID** — this is your domain without `www` (e.g. `yourdomain.com`)
3. Click **Connect**
4. Navigate to any page on your site — fixes apply automatically

Your Site ID is shown in the SEORANKO dashboard at `/dashboard/site-audit`.

## How It Connects to SEORANKO

The extension calls:
```
GET https://seoranko.com/api/fixes?site_id=<your-domain>&url=<current-page-url>
```

Responses are cached for 5 minutes per page to avoid unnecessary API calls.

The `siteId` you enter is stored in `chrome.storage.sync` — it syncs across your Chrome profile on all devices where you're signed in.

## Fix Types Supported

| Fix Type | What It Changes |
|---|---|
| `meta_title` | `<title>` tag and `document.title` |
| `meta_description` | `<meta name="description">` |
| `canonical` | `<link rel="canonical">` |
| `h1` | First `<h1>` element text content |
| `og_title` | `<meta property="og:title">` |
| `og_description` | `<meta property="og:description">` |
| `og_image` | `<meta property="og:image">` |
| `twitter_card` | `<meta name="twitter:card">` |
| `schema` | Injects `<script type="application/ld+json">` |
| `viewport` | `<meta name="viewport">` |
| `lang` | `lang` attribute on `<html>` element |
| `alt_text` | `alt` attribute on matched `<img>` elements |

## Making Fixes Permanent

The extension applies fixes client-side for immediate SEO benefit. To make fixes permanent (baked into your HTML so they work without the extension), visit `/dashboard/install` to install the SEORANKO script tag — it does the same DOM injection server-side-equivalent without requiring Chrome.

## Submitting to Chrome Web Store

1. Zip the `chrome-extension/` folder contents (not the folder itself)
2. Go to [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
3. Click **Add new item** and upload the zip
4. Fill in store listing details:
   - **Category**: Productivity
   - **Screenshots**: 1280×800 showing the popup and a page with fixes active
   - **Privacy policy**: Link to your privacy policy

## Privacy

- The extension only communicates with `https://seoranko.com` — no other external services
- It reads your `siteId` from Chrome sync storage — nothing else
- It does not collect browsing history or personal data
- Fix data is fetched per-page and cached for 5 minutes in session storage

## Regenerating Icons

The `icon48.png` and `icon128.png` files are solid-colour placeholders. To regenerate them:
```bash
node -e "
const zlib=require('zlib'),fs=require('fs');
// ... (see generate-icons.js)
"
```

Or design custom icons and export as PNG at 48×48 and 128×128.
