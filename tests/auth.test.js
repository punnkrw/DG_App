const test = require('node:test');
const assert = require('node:assert/strict');
const loadGas = require('./load-gas');
const fakeSpreadsheetApp = require('./fake-sheets');

function setup({ status = 200, body = {}, channelId = 'CHANNEL' } = {}) {
  const calls = [];
  const store = {};
  const nowSec = Math.floor(Date.now() / 1000);
  const response = { sub: 'U-driver', name: 'Test', exp: nowSec + 3600, ...body };
  const SpreadsheetApp = fakeSpreadsheetApp({
    Drivers: [['DriverCode', 'Name', 'LineUserId', 'Status', 'RegisteredAt'],
      ['D1', 'A', 'U-driver', 'Active', ''], ['D2', 'B', 'U-pending', 'Pending', '']],
    Admins: [['LineUserId', 'Name'], ['U-admin', 'Admin']],
  });
  const gas = loadGas(['Steps.gs', 'Router.gs', 'Sheets.gs', 'Auth.gs', 'Driver.gs'], {
    SpreadsheetApp,
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' },
      Charset: { UTF_8: 'utf8' },
      computeDigest: (alg, s) => [...Buffer.from(require('crypto').createHash('sha256').update(s).digest())],
      base64EncodeWebSafe: bytes => Buffer.from(bytes).toString('base64url'),
    },
    CacheService: { getScriptCache: () => ({ get: k => store[k] || null, put: (k, v, ttl) => { store[k] = v; store.ttl = ttl; } }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k === 'LINE_LOGIN_CHANNEL_ID' ? channelId : null) }) },
    UrlFetchApp: {
      fetch: (url, opts) => {
        calls.push({ url, opts });
        return { getResponseCode: () => status, getContentText: () => JSON.stringify(status === 200 ? response : { error: 'invalid_request' }) };
      },
    },
  });
  return { gas, calls, store };
}

const codeOf = fn => { try { fn(); } catch (e) { return e.code || e.message; } return 'no error'; };

test('verifies the token with LINE using the channel id, then caches it', () => {
  const { gas, calls, store } = setup();
  assert.equal(gas.verifyIdToken_('tok').userId, 'U-driver');
  assert.equal(gas.verifyIdToken_('tok').userId, 'U-driver');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.line.me/oauth2/v2.1/verify');
  assert.deepEqual({ ...calls[0].opts.payload }, { id_token: 'tok', client_id: 'CHANNEL' });
  assert.equal(store.ttl, 600);
});

test('cache never outlives the token', () => {
  const { gas, store } = setup({ body: { exp: Math.floor(Date.now() / 1000) + 120 } });
  gas.verifyIdToken_('tok');
  assert.ok(store.ttl <= 120 && store.ttl > 100);
});

test('missing, fake or expired tokens are rejected', () => {
  assert.equal(codeOf(() => setup().gas.verifyIdToken_(undefined)), 'AUTH_REQUIRED');
  assert.equal(codeOf(() => setup({ status: 400 }).gas.verifyIdToken_('fake')), 'AUTH_INVALID');
});

test('LINE outage and missing config are internal errors, not auth failures', () => {
  assert.match(codeOf(() => setup({ status: 500 }).gas.verifyIdToken_('tok')), /returned 500/);
  assert.match(codeOf(() => setup({ channelId: null }).gas.verifyIdToken_('tok')), /LINE_LOGIN_CHANNEL_ID/);
});

test('requireDriver_ accepts only Active drivers', () => {
  const req = { auth: { idToken: 'tok' } };
  assert.equal(setup().gas.requireDriver_(req).driver.DriverCode, 'D1');
  assert.equal(codeOf(() => setup({ body: { sub: 'U-pending' } }).gas.requireDriver_(req)), 'NOT_DRIVER');
  assert.equal(codeOf(() => setup({ body: { sub: 'U-nobody' } }).gas.requireDriver_(req)), 'NOT_DRIVER');
});

test('requireAdmin_ accepts only users in Admins', () => {
  const req = { auth: { idToken: 'tok' } };
  assert.equal(setup({ body: { sub: 'U-admin' } }).gas.requireAdmin_(req).admin.Name, 'Admin');
  assert.equal(codeOf(() => setup().gas.requireAdmin_(req)), 'FORBIDDEN');
});

test('driver.me uses the verified user, ignoring a userId sent by the page', () => {
  const { gas } = setup();
  const req = { action: 'driver.me', auth: { idToken: 'tok' }, userId: 'U-spoofed' };
  assert.deepEqual(JSON.parse(JSON.stringify(gas.driverMe_(req))), {
    userId: 'U-driver', lineName: 'Test', driver: { driverCode: 'D1', name: 'A', status: 'Active' },
  });
  const other = setup({ body: { sub: 'U-nobody' } }).gas.driverMe_({ auth: { idToken: 'tok' } });
  assert.equal(other.driver, null);
});
