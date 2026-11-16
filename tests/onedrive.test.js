const test = require('node:test');
const assert = require('node:assert/strict');
const loadGas = require('./load-gas');

// routes: [{ match: (url, opts) => bool, status, body }] tried in order; first match answers.
function setup({ props = {}, routes = [] } = {}) {
  const store = { MS_CLIENT_ID: 'CID', MS_CLIENT_SECRET: 'SECRET', MS_REDIRECT_URI: 'https://exec', ...props };
  const cache = {};
  const calls = [];
  const mails = [];
  const gas = loadGas(['Router.gs', 'OneDrive.gs'], {
    console: { log() {}, error() {} },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: k => (k in store ? store[k] : null),
      setProperty: (k, v) => { store[k] = v; },
      deleteProperty: k => { delete store[k]; },
    }) },
    CacheService: { getScriptCache: () => ({ get: k => cache[k] || null, put: (k, v) => { cache[k] = v; } }) },
    Utilities: { getUuid: () => 'STATE-1' },
    MailApp: { sendEmail: (to, subject) => mails.push({ to, subject }) },
    Session: { getEffectiveUser: () => ({ getEmail: () => 'owner@example.com' }) },
    HtmlService: { createHtmlOutput: html => ({ html, addMetaTag() { return this; } }) },
    UrlFetchApp: {
      fetch: (url, opts = {}) => {
        calls.push({ url, opts });
        const r = routes.find(x => x.match(url, opts));
        if (!r) throw new Error('unexpected fetch ' + url);
        const body = typeof r.body === 'function' ? r.body(url, opts) : r.body;
        return { getResponseCode: () => r.status || 200, getContentText: () => (body === undefined ? '' : JSON.stringify(body)) };
      },
    },
  });
  return { gas, store, cache, calls, mails };
}

const isToken = url => url.endsWith('/oauth2/v2.0/token');
const tokenOk = (extra = {}) => ({ match: isToken, body: { access_token: 'AT', expires_in: 3600, ...extra } });
const codeOf = fn => { try { fn(); } catch (e) { return e.code || e.message; } return 'no error'; };

test('startOneDriveAuth builds a consumer sign-in link and remembers the state', () => {
  const { gas, store } = setup();
  const url = new URL(gas.startOneDriveAuth());
  assert.equal(url.origin + url.pathname, 'https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize');
  assert.equal(url.searchParams.get('client_id'), 'CID');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://exec');
  assert.equal(url.searchParams.get('scope'), 'Files.ReadWrite offline_access');
  assert.equal(url.searchParams.get('state'), 'STATE-1');
  assert.match(store.MS_AUTH_STATE, /^STATE-1\|\d+$/);
});

test('callback with the right state stores the refresh token once', () => {
  const { gas, store, calls } = setup({ routes: [tokenOk({ refresh_token: 'RT' })] });
  gas.startOneDriveAuth();
  assert.match(gas.handleOneDriveCallback_({ state: 'STATE-1', code: 'C' }), /สำเร็จ/);
  assert.equal(store.MS_REFRESH_TOKEN, 'RT');
  assert.equal(calls[0].opts.payload.grant_type, 'authorization_code');
  assert.equal(calls[0].opts.payload.redirect_uri, 'https://exec');
  assert.equal(store.MS_AUTH_STATE, undefined);
  // The same link cannot be replayed.
  assert.match(gas.handleOneDriveCallback_({ state: 'STATE-1', code: 'C' }), /ไม่ถูกต้อง/);
});

test('callback rejects a wrong or expired state without calling Microsoft', () => {
  const { gas, store, calls } = setup();
  gas.startOneDriveAuth();
  assert.match(gas.handleOneDriveCallback_({ state: 'other', code: 'C' }), /ไม่ถูกต้อง/);
  assert.ok(store.MS_AUTH_STATE, 'a wrong state must not cancel the pending sign-in');
  store.MS_AUTH_STATE = 'STATE-1|' + (Date.now() - 1);
  assert.match(gas.handleOneDriveCallback_({ state: 'STATE-1', code: 'C' }), /หมดอายุ/);
  assert.equal(calls.length, 0);
});

test('doGet escapes text that comes from the query string', () => {
  const { gas } = setup();
  gas.startOneDriveAuth();
  const out = gas.doGet({ parameter: { state: 'STATE-1', error: '<script>' } }).html;
  assert.ok(!out.includes('<script>'));
  assert.ok(out.includes('&lt;script&gt;'));
});

test('access token is cached and a rotated refresh token is saved', () => {
  const { gas, store, calls } = setup({ props: { MS_REFRESH_TOKEN: 'RT1' }, routes: [tokenOk({ refresh_token: 'RT2' })] });
  assert.equal(gas.accessToken_(), 'AT');
  assert.equal(gas.accessToken_(), 'AT');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].opts.payload.refresh_token, 'RT1');
  assert.equal(store.MS_REFRESH_TOKEN, 'RT2');
});

