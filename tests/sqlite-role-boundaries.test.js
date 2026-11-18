'use strict';

const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const dataDir = path.join(os.tmpdir(), `studymate-role-test-${process.pid}-${Date.now()}`);
let child;
let baseUrl;
let startupOutput = '';

async function unusedPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function waitForHealth() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Test server exited early. ${startupOutput}`);
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Test server did not become healthy. ${startupOutput}`);
}

async function login(email, password) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await response.json();
  assert.equal(response.status, 200, body.error);
  return body;
}

async function getWithToken(route, token) {
  return fetch(`${baseUrl}${route}`, { headers: { authorization: `Bearer ${token}` } });
}

after(async () => {
  if (child && child.exitCode === null) {
    child.kill();
    await new Promise(resolve => child.once('exit', resolve));
  }
  await fs.rm(dataDir, { recursive: true, force: true });
});

test('SQLite Manager can use manager routes but cannot use admin routes', async () => {
  const port = await unusedPort();
  baseUrl = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [path.join(projectRoot, 'server', 'sqlite.js')], {
    cwd: projectRoot,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DATA_DIR: dataDir,
      PORT: String(port),
      HOST: '127.0.0.1',
      ADMIN_EMAIL: 'audit-admin@example.test',
      ADMIN_PASSWORD: 'AuditAdminPass123!',
      MANAGER_EMAIL: 'audit-manager@example.test',
      MANAGER_PASSWORD: 'AuditManagerPass123!',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', data => { startupOutput += data.toString(); });
  child.stderr.on('data', data => { startupOutput += data.toString(); });
  await waitForHealth();

  const manager = await login('audit-manager@example.test', 'AuditManagerPass123!');
  assert.equal(manager.user.role, 'manager');
  const managerPanel = await getWithToken('/api/manager/overview', manager.token);
  assert.equal(managerPanel.status, 200);
  const managerAdminPanel = await getWithToken('/api/admin/overview', manager.token);
  assert.equal(managerAdminPanel.status, 403);

  const admin = await login('audit-admin@example.test', 'AuditAdminPass123!');
  assert.equal(admin.user.role, 'admin');
  const adminPanel = await getWithToken('/api/admin/overview', admin.token);
  assert.equal(adminPanel.status, 200);
});
