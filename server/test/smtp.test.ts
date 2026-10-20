/**
 * The built-in SMTP client, tested against an in-process fake SMTP server — plain, STARTTLS and implicit TLS
 * (TLS cases use a throw-away self-signed certificate made with the `openssl` command, and are skipped if it is missing).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import tls from 'node:tls';
import { afterAll, describe, expect, it } from 'vitest';
import { SmtpError, buildMime, sendSmtp, type SmtpMessage } from '../src/lib/smtp.js';

let cert: { key: string; cert: string } | null = null;
try {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-smtp-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', `${dir}/k.pem`, '-out', `${dir}/c.pem`, '-days', '1', '-subj', '/CN=localhost'], { stdio: 'ignore' });
  cert = { key: fs.readFileSync(`${dir}/k.pem`, 'utf8'), cert: fs.readFileSync(`${dir}/c.pem`, 'utf8') };
} catch { /* no openssl: TLS tests are skipped */ }

interface Fake { port: number; commands: { line: string; encrypted: boolean }[]; data: string[]; close(): void }
interface FakeOptions { starttls?: boolean; implicitTls?: boolean; auth?: string; rejectRcpt?: boolean }
const servers: net.Server[] = [];
afterAll(() => servers.forEach((s) => s.close()));

async function fakeServer(o: FakeOptions = {}): Promise<Fake> {
  const state: Fake = { port: 0, commands: [], data: [], close: () => {} };
  const serve = (sock: net.Socket, encrypted: boolean, greet = true) => {
    let buf = ''; let inData = false; let body = '';
    const send = (s: string) => sock.write(`${s}\r\n`);
    sock.on('error', () => {});
    sock.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      for (;;) {
        if (inData) {
          const end = buf.indexOf('\r\n.\r\n');
          if (end < 0) return;
          body = buf.slice(0, end); buf = buf.slice(end + 5); inData = false;
          state.data.push(body); send('250 queued'); continue;
        }
        const i = buf.indexOf('\r\n');
        if (i < 0) return;
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        state.commands.push({ line, encrypted });
        const cmd = line.split(' ')[0].toUpperCase();
        if (cmd === 'EHLO') {
          const f = ['250-localhost greets you'];
          if (o.starttls && !encrypted) f.push('250-STARTTLS');
          if (o.auth) f.push(`250-AUTH ${o.auth}`);
          send([...f, '250 8BITMIME'].join('\r\n'));
        } else if (cmd === 'STARTTLS') {
          send('220 go ahead');
          sock.removeAllListeners('data');
          serve(new tls.TLSSocket(sock, { isServer: true, key: cert!.key, cert: cert!.cert }), true, false); // no new greeting after STARTTLS
          return;
        } else if (cmd === 'AUTH') send('235 ok');
        else if (cmd === 'MAIL') send('250 ok');
        else if (cmd === 'RCPT') send(o.rejectRcpt ? '550 no such user' : '250 ok');
        else if (cmd === 'DATA') { send('354 go'); inData = true; }
        else if (cmd === 'QUIT') { send('221 bye'); sock.end(); return; }
        else send('500 what?');
      }
    });
    if (greet) send('220 localhost ESMTP');
  };
  const server = o.implicitTls
    ? tls.createServer({ key: cert!.key, cert: cert!.cert }, (s) => serve(s, true))
    : net.createServer((s) => serve(s, false));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  servers.push(server);
  state.port = (server.address() as net.AddressInfo).port;
  state.close = () => server.close();
  return state;
}

const message: SmtpMessage = {
  from: 'LinkPulse <no-reply@example.com>', to: 'user@example.com', subject: 'Reset your password',
  text: 'Open https://app.example/reset?token=abc123', html: '<p><a href="https://app.example/reset?token=abc123">Reset</a></p>',
};
const base = (f: Fake) => ({ host: '127.0.0.1', port: f.port, secure: false, rejectUnauthorized: false });
const part = (mime: string, type: string) => {
  const m = new RegExp(`Content-Type: ${type}; charset=utf-8\\r\\nContent-Transfer-Encoding: base64\\r\\n\\r\\n([\\s\\S]*?)\\r\\n--`).exec(mime);
  return m ? Buffer.from(m[1].replace(/\r\n/g, ''), 'base64').toString('utf8') : null;
};

