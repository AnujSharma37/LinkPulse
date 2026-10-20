// GENERATED from shared/pages.ts by scripts/sync-shared.mjs — DO NOT EDIT HERE.
// Edit shared/pages.ts, then run: npm run sync
/** Server-rendered pages for the short-link route. Every dynamic value is HTML-escaped. */

export function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

const CSS = `
:root{--bg:#f6f7fb;--card:#fff;--text:#14162b;--muted:#5b6078;--border:#e3e5ef;--brand:#5b4cf0;--brand-ink:#fff;--warn-bg:#fff7e6;--warn:#8a5300;--err:#b42318;--err-bg:#fef3f2}
@media (prefers-color-scheme:dark){:root{--bg:#0f1020;--card:#181a2e;--text:#eceefe;--muted:#a3a7c4;--border:#2a2d48;--brand:#8b80ff;--brand-ink:#0f1020;--warn-bg:#2d2310;--warn:#f5c26b;--err:#ff8a80;--err-bg:#2c1414}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--text);font:16px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:16px}
.card{background:var(--card);border:1px solid var(--border);border-radius:16px;max-width:480px;width:100%;padding:32px;box-shadow:0 10px 30px rgba(20,22,43,.06)}
.logo{display:flex;align-items:center;gap:8px;font-weight:700;margin-bottom:24px;color:var(--brand);text-decoration:none}
.logo span{display:inline-grid;place-items:center;width:28px;height:28px;border-radius:8px;background:var(--brand);color:var(--brand-ink);font-size:14px}
h1{font-size:1.4rem;margin:0 0 8px}p{color:var(--muted);margin:0 0 16px}
.code{font:600 .8rem ui-monospace,monospace;color:var(--muted);letter-spacing:.04em;text-transform:uppercase;margin-bottom:8px}
label{display:block;font-weight:600;margin:16px 0 6px}input{width:100%;padding:12px 14px;border-radius:10px;border:1px solid var(--border);background:var(--bg);color:var(--text);font-size:1rem}
input:focus-visible,button:focus-visible,a:focus-visible{outline:3px solid var(--brand);outline-offset:2px}
button,.btn{display:inline-flex;justify-content:center;align-items:center;width:100%;margin-top:16px;padding:12px 16px;border-radius:10px;border:0;background:var(--brand);color:var(--brand-ink);font-weight:600;font-size:1rem;cursor:pointer;text-decoration:none}
.btn.secondary{background:transparent;color:var(--text);border:1px solid var(--border)}
.alert{padding:12px 14px;border-radius:10px;margin:16px 0;font-size:.95rem}.alert.err{background:var(--err-bg);color:var(--err)}.alert.warn{background:var(--warn-bg);color:var(--warn)}
ul{padding-left:20px;margin:8px 0 0}.dest{word-break:break-all;font:500 .9rem ui-monospace,monospace;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:10px;color:var(--text)}
`;

function layout(title: string, body: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)} · LinkPulse</title><style>${CSS}</style></head>
<body><main class="card"><a class="logo" href="/"><span>LP</span>LinkPulse</a>${body}</main></body></html>`;
}

export type LinkProblem = 'not_found' | 'expired' | 'disabled' | 'limit_reached' | 'blocked' | 'invalid';

const PROBLEMS: Record<LinkProblem, { status: number; label: string; title: string; text: string }> = {
  not_found: { status: 404, label: 'Error 404', title: 'This short link doesn’t exist', text: 'Check the address for typos. The link may never have existed or may have been deleted by its owner.' },
  invalid: { status: 404, label: 'Error 404', title: 'This short link doesn’t exist', text: 'That address is not a valid LinkPulse short code.' },
  expired: { status: 410, label: 'Link expired', title: 'This link has expired', text: 'The owner set this link to stop working after a certain date, and that date has passed.' },
  disabled: { status: 410, label: 'Link disabled', title: 'This link has been disabled', text: 'The owner has turned this link off. Contact them if you think this is a mistake.' },
  limit_reached: { status: 410, label: 'Click limit reached', title: 'This link has reached its click limit', text: 'The owner allowed only a limited number of visits, and all of them have been used.' },
  blocked: { status: 403, label: 'Blocked', title: 'This link has been blocked', text: 'The destination matched a safety blocklist, so LinkPulse will not send you there.' },
};

export function problemPage(kind: LinkProblem) {
  const p = PROBLEMS[kind];
  return {
    status: p.status,
    html: layout(p.title, `<div class="code">${esc(p.label)}</div><h1>${esc(p.title)}</h1><p>${esc(p.text)}</p><a class="btn secondary" href="/">Go to LinkPulse</a>`),
  };
}

export function passwordPage(code: string, opts: { error?: string; warnings?: string[] } = {}) {
  const warn = opts.warnings?.length
    ? `<div class="alert warn" role="note"><strong>Heads up:</strong> LinkPulse flagged this destination as suspicious:<ul>${opts.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>`
    : '';
  const err = opts.error ? `<div class="alert err" role="alert">${esc(opts.error)}</div>` : '';
  return layout('Password required', `<div class="code">Protected link</div><h1>This link is password-protected</h1>
<p>Enter the password the link owner gave you to continue.</p>${warn}${err}
<form method="post" action="/${esc(code)}" autocomplete="off">
<label for="pw">Password</label><input id="pw" name="password" type="password" required maxlength="128" autofocus>
<button type="submit">Unlock and continue</button></form>`);
}

export function warningPage(code: string, destination: string, warnings: string[]) {
  return layout('Check before you continue', `<div class="code">Safety warning</div><h1>Check before you continue</h1>
<p>LinkPulse’s automated checks flagged this destination as <strong>suspicious</strong>. This is not proof that it is harmful — but be careful, especially before entering passwords or payment details.</p>
<div class="alert warn" role="note"><ul>${warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>
<p style="margin-bottom:6px">You are about to visit:</p><div class="dest">${esc(destination)}</div>
<form method="post" action="/${esc(code)}"><input type="hidden" name="confirm" value="1"><button type="submit">I understand, continue</button></form>
<a class="btn secondary" href="/">Don’t go there</a>`);
}
