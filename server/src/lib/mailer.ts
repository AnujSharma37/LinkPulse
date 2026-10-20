import { config } from '../config.js';
import { sendSmtp } from './smtp.js';

export interface MailMessage { to: string; subject: string; text: string; html: string }

/** Messages "sent" while EMAIL_PROVIDER=memory (automated tests read the links out of here). */
export const outbox: MailMessage[] = [];

async function sendViaResend(msg: MailMessage) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${config.resendApiKey}`, 'content-type': 'application/json' },
    signal: AbortSignal.timeout(8000),
    body: JSON.stringify({ from: config.emailFrom, to: [msg.to], subject: msg.subject, text: msg.text, html: msg.html }),
  });
  if (!res.ok) throw new Error(`Resend responded with HTTP ${res.status}`);
}

/**
 * Deliver one e-mail. Providers:
 *  - console: prints the message (development only; in production nothing is printed so tokens never reach the logs)
 *  - resend : https://resend.com HTTPS API (needs RESEND_API_KEY and a verified EMAIL_FROM)
 *  - smtp   : any SMTP server (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS; TLS is required before credentials are sent)
 *  - memory : collects messages in `outbox` (tests)
 * Callers must not let a delivery failure change what the HTTP response says (that would leak which accounts exist).
 */
export async function sendMail(msg: MailMessage): Promise<void> {
  switch (config.emailProvider) {
    case 'memory':
      outbox.push(msg);
      return;
    case 'resend':
      return sendViaResend(msg);
    case 'smtp':
      return sendSmtp(
        { host: config.smtpHost, port: config.smtpPort, secure: config.smtpSecure, user: config.smtpUser || undefined, pass: config.smtpPass },
        { from: config.emailFrom, to: msg.to, subject: msg.subject, text: msg.text, html: msg.html },
      );
    default:
      if (config.isProd) console.warn(`[mail] EMAIL_PROVIDER is "console": not sending "${msg.subject}". Configure a provider to deliver email.`);
      else console.log(`\n[mail → ${msg.to}] ${msg.subject}\n${msg.text}\n`);
  }
}

/** Fire-and-forget: send in the background and only log failures. Keeps response timing independent of delivery. */
export function sendMailInBackground(msg: MailMessage): void {
  sendMail(msg).catch((e) => console.error(`[mail] failed to send "${msg.subject}":`, (e as Error).message));
}
