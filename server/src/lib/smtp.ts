import crypto from 'node:crypto';
import net from 'node:net';
import tls from 'node:tls';

/**
 * A small SMTP client (RFC 5321) with no dependencies: implicit TLS (port 465) or STARTTLS (587),
 * AUTH PLAIN / LOGIN, and a UTF-8 multipart/alternative message. It exists so any provider (Gmail, Brevo,
 * Mailgun, Postmark, a company relay…) works without adding a package. It sends ONE message per connection.
 */
export interface SmtpOptions {
  host: string;
  port: number;
  /** true = TLS from the first byte (port 465). false = plain connection, upgraded with STARTTLS. */
  secure: boolean;
  /** "auto": upgrade when the server offers STARTTLS. "never": stay unencrypted (local testing only). */
  starttls?: 'auto' | 'never';
  user?: string;
  pass?: string;
  /** Verify the server's certificate (default true). */
  rejectUnauthorized?: boolean;
  /** Name announced in EHLO. */
  heloName?: string;
  timeoutMs?: number;
}

export interface SmtpMessage { from: string; to: string; subject: string; text: string; html: string }

interface Reply { code: number; lines: string[] }

export class SmtpError extends Error {
  constructor(message: string, readonly code?: number) { super(message); this.name = 'SmtpError'; }
}

