import { type Express } from 'express';

/**
 * Serves the three documents App Review follows and the app links to.
 *
 * These live on the API rather than a marketing site because there is no
 * marketing domain, and Apple rejects an app whose privacy-policy URL does not
 * resolve. They are static, take no input, and read no request state, so they
 * are the only routes here that answer without authentication.
 *
 * The wording is derived from `docs/app-privacy-worksheet.md`, which is the
 * source of truth for the App Store Connect App Privacy answers and for
 * `ios.privacyManifests`. A claim here that contradicts that worksheet is a
 * defect in one of the two.
 */

export interface LegalPageOptions {
  supportEmail: string;
}

/** Applies to the document only: no scripts, no frames, no form posts. */
const documentPolicy = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "img-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

const pageStyle = `
  :root { color-scheme: light dark; }
  body {
    margin: 0 auto; padding: 2rem 1.25rem 4rem; max-width: 44rem;
    font: 16px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    color: #16121f; background: #fbfaff;
  }
  h1 { font-size: 1.75rem; line-height: 1.25; margin: 0 0 0.25rem; }
  h2 { font-size: 1.15rem; margin: 2rem 0 0.5rem; }
  .updated { color: #6b6480; margin: 0 0 2rem; font-size: 0.9rem; }
  ul { padding-left: 1.25rem; }
  li { margin: 0.35rem 0; }
  a { color: #5b3fd6; }
  footer { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid #ddd8ea; font-size: 0.9rem; }
  @media (prefers-color-scheme: dark) {
    body { color: #ece8f7; background: #0d0a1a; }
    .updated { color: #a49cbd; }
    a { color: #b9a6ff; }
    footer { border-top-color: #2a2340; }
  }
`;

