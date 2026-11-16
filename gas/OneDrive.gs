// OneDrive Personal through Microsoft Graph. Secrets live in Script Properties only.
// The owner links the Microsoft account once: run startOneDriveAuth() in the editor and open the logged link.

const MS_AUTH = 'https://login.microsoftonline.com/consumers/oauth2/v2.0';
const MS_SCOPE = 'Files.ReadWrite offline_access';
const GRAPH = 'https://graph.microsoft.com/v1.0';
const ROOT_FOLDER = 'DG-Reports';
const LINK_CACHE_SECONDS = 45 * 60;
const AUTH_STATE_MINUTES = 15;
const ALERT_EVERY_HOURS = 6;

function props_() {
  return PropertiesService.getScriptProperties();
}

function requiredProp_(key) {
  const v = props_().getProperty(key);
  if (!v) throw new Error('Script property ' + key + ' is not set');
  return v;
}

function query_(params) {
  return Object.keys(params).map(k => k + '=' + encodeURIComponent(params[k])).join('&');
}

// Run from the editor. Logs a Microsoft sign-in link that works once, within 15 minutes.
function startOneDriveAuth() {
  const state = Utilities.getUuid();
  props_().setProperty('MS_AUTH_STATE', state + '|' + (Date.now() + AUTH_STATE_MINUTES * 60000));
  const url = MS_AUTH + '/authorize?' + query_({
    client_id: requiredProp_('MS_CLIENT_ID'),
    response_type: 'code',
    redirect_uri: requiredProp_('MS_REDIRECT_URI'),
    response_mode: 'query',
    scope: MS_SCOPE,
    state: state,
    prompt: 'select_account',
  });
  console.log('เปิดลิงก์นี้ภายใน ' + AUTH_STATE_MINUTES + ' นาที แล้วล็อกอินบัญชี Microsoft ที่เก็บรูป:\n' + url);
  return url;
}

// Microsoft redirects the browser to GET /exec?code=...&state=... Returns a message for the page.
function handleOneDriveCallback_(p) {
  const saved = (props_().getProperty('MS_AUTH_STATE') || '').split('|');
  if (!p.state || p.state !== saved[0]) return 'ลิงก์ไม่ถูกต้อง เริ่มใหม่ด้วย startOneDriveAuth';
  props_().deleteProperty('MS_AUTH_STATE');
  if (Date.now() > Number(saved[1])) return 'ลิงก์หมดอายุ เริ่มใหม่ด้วย startOneDriveAuth';
  if (p.error) return 'Microsoft ปฏิเสธ: ' + p.error + ' ' + (p.error_description || '');
  tokenRequest_({ grant_type: 'authorization_code', code: p.code, redirect_uri: requiredProp_('MS_REDIRECT_URI') });
  props_().deleteProperty('MS_ALERT_AT');
  return 'เชื่อม OneDrive สำเร็จ ปิดหน้านี้ได้';
}

