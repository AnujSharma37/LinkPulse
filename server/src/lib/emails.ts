import { config } from '../config.js';
import { esc } from '../shared/pages.js';
import type { MailMessage } from './mailer.js';

const link = (path: string, token: string) => `${config.appOrigin}${path}?token=${encodeURIComponent(token)}`;

function layout(heading: string, intro: string, cta: string, url: string, outro: string): Pick<MailMessage, 'html' | 'text'> {
  const text = `${heading}\n\n${intro}\n\n${cta}: ${url}\n\n${outro}\n\n— LinkPulse`;
  const html = `<!doctype html><html><body style="margin:0;background:#f6f7fb;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#14162b">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px">
<table role="presentation" width="480" style="max-width:100%;background:#fff;border-radius:16px;padding:32px">
<tr><td><h1 style="font-size:20px;margin:0 0 12px">${esc(heading)}</h1>
<p style="margin:0 0 20px;line-height:1.55;color:#5b6078">${esc(intro)}</p>
<p style="margin:0 0 20px"><a href="${esc(url)}" style="display:inline-block;background:#5b4cf0;color:#fff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:10px">${esc(cta)}</a></p>
<p style="margin:0 0 8px;font-size:13px;color:#5b6078;word-break:break-all">Or paste this link into your browser:<br>${esc(url)}</p>
<p style="margin:16px 0 0;font-size:13px;color:#5b6078">${esc(outro)}</p></td></tr></table></td></tr></table></body></html>`;
  return { text, html };
}

export function verifyEmailMessage(to: string, token: string): MailMessage {
  const url = link('/verify-email', token);
  return {
    to, subject: 'Confirm your LinkPulse email address',
    ...layout('Confirm your email', `This link confirms that ${to} is your address. It works once and expires in ${config.verifyTokenTtlHours} hours.`,
      'Confirm email address', url, 'If you did not create a LinkPulse account, you can ignore this message.'),
  };
}

export function resetPasswordMessage(to: string, token: string): MailMessage {
  const url = link('/reset-password', token);
  return {
    to, subject: 'Reset your LinkPulse password',
    ...layout('Reset your password', `Use this link to choose a new password. It works once and expires in ${config.resetTokenTtlMinutes} minutes.`,
      'Choose a new password', url, 'If you did not ask for this, ignore this message — your password has not changed.'),
  };
}

export function passwordChangedMessage(to: string): MailMessage {
  const url = `${config.appOrigin}/forgot-password`;
  return {
    to, subject: 'Your LinkPulse password was changed',
    ...layout('Your password was changed', 'You were signed out of every device. If this was you, no action is needed.',
      'Secure my account', url, 'If this was not you, use the button to reset your password right away.'),
  };
}

/** Sent instead of a confirmation link when someone signs up with an address that already has an account. */
export function accountExistsMessage(to: string): MailMessage {
  return {
    to, subject: 'You already have a LinkPulse account',
    ...layout('You already have an account', `Someone (hopefully you) tried to create a LinkPulse account with ${to}, which is already registered.`,
      'Log in', `${config.appOrigin}/login`, 'Forgot your password? Use “Forgot your password?” on the login page. If this wasn’t you, ignore this message — nothing has changed.'),
  };
}