describe('SMTP client', () => {
  it('delivers a multipart message with the right envelope', async () => {
    const s = await fakeServer();
    await sendSmtp({ ...base(s), starttls: 'never' }, message);
    const lines = s.commands.map((c) => c.line);
    expect(lines).toContain('MAIL FROM:<no-reply@example.com>');
    expect(lines).toContain('RCPT TO:<user@example.com>');
    const mime = s.data[0];
    expect(mime).toContain('From: LinkPulse <no-reply@example.com>');
    expect(mime).toContain('To: user@example.com');
    expect(mime).toContain('Subject: Reset your password');
    expect(mime).toContain('multipart/alternative');
    expect(part(mime + '\r\n--', 'text/plain')).toBe(message.text);
    expect(part(mime + '\r\n--', 'text/html')).toBe(message.html);
  });

  it('authenticates with AUTH PLAIN', async () => {
    const s = await fakeServer({ auth: 'PLAIN LOGIN' });
    await sendSmtp({ ...base(s), starttls: 'never', user: 'apikey', pass: 's3cret' }, message);
    const auth = s.commands.find((c) => c.line.startsWith('AUTH PLAIN'))!;
    expect(Buffer.from(auth.line.split(' ')[2], 'base64').toString()).toBe('\0apikey\0s3cret');
  });

  it('refuses to send a password over an unencrypted connection', async () => {
    const s = await fakeServer({ auth: 'PLAIN' }); // no STARTTLS offered
    await expect(sendSmtp({ ...base(s), starttls: 'auto', user: 'u', pass: 'p' }, message)).rejects.toThrow(/without TLS/);
    expect(s.commands.some((c) => c.line.startsWith('AUTH'))).toBe(false);
  });

  it('surfaces a rejected recipient as an error with the server’s code', async () => {
    const s = await fakeServer({ rejectRcpt: true });
    const err = await sendSmtp({ ...base(s), starttls: 'never' }, message).catch((e) => e);
    expect(err).toBeInstanceOf(SmtpError);
    expect(err.code).toBe(550);
    expect(s.data).toHaveLength(0);
  });

  it('cannot be tricked into extra headers, and dot-stuffs lines that start with "."', async () => {
    const s = await fakeServer();
    await sendSmtp({ ...base(s), starttls: 'never' }, { ...message, subject: 'Hi\r\nBcc: evil@example.net', to: 'user@example.com' });
    expect(s.data[0].split('\r\n').some((l) => /^Bcc:/i.test(l))).toBe(false);
    expect(s.data[0]).toContain('Subject: Hi Bcc: evil@example.net');
    expect(buildMime(message).includes('\r\n.')).toBe(false);
    await expect(sendSmtp({ ...base(s), starttls: 'never' }, { ...message, to: 'a@b.com>\r\nRCPT TO:<c@d.com' })).rejects.toThrow(/Invalid email address/);
  });

  it('encodes a non-ASCII subject (RFC 2047) and body as UTF-8', async () => {
    const s = await fakeServer();
    await sendSmtp({ ...base(s), starttls: 'never' }, { ...message, subject: 'Réinitialiser le mot de passe', text: 'Bonjour — ça marche ✓' });
    const subject = /Subject: =\?UTF-8\?B\?(.+?)\?=/.exec(s.data[0])!;
    expect(Buffer.from(subject[1], 'base64').toString('utf8')).toBe('Réinitialiser le mot de passe');
    expect(part(s.data[0] + '\r\n--', 'text/plain')).toBe('Bonjour — ça marche ✓');
  });

  it.skipIf(!cert)('upgrades with STARTTLS and only then sends credentials', async () => {
    const s = await fakeServer({ starttls: true, auth: 'PLAIN' });
    await sendSmtp({ ...base(s), starttls: 'auto', user: 'u', pass: 'p' }, message);
    expect(s.commands.find((c) => c.line.startsWith('AUTH'))!.encrypted).toBe(true);
    expect(s.commands.filter((c) => c.line.startsWith('EHLO'))).toHaveLength(2); // once before, once after the upgrade
    expect(s.data).toHaveLength(1);
  });

  it.skipIf(!cert)('works over implicit TLS (port 465 style)', async () => {
    const s = await fakeServer({ implicitTls: true, auth: 'PLAIN' });
    await sendSmtp({ host: '127.0.0.1', port: s.port, secure: true, rejectUnauthorized: false, user: 'u', pass: 'p' }, message);
    expect(s.commands.every((c) => c.encrypted)).toBe(true);
    expect(s.data).toHaveLength(1);
  });

  it.skipIf(!cert)('verifies the server certificate by default', async () => {
    const s = await fakeServer({ implicitTls: true });
    await expect(sendSmtp({ host: '127.0.0.1', port: s.port, secure: true }, message)).rejects.toThrow();
    expect(s.data).toHaveLength(0);
  });
});