// Exchanges a code or refresh token. Microsoft may rotate the refresh token, so a new one is always saved.
function tokenRequest_(params) {
  const res = UrlFetchApp.fetch(MS_AUTH + '/token', {
    method: 'post',
    payload: Object.assign({
      client_id: requiredProp_('MS_CLIENT_ID'),
      client_secret: requiredProp_('MS_CLIENT_SECRET'),
      scope: MS_SCOPE,
    }, params),
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  const body = JSON.parse(res.getContentText() || '{}');
  if (code === 400 || code === 401) {
    alertStorageAuth_('Microsoft ปฏิเสธ token (' + (body.error || code) + ')');
    throw storageAuthError_();
  }
  if (code !== 200) throw new Error('Microsoft token endpoint returned ' + code + ': ' + res.getContentText());
  if (body.refresh_token) props_().setProperty('MS_REFRESH_TOKEN', body.refresh_token);
  const ttl = Math.min(21600, body.expires_in - 300);
  if (ttl > 0) CacheService.getScriptCache().put('ms:at', body.access_token, ttl);
  return body.access_token;
}

function accessToken_(forceRefresh) {
  if (!forceRefresh) {
    const hit = CacheService.getScriptCache().get('ms:at');
    if (hit) return hit;
  }
  const refresh = props_().getProperty('MS_REFRESH_TOKEN');
  if (!refresh) {
    alertStorageAuth_('ยังไม่ได้เชื่อม OneDrive');
    throw storageAuthError_();
  }
  return tokenRequest_({ grant_type: 'refresh_token', refresh_token: refresh });
}

function storageAuthError_() {
  return new ApiError('STORAGE_AUTH', 'ระบบเก็บรูปใช้งานไม่ได้ชั่วคราว กรุณาแจ้งแอดมิน');
}

// Emails the script owner, at most once every 6 hours.
function alertStorageAuth_(reason) {
  const last = Number(props_().getProperty('MS_ALERT_AT') || 0);
  if (Date.now() - last < ALERT_EVERY_HOURS * 3600000) return;
  props_().setProperty('MS_ALERT_AT', String(Date.now()));
  MailApp.sendEmail(Session.getEffectiveUser().getEmail(), 'DG Trip Report: อัปโหลดรูปไม่ได้',
    'ระบบเชื่อม OneDrive ไม่ได้: ' + reason + '\n\n' +
    'วิธีแก้: เปิดโปรเจกต์ Apps Script ของ DG Trip Report > เลือกฟังก์ชัน startOneDriveAuth > Run\n' +
    'แล้วเปิดลิงก์ใน Execution log ภายใน ' + AUTH_STATE_MINUTES + ' นาที และล็อกอินบัญชี Microsoft ที่เก็บรูป');
}

// Calls Graph. On 401 it refreshes the access token once and retries.
// opts: { json, bytes, contentType, allow404 }
function graph_(method, path, opts) {
  opts = opts || {};
  for (let attempt = 0; attempt < 2; attempt++) {
    const req = { method: method, headers: { Authorization: 'Bearer ' + accessToken_(attempt > 0) }, muteHttpExceptions: true };
    if (opts.json) {
      req.contentType = 'application/json';
      req.payload = JSON.stringify(opts.json);
    } else if (opts.bytes) {
      req.contentType = opts.contentType;
      req.payload = opts.bytes;
    }
    const res = UrlFetchApp.fetch(GRAPH + path, req);
    const code = res.getResponseCode();
    if (code === 401 && attempt === 0) continue;
    if (code === 401) {
      alertStorageAuth_('Graph ตอบ 401');
      throw storageAuthError_();
    }
    if (code === 404 && opts.allow404) return null;
    if (code >= 300) throw new Error('Graph ' + method + ' ' + path + ' returned ' + code + ': ' + res.getContentText());
    const text = res.getContentText();
    return text ? JSON.parse(text) : {};
  }
}

// Drive path like 'DG-Reports/2026/11/x.jpg' to the Graph form 'root:/DG-Reports/2026/11/x.jpg:'.
function drivePath_(path) {
  return '/me/drive/root:/' + path.split('/').map(encodeURIComponent).join('/') + ':';
}

// trip: { TripID, ServiceDate ('yyyy-MM-dd' or Date), DestCode } -> 'DG-Reports/2026/11/2026-11-04_T20261104-03_MTR'
function tripFolderPath_(trip) {
  const date = trip.ServiceDate instanceof Date
    ? Utilities.formatDate(trip.ServiceDate, 'Asia/Bangkok', 'yyyy-MM-dd')
    : String(trip.ServiceDate);
  return [ROOT_FOLDER, date.slice(0, 4), date.slice(5, 7), date + '_' + trip.TripID + '_' + trip.DestCode].join('/');
}

// Simple upload (< 4 MB). Missing parent folders are created by OneDrive.
// Returns { itemId, folderId }; folderId is the trip folder.
function uploadJpeg_(folderPath, fileName, bytes) {
  const item = graph_('put', drivePath_(folderPath + '/' + fileName) + '/content', { bytes: bytes, contentType: 'image/jpeg' });
  return { itemId: item.id, folderId: item.parentReference.id };
}

// Moves an existing file into the trip's _history folder under a new name. The item id stays the same.
function moveToHistory_(itemId, folderPath, newName) {
  const historyId = ensureFolder_(folderPath, '_history');
  graph_('patch', '/me/drive/items/' + itemId, { json: { parentReference: { id: historyId }, name: newName } });
}

function ensureFolder_(parentPath, name) {
  const existing = graph_('get', drivePath_(parentPath + '/' + name), { allow404: true });
  if (existing) return existing.id;
  return graph_('post', drivePath_(parentPath) + '/children', {
    json: { name: name, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' },
  }).id;
}

// Short-lived, pre-authenticated links. Microsoft keeps them valid about an hour; we reuse them for 45 minutes.
function downloadUrl_(itemId) {
  return cachedLink_('dl:' + itemId, () => graph_('get', '/me/drive/items/' + itemId)['@microsoft.graph.downloadUrl']);
}

function thumbnailUrl_(itemId, size) {
  size = size || 'medium';
  return cachedLink_('th:' + size + ':' + itemId, () => graph_('get', '/me/drive/items/' + itemId + '/thumbnails/0/' + size).url);
}

function cachedLink_(key, fetchUrl) {
  const cache = CacheService.getScriptCache();
  const hit = cache.get(key);
  if (hit) return hit;
  const url = fetchUrl();
  cache.put(key, url, LINK_CACHE_SECONDS);
  return url;
}

// Daily trigger. A forced refresh proves the refresh token still works; failures email the owner.
function healthCheck() {
  accessToken_(true);
  graph_('get', '/me/drive/root:/' + ROOT_FOLDER + ':', { allow404: true });
  console.log('OneDrive OK');
}

// Run from the editor for M2 testing. Uploads a sample image twice (the second moves the first to _history)
// and logs temporary links that open without signing in.
function testOneDrive() {
  const bytes = UrlFetchApp.fetch('https://www.google.com/images/branding/googlelogo/1x/googlelogo_color_272x92dp.png')
    .getBlob().getAs('image/jpeg').getBytes();
  const folder = ROOT_FOLDER + '/_test';
  const first = uploadJpeg_(folder, 'test.jpg', bytes);
  moveToHistory_(first.itemId, folder, 'test_v1_' + Date.now() + '.jpg');
  const second = uploadJpeg_(folder, 'test.jpg', bytes);
  console.log('download: ' + downloadUrl_(second.itemId));
  console.log('thumbnail: ' + thumbnailUrl_(second.itemId));
  console.log('ไฟล์แรกอยู่ใน ' + folder + '/_history');
}
