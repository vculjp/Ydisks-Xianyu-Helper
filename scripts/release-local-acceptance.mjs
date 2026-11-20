// 发布候选本地验收：只使用临时目录、随机端口及虚构资料，不绑定真实店铺。
import { spawn } from 'node:child_process';
import { mkdtempSync, openSync, closeSync, copyFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';

const exe = resolve('xianyu-server-rc.exe');
assert(existsSync(exe), 'Build xianyu-server-rc.exe first');
const secondsArg = process.argv.slice(2).find(arg => arg.startsWith('--soak-seconds='));
const seconds = secondsArg ? Number(secondsArg.split('=')[1]) : 0;
assert(Number.isSafeInteger(seconds) && seconds >= 0 && seconds <= 86400, 'Invalid soak duration');
const root = mkdtempSync(join(tmpdir(), 'xianyu-rc-acceptance-'));
const source = join(root, 'source');
const restored = join(root, 'restored');
mkdirSync(source);
mkdirSync(restored);
const password = `Test-${randomBytes(18).toString('hex')}`;
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(XIANYU_|DATABASE_URL$)/i.test(key)));
const fixture = { enabled: false, entries: [{ scope: 'global', account_id: '', item_id: '', title: 'RC fixture', question: 'How to use?', answer: 'Read the test manual' }] };
let child, exited, base;
const cookies = new Map();

async function stop() {
  if (child && child.exitCode === null && child.signalCode === null) child.kill();
  if (exited) await exited;
  child = null;
  exited = null;
}

async function start(dir) {
  const listener = createServer();
  await new Promise((ok, fail) => listener.once('error', fail).listen(0, '127.0.0.1', ok));
  const port = listener.address().port;
  await new Promise((ok, fail) => listener.close(err => err ? fail(err) : ok()));
  base = `http://127.0.0.1:${port}`;
  cookies.clear();
  const fd = openSync(join(dir, 'server.log'), 'w');
  try {
    child = spawn(exe, ['-addr', `127.0.0.1:${port}`, '-db', join(dir, 'test.db'), '-workdir', dir, '-data-key-file', join(dir, 'data.key')], { cwd: dir, env, stdio: ['ignore', fd, fd], windowsHide: true });
    exited = new Promise(ok => { child.once('exit', ok); child.once('error', ok); });
  } finally { closeSync(fd); }
  for (let i = 0; i < 120; i++) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error('Server exited before health check');
    try { const res = await fetch(base + '/health', { signal: AbortSignal.timeout(1500) }); if (res.ok && (await res.text()).includes('"ok"')) return; } catch {}
    await sleep(500);
  }
  throw new Error('Server health timeout');
}

async function request(method, path, body, status = 200) {
  const headers = {};
  if (cookies.size) headers.Cookie = [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual', signal: AbortSignal.timeout(15000) });
  for (const item of res.headers.getSetCookie()) {
    const first = item.split(';')[0], i = first.indexOf('='), key = first.slice(0, i), value = first.slice(i + 1);
    if (!value || /Max-Age=0(?:;|$)/i.test(item)) cookies.delete(key); else cookies.set(key, value);
  }
  assert.equal(res.status, status, `${method} ${path}`);
  return res.json();
}

async function checkFixture() {
  const settings = await request('GET', '/api/v1/settings/user');
  assert.deepEqual(JSON.parse(settings.customer_support_v1), fixture);
}

let passed = false;
try {
  await start(source);
  await request('GET', '/api/v1/accounts', undefined, 401);
  await request('POST', '/api/v1/session/initialize', { password });
  await request('PUT', '/api/v1/settings/user/customer_support_v1', { value: JSON.stringify(fixture) });
  await checkFixture();
  console.log('PASS: isolated initialization, auth, settings persistence');
  // Windows child.kill 是故障式停止，并非优雅退出测试；确认进程结束后再做 SQLite 一致性快照。
  await stop();
  const db = new DatabaseSync(join(source, 'test.db'));
  try {
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    db.prepare('VACUUM INTO ?').run(join(restored, 'test.db'));
  } finally { db.close(); }
  copyFileSync(join(source, 'data.key'), join(restored, 'data.key'));
  const snapshot = new DatabaseSync(join(restored, 'test.db'), { readOnly: true });
  try { assert.equal(snapshot.prepare('PRAGMA integrity_check').get().integrity_check, 'ok'); } finally { snapshot.close(); }
  await start(restored);
  const session = await request('GET', '/api/v1/session');
  assert.equal(session.initialized, true);
  await request('POST', '/api/v1/session/login', { username: 'admin', password });
  await checkFixture();
  await request('GET', '/api/v1/accounts');
  console.log('PASS: SQLite snapshot, key copy, integrity check, restore and login');
  if (seconds) {
    const started = Date.now();
    let count = 0, worst = 0;
    while (Date.now() - started < seconds * 1000) {
      const t = performance.now();
      await request('GET', '/health');
      await checkFixture();
      worst = Math.max(worst, performance.now() - t);
      count++;
      if (count % 60 === 0) console.log(`SOAK elapsed=${Math.round((Date.now() - started) / 1000)}s checks=${count}`);
      await sleep(1000);
    }
    console.log(`PASS: isolated soak ${seconds}s, ${count} iterations, max pair latency ${Math.round(worst)}ms`);
  }
  passed = true;
} catch (error) {
  console.error('FAIL:', error.message, 'isolated logs:', root);
  process.exitCode = 1;
} finally {
  await stop();
  if (passed) rmSync(root, { recursive: true, force: true });
}