test('a revoked refresh token gives STORAGE_AUTH and at most one email per 6 hours', () => {
  const { gas, mails } = setup({
    props: { MS_REFRESH_TOKEN: 'RT' },
    routes: [{ match: isToken, status: 400, body: { error: 'invalid_grant' } }],
  });
  assert.equal(codeOf(() => gas.accessToken_(true)), 'STORAGE_AUTH');
  assert.equal(codeOf(() => gas.accessToken_(true)), 'STORAGE_AUTH');
  assert.equal(mails.length, 1);
  assert.equal(mails[0].to, 'owner@example.com');
});

test('not linked yet is STORAGE_AUTH, not an internal error', () => {
  const { gas, mails } = setup();
  assert.equal(codeOf(() => gas.accessToken_()), 'STORAGE_AUTH');
  assert.equal(mails.length, 1);
});

test('Graph 401 refreshes once and retries; a second 401 alerts', () => {
  // First Graph answer is 401, second 200.
  let first = true;
  const g = setup({
    props: { MS_REFRESH_TOKEN: 'RT' },
    routes: [tokenOk(), { match: u => u.includes('graph') && first && !(first = false), status: 401 }, { match: u => u.includes('graph'), body: { id: 'X' } }],
  });
  assert.equal(g.gas.graph_('get', '/me/drive').id, 'X');
  assert.equal(g.calls.filter(c => isToken(c.url)).length, 2, 'cached token then a forced refresh');

  const bad = setup({ props: { MS_REFRESH_TOKEN: 'RT' }, routes: [tokenOk(), { match: u => u.includes('graph'), status: 401 }] });
  assert.equal(codeOf(() => bad.gas.graph_('get', '/me/drive')), 'STORAGE_AUTH');
  assert.equal(bad.mails.length, 1);
});

test('trip folder path follows the design', () => {
  const { gas } = setup();
  assert.equal(gas.tripFolderPath_({ TripID: 'T20261104-03', ServiceDate: '2026-11-04', DestCode: 'MTR' }),
    'DG-Reports/2026/11/2026-11-04_T20261104-03_MTR');
});

test('upload PUTs the JPEG to an encoded path and returns the trip folder id', () => {
  const { gas, calls } = setup({
    props: { MS_REFRESH_TOKEN: 'RT' },
    routes: [tokenOk(), { match: u => u.endsWith(':/content'), body: { id: 'F1', parentReference: { id: 'DIR' } } }],
  });
  const res = gas.uploadJpeg_('DG-Reports/2026/11/2026-11-04_T20261104-03_MAT2+1', 'S1_Photo_Ticket.jpg', [1, 2]);
  assert.deepEqual({ ...res }, { itemId: 'F1', folderId: 'DIR' });
  const put = calls.find(c => c.url.endsWith(':/content'));
  assert.equal(put.opts.method, 'put');
  assert.equal(put.opts.contentType, 'image/jpeg');
  assert.equal(put.url, 'https://graph.microsoft.com/v1.0/me/drive/root:/DG-Reports/2026/11/2026-11-04_T20261104-03_MAT2%2B1/S1_Photo_Ticket.jpg:/content');
});

test('moveToHistory_ creates _history when missing, then moves and renames the item', () => {
  const { gas, calls } = setup({
    props: { MS_REFRESH_TOKEN: 'RT' },
    routes: [
      tokenOk(),
      { match: (u, o) => o.method === 'get' && u.endsWith('/_history:'), status: 404 },
      { match: (u, o) => o.method === 'post' && u.endsWith('/T1:/children'), body: { id: 'H' } },
      { match: (u, o) => o.method === 'patch', body: {} },
    ],
  });
  gas.moveToHistory_('F1', 'DG-Reports/T1', 'S1_Photo_Ticket_v1.jpg');
  const post = calls.find(c => c.opts.method === 'post' && !isToken(c.url));
  assert.equal(JSON.parse(post.opts.payload)['@microsoft.graph.conflictBehavior'], 'fail');
  const patch = calls.find(c => c.opts.method === 'patch');
  assert.ok(patch.url.endsWith('/me/drive/items/F1'));
  assert.deepEqual(JSON.parse(patch.opts.payload), { parentReference: { id: 'H' }, name: 'S1_Photo_Ticket_v1.jpg' });
});

test('download and thumbnail links are cached', () => {
  const { gas, calls } = setup({
    props: { MS_REFRESH_TOKEN: 'RT' },
    routes: [
      tokenOk(),
      { match: u => u.endsWith('/thumbnails/0/medium'), body: { url: 'https://thumb' } },
      { match: u => u.endsWith('/items/F1'), body: { '@microsoft.graph.downloadUrl': 'https://dl' } },
    ],
  });
  assert.equal(gas.downloadUrl_('F1'), 'https://dl');
  assert.equal(gas.downloadUrl_('F1'), 'https://dl');
  assert.equal(gas.thumbnailUrl_('F1'), 'https://thumb');
  assert.equal(gas.thumbnailUrl_('F1'), 'https://thumb');
  assert.equal(calls.filter(c => c.url.includes('graph')).length, 2);
});