/** Strip anything that could start a new header or break the envelope. */
const clean = (s: string) => s.replace(/[\r\n\0]+/g, ' ').trim();
const addressOf = (s: string) => {
  const m = /<([^<>\s]+)>\s*$/.exec(s) ?? /^([^<>\s]+)$/.exec(s.trim());
  if (!m || /[\r\n\0]/.test(m[1])) throw new SmtpError(`Invalid email address: ${clean(s)}`);
  return m[1];
};
const encodeWord = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`);
const base64Lines = (s: string) => (Buffer.from(s, 'utf8').toString('base64').match(/.{1,76}/g) ?? ['']).join('\r\n');

/** Build the RFC 5322 message (headers + MIME body). Exported for tests. */
export function buildMime(msg: SmtpMessage, now = new Date(), host = 'linkpulse.local'): string {
  const boundary = `lp_${crypto.randomBytes(12).toString('hex')}`;
  const from = clean(msg.from);
  const fromAddr = addressOf(from);
  const displayName = from.replace(/<[^>]*>\s*$/, '').trim().replace(/^"|"$/g, '');
  const fromHeader = displayName ? `${encodeWord(displayName)} <${fromAddr}>` : fromAddr;
  return [
    `From: ${fromHeader}`,
    `To: ${addressOf(clean(msg.to))}`,
    `Subject: ${encodeWord(clean(msg.subject))}`,
    `Date: ${now.toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${crypto.randomBytes(16).toString('hex')}@${host}>`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Lines(msg.text),
    `--${boundary}`,
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Lines(msg.html),
    `--${boundary}--`,
    '',
  ].join('\r\n');
}

/** Reads CRLF-terminated server replies (including multi-line "250-..." replies) from a socket. */
function replyReader(sock: net.Socket) {
  let buffer = '';
  let partial: string[] = [];
  const ready: Reply[] = [];
  let waiter: { resolve: (r: Reply) => void; reject: (e: Error) => void } | null = null;
  let failure: Error | null = null;

  const deliver = () => { if (waiter && ready.length) { const w = waiter; waiter = null; w.resolve(ready.shift()!); } };
  const fail = (e: Error) => { failure ??= e; if (waiter) { const w = waiter; waiter = null; w.reject(failure); } };

  const onData = (chunk: Buffer) => {
    buffer += chunk.toString('utf8');
    let i: number;
    while ((i = buffer.indexOf('\r\n')) >= 0) {
      const line = buffer.slice(0, i); buffer = buffer.slice(i + 2);
      partial.push(line);
      if (/^\d{3}( |$)/.test(line)) { ready.push({ code: Number(line.slice(0, 3)), lines: partial }); partial = []; }
    }
    deliver();
  };
  sock.on('data', onData);
  sock.on('error', (e) => fail(e));
  sock.on('close', () => fail(new SmtpError('Connection closed by the server')));

  return {
    next: () => new Promise<Reply>((resolve, reject) => {
      if (ready.length) return resolve(ready.shift()!);
      if (failure) return reject(failure);
      waiter = { resolve, reject };
    }),
    detach: () => sock.off('data', onData),
  };
}

export async function sendSmtp(opts: SmtpOptions, msg: SmtpMessage): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const helo = opts.heloName ?? 'linkpulse.local';
  const reject = opts.rejectUnauthorized ?? true;
  // SNI must be a host name; sending an IP address there is not allowed (RFC 6066).
  const servername = net.isIP(opts.host) ? undefined : opts.host;

  let sock: net.Socket = await new Promise<net.Socket>((resolve, rejectConn) => {
    const s = opts.secure
      ? tls.connect({ host: opts.host, port: opts.port, servername, rejectUnauthorized: reject }, () => resolve(s))
      : net.connect({ host: opts.host, port: opts.port }, () => resolve(s));
    s.once('error', rejectConn);
  });
  sock.setTimeout(timeoutMs, () => sock.destroy(new SmtpError('SMTP connection timed out')));
  let reader = replyReader(sock);

  const expect = async (accept: number[], what: string): Promise<Reply> => {
    const r = await reader.next();
    if (!accept.includes(r.code)) throw new SmtpError(`SMTP ${what} failed: ${r.lines.join(' / ')}`, r.code);
    return r;
  };
  const command = async (line: string, accept: number[], what: string) => { sock.write(`${line}\r\n`); return expect(accept, what); };

  try {
    await expect([220], 'greeting');
    let features = (await command(`EHLO ${helo}`, [250], 'EHLO')).lines.map((l) => l.slice(4).toUpperCase());

    let encrypted = opts.secure;
    if (!opts.secure && opts.starttls !== 'never' && features.includes('STARTTLS')) {
      await command('STARTTLS', [220], 'STARTTLS');
      reader.detach();
      sock = await new Promise<net.Socket>((resolve, rejectTls) => {
        const t = tls.connect({ socket: sock, servername, rejectUnauthorized: reject }, () => resolve(t));
        t.once('error', rejectTls);
      });
      sock.setTimeout(timeoutMs, () => sock.destroy(new SmtpError('SMTP connection timed out')));
      reader = replyReader(sock);
      encrypted = true;
      features = (await command(`EHLO ${helo}`, [250], 'EHLO after STARTTLS')).lines.map((l) => l.slice(4).toUpperCase());
    }

    if (opts.user) {
      // Never send a password over a connection an eavesdropper can read.
      if (!encrypted && opts.starttls !== 'never') throw new SmtpError('Refusing to send SMTP credentials without TLS (server did not offer STARTTLS).');
      const auth = features.find((f) => f.startsWith('AUTH')) ?? '';
      if (auth.includes('PLAIN') || !auth) {
        await command(`AUTH PLAIN ${Buffer.from(`\0${opts.user}\0${opts.pass ?? ''}`).toString('base64')}`, [235], 'authentication');
      } else if (auth.includes('LOGIN')) {
        await command('AUTH LOGIN', [334], 'AUTH LOGIN');
        await command(Buffer.from(opts.user).toString('base64'), [334], 'AUTH LOGIN user');
        await command(Buffer.from(opts.pass ?? '').toString('base64'), [235], 'authentication');
      } else {
        throw new SmtpError(`Server offers no supported AUTH method (${auth}).`);
      }
    }

    await command(`MAIL FROM:<${addressOf(clean(msg.from))}>`, [250], 'MAIL FROM');
    await command(`RCPT TO:<${addressOf(clean(msg.to))}>`, [250, 251], 'RCPT TO');
    await command('DATA', [354], 'DATA');
    // Dot-stuffing: a body line that starts with "." must be doubled so it can't end the message early.
    const body = buildMime(msg).replace(/^\./gm, '..');
    sock.write(`${body}\r\n.\r\n`);
    await expect([250], 'message delivery');
    sock.write('QUIT\r\n');
  } finally {
    sock.destroy();
  }
}
