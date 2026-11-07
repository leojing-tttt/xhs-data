import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

const DUMMY_PASSWORD = {
  algorithm: 'scrypt',
  salt: '11'.repeat(16),
  hash: '22'.repeat(32),
  keylen: 32,
  cost: 16384,
  blockSize: 8,
  parallelization: 1,
};

export function loadUsers(file) {
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  if (!raw || !Array.isArray(raw.users)) {
    throw new Error('users config must contain a users array');
  }
  return raw.users;
}

export function hashPassword(password, salt = randomBytes(16)) {
  const keylen = 32;
  const cost = 16384;
  const blockSize = 8;
  const parallelization = 1;
  const hash = scryptSync(password, salt, keylen, {
    N: cost,
    r: blockSize,
    p: parallelization,
  });
  return {
    algorithm: 'scrypt',
    salt: Buffer.isBuffer(salt) ? salt.toString('hex') : String(salt),
    hash: hash.toString('hex'),
    keylen,
    cost,
    blockSize,
    parallelization,
  };
}

export function verifyPassword(record, password) {
  try {
    if (!record || record.algorithm !== 'scrypt') return false;
    if (typeof password !== 'string') return false;
    const salt = Buffer.from(String(record.salt || ''), 'hex');
    const expected = Buffer.from(String(record.hash || ''), 'hex');
    if (!salt.length || expected.length !== record.keylen) return false;
    const actual = scryptSync(password, salt, record.keylen, {
      N: record.cost,
      r: record.blockSize,
      p: record.parallelization,
    });
    if (actual.length !== expected.length) return false;
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function authenticate(users, username, password) {
  const name = typeof username === 'string' ? username : '';
  const pass = typeof password === 'string' ? password : '';
  const user = users.find((item) => item && item.username === name);
  const ok = verifyPassword(user ? user.password : DUMMY_PASSWORD, pass);
  if (!user || !ok) return null;
  return {
    username: user.username,
    displayName: user.displayName || user.username,
  };
}

export function createSessionToken(username, secret, now = Date.now()) {
  const body = Buffer.from(JSON.stringify({
    u: username,
    exp: now + SESSION_TTL_MS,
  })).toString('base64url');
  const sig = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function readSessionToken(token, secret, now = Date.now()) {
  if (typeof token !== 'string' || !secret) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expected = createHmac('sha256', secret).update(body).digest('base64url');
  const actualBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (actualBuf.length !== expectedBuf.length || !timingSafeEqual(actualBuf, expectedBuf)) {
    return null;
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!payload || typeof payload.u !== 'string' || typeof payload.exp !== 'number') return null;
  if (payload.exp <= now) return null;
  return { username: payload.u };
}

export function sessionCookie(token, maxAgeSeconds = SESSION_TTL_MS / 1000) {
  return `pc_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}`;
}

export function clearSessionCookie() {
  return 'pc_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0';
}

export function readCookie(header, name) {
  if (!header) return '';
  for (const part of header.split(';')) {
    const text = part.trim();
    const eq = text.indexOf('=');
    if (eq === -1) continue;
    if (text.slice(0, eq) === name) return text.slice(eq + 1);
  }
  return '';
}

export async function ensureSessionSecret(file) {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  try {
    const existing = (await readFile(file, 'utf8')).trim();
    if (existing) return existing;
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  const secret = randomBytes(32).toString('hex');
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${secret}\n`, { mode: 0o600 });
  return secret;
}
