import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));

async function freePort() {
  const socket = createServer();
  await new Promise((resolve, reject) => {
    socket.once('error', reject);
    socket.listen(0, '127.0.0.1', resolve);
  });
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  return port;
}

async function launch(env) {
  const child = spawn(process.execPath, ['src/server.js'], {cwd: root, env, stdio: ['ignore', 'pipe', 'pipe']});
  let output = '';
  const closed = new Promise(resolve => child.once('close', resolve));
  const stop = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
    try { await closed; } finally { clearTimeout(timer); }
  };
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Startup timed out: ' + output)), 10000);
      const finish = error => {clearTimeout(timer); error ? reject(error) : resolve();};
      child.once('error', finish);
      child.once('exit', code => finish(new Error(`Server exited ${code}: ${output}`)));
      child.stderr.on('data', chunk => {output += chunk;});
      child.stdout.on('data', chunk => {
        output += chunk;
        if (output.includes('Marylee Content listening on 0.0.0.0:')) finish();
      });
    });
    return {stop};
  } catch (error) {
    await stop();
    throw error;
  }
}

test('production entrypoint starts with a Railway volume and keeps the catalog after restart', {timeout: 30000}, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'marylee-startup-'));
  const port = await freePort();
  const password = 'startup-test-only-password';
  const env = {
    PATH: process.env.PATH, NODE_ENV: 'production', PORT: String(port),
    RAILWAY_ENVIRONMENT_ID: 'test-environment', RAILWAY_VOLUME_MOUNT_PATH: dir,
    MARYLEE_ADMIN_PASSWORD: password,
  };
  const url = `http://127.0.0.1:${port}`;
  let processHandle;
  try {
    processHandle = await launch(env);
    const health = await fetch(url + '/healthz');
    assert.equal(health.status, 200);
    assert.equal((await health.json()).app, 'marylee-content');
    assert.equal((await fetch(url + '/api/state')).status, 401);
    const login = await fetch(url + '/api/login', {
      method: 'POST', headers: {'X-Marylee': '1', 'Content-Type': 'application/json'},
      body: JSON.stringify({password}),
    });
    assert.equal(login.status, 200);
    assert.match(login.headers.get('set-cookie'), /; Secure/);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const create = await fetch(url + '/api/products', {
      method: 'POST', headers: {cookie, 'X-Marylee': '1', 'Content-Type': 'application/json'},
      body: JSON.stringify({name: 'Товар після перезапуску', price: 1234}),
    });
    assert.equal(create.status, 201);
    const product = await create.json();
    assert.ok((await stat(path.join(dir, 'marylee.sqlite'))).isFile());
    await processHandle.stop();
    processHandle = await launch(env);
    const state = await fetch(url + '/api/state', {headers: {cookie}});
    assert.equal(state.status, 200);
    assert.equal((await state.json()).products.find(p => p.id === product.id)?.price, 1234);
  } finally {
    await processHandle?.stop();
    await rm(dir, {recursive: true, force: true});
  }
});