/**
 * Escapes text interpolated into the documents. Every value is a constant in
 * this file or a configured address, but the pages are public HTML and the
 * escape costs nothing.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;');
}

function renderPage(title: string, updated: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · Fortuneness</title>
<style>${pageStyle}</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
<p class="updated">Fortuneness · last updated ${escapeHtml(updated)}</p>
${body}
<footer>
<a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · <a href="/support">Support</a>
</footer>
</body>
</html>
`;
}

const lastUpdated = '8 August 2026';

function privacyBody(supportEmail: string): string {
  const email = escapeHtml(supportEmail);
  return `
<p>Fortuneness is a daily tarot reflection app. This policy describes exactly what the app collects, why, and what you can do about it. It is deliberately short, because the app collects very little.</p>

<h2>What we collect</h2>
<ul>
<li><strong>Your account identity.</strong> When you sign in with Game Center, Apple gives the app a player identifier scoped to Fortuneness. We never store it directly — we store only a salted cryptographic digest of it, together with an account identifier we generate. We cannot recover your Game Center identifier from what we store, and it cannot be used to identify you in any other app.</li>
<li><strong>Purchase history.</strong> Apple transaction identifiers and your entitlement state, which are what let us grant the readings you paid for and audit them if something goes wrong.</li>
<li><strong>Your readings.</strong> The reading archive and card collection you generate by using the app.</li>
<li><strong>Time zone and language.</strong> An IANA time-zone name and a locale code, used only to decide when your day resets and which language to answer in.</li>
</ul>

<h2>What we do not collect</h2>
<ul>
<li>No advertising identifier (IDFA), and no App Tracking Transparency prompt, because there is nothing to track.</li>
<li>No third-party analytics and no advertising SDK. None is installed.</li>
<li>No crash reporter or performance SDK in the app.</li>
<li>No name, email address, or postal address. Game Center does not give these to the app and we never ask for them.</li>
<li>No location. A time-zone name is not a location.</li>
<li>No contacts, photos, camera, microphone, or health data. The app links none of those frameworks.</li>
</ul>

<h2>Tracking</h2>
<p>Fortuneness does not track you. We do not share anything with data brokers, we do not combine your data with data from other companies, and we do not use your data for advertising.</p>

<h2>Who else sees your data</h2>
<ul>
<li><strong>Apple</strong> handles sign-in through Game Center and all payments through the App Store. We never see your payment details. Apple's own privacy policy governs what Apple collects.</li>
<li><strong>Railway</strong> hosts the server and its database on our behalf.</li>
</ul>
<p>That is the complete list. We do not sell your data to anyone, and we never have.</p>

<h2>How long we keep it</h2>
<p>Your readings and account stay until you delete them. Raw records of App Store notifications are discarded automatically after 90 days.</p>

<h2>Deleting your account</h2>
<p>Open <strong>Settings → Delete account</strong> in the app. Deletion begins a 30-day processing period, during which you can cancel it. After that, your account, your readings, and the digest of your Game Center identifier are permanently destroyed. We keep only the minimum anonymous financial record Apple and tax law require, which cannot be linked back to you.</p>

<h2>Children</h2>
<p>Fortuneness is not directed at children and does not knowingly collect data from them.</p>

<h2>Changes</h2>
<p>If this policy changes, the date at the top changes with it.</p>

<h2>Contact</h2>
<p>Questions about privacy or your data: <a href="mailto:${email}">${email}</a>.</p>
`;
}

function termsBody(supportEmail: string): string {
  const email = escapeHtml(supportEmail);
  return `
<h2>For entertainment only</h2>
<p><strong>Fortuneness is for entertainment and personal reflection.</strong> Readings are generated from a shuffled deck and written copy. They are not predictions, and they are not advice. Never use a reading as a substitute for professional medical, psychological, legal, or financial advice. If you are struggling, please speak to a qualified professional.</p>

<h2>Using the app</h2>
<p>You need a Game Center account to sign in. You are responsible for keeping access to that Apple Account secure. Do not attempt to disrupt the service, work around purchase verification, or access another person's readings.</p>

<h2>Free readings and purchases</h2>
<ul>
<li>Every account gets a free reading each day, refreshed when your day resets in your own time zone.</li>
<li><strong>Fortune packs</strong> are one-time purchases that add readings to your balance. They do not expire.</li>
<li><strong>Oracle+</strong> is an auto-renewing monthly subscription that raises your daily allowance for as long as it is active.</li>
</ul>

<h2>Subscriptions</h2>
<p>Oracle+ renews automatically each month through your Apple Account until you cancel. Cancel at least 24 hours before the period ends, in <strong>Settings → Apple Account → Subscriptions</strong> on your device. Cancelling stops the next renewal; it does not shorten the period you already paid for. Prices are shown in the app in your local currency before you buy.</p>

<h2>Refunds</h2>
<p>All payments are handled by Apple, so all refunds are handled by Apple. Request one at <a href="https://reportaproblem.apple.com">reportaproblem.apple.com</a>. We cannot issue refunds ourselves.</p>

<h2>Restoring purchases</h2>
<p>Use <strong>Restore Purchases</strong> in the app's shop to recover purchases made with the same Apple Account, including on a new device.</p>

<h2>Your content</h2>
<p>Your readings are yours. We store them so the app can show them back to you, and we delete them when you delete your account.</p>

<h2>Availability</h2>
<p>We try to keep the service running but cannot guarantee it is always available. We may change or discontinue features. To the fullest extent the law allows, Fortuneness is provided "as is" without warranties, and we are not liable for indirect or consequential loss arising from your use of it. Nothing here limits rights you have under the consumer law of your country that cannot be limited by agreement.</p>

<h2>Ending access</h2>
<p>You can stop using Fortuneness at any time and delete your account from Settings. We may suspend access that abuses the service or attempts to defraud it.</p>

<h2>Changes</h2>
<p>If these terms change, the date at the top changes with them.</p>

<h2>Contact</h2>
<p><a href="mailto:${email}">${email}</a></p>
`;
}

function supportBody(supportEmail: string): string {
  const email = escapeHtml(supportEmail);
  return `
<p>Something not working, or a question about your account? Email <a href="mailto:${email}">${email}</a> and describe what happened. It helps if you mention your device and iOS version.</p>

<h2>Common things</h2>
<ul>
<li><strong>I bought something and did not receive it.</strong> Open the shop and tap <strong>Restore Purchases</strong>. Purchases are tied to your Apple Account, so use the same one you bought with. If it still does not appear, email us.</li>
<li><strong>I want to cancel Oracle+.</strong> On your device: <strong>Settings → Apple Account → Subscriptions → Fortuneness</strong>. Cancel at least 24 hours before the period ends. We cannot cancel it for you — only Apple can.</li>
<li><strong>I want a refund.</strong> Apple handles all payments and refunds: <a href="https://reportaproblem.apple.com">reportaproblem.apple.com</a>.</li>
<li><strong>I cannot sign in.</strong> Fortuneness signs in with Game Center. Check <strong>Settings → Game Center</strong> on your device and make sure you are signed in there first.</li>
<li><strong>My readings disappeared.</strong> Readings belong to a Game Center account. Switching Apple Accounts shows a different archive. Switch back and they return.</li>
<li><strong>I want to delete my account.</strong> In the app: <strong>Settings → Delete account</strong>. You have 30 days to change your mind before it becomes permanent.</li>
</ul>

<h2>Privacy and data requests</h2>
<p>See the <a href="/privacy">privacy policy</a>, or email us about any data request.</p>
`;
}

export const registerLegalRoutes = (app: Express, options: LegalPageOptions): void => {
  const pages: Record<string, { body: string; title: string }> = {
    '/privacy': { body: privacyBody(options.supportEmail), title: 'Privacy Policy' },
    '/terms': { body: termsBody(options.supportEmail), title: 'Terms of Use' },
    '/support': { body: supportBody(options.supportEmail), title: 'Support' },
  };

  for (const [path, page] of Object.entries(pages)) {
    const html = renderPage(page.title, lastUpdated, page.body);
    app.get(path, (_request, response) => {
      response
        .status(200)
        .setHeader('Content-Security-Policy', documentPolicy)
        .setHeader('Content-Type', 'text/html; charset=utf-8')
        .setHeader('Cache-Control', 'public, max-age=3600')
        .send(html);
    });
  }
};
