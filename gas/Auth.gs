// Identity comes only from a LIFF ID token verified with LINE. Never trust a userId sent by the page.

const ID_TOKEN_CACHE_SECONDS = 600;

// Returns { userId, name } for a valid token. Results are cached up to 10 minutes, never past the token's exp.
function verifyIdToken_(idToken) {
  if (typeof idToken !== 'string' || !idToken) {
    throw new ApiError('AUTH_REQUIRED', 'กรุณาเปิดจาก LINE');
  }
  const cache = CacheService.getScriptCache();
  const key = 'idt:' + Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, idToken, Utilities.Charset.UTF_8));
  const hit = cache.get(key);
  if (hit) return JSON.parse(hit);

  const channelId = PropertiesService.getScriptProperties().getProperty('LINE_LOGIN_CHANNEL_ID');
  if (!channelId) throw new Error('Script property LINE_LOGIN_CHANNEL_ID is not set');
  const res = UrlFetchApp.fetch('https://api.line.me/oauth2/v2.1/verify', {
    method: 'post',
    payload: { id_token: idToken, client_id: channelId },
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  if (code === 400) throw new ApiError('AUTH_INVALID', 'การเข้าสู่ระบบหมดอายุ กรุณาเปิดใหม่จาก LINE');
  if (code !== 200) throw new Error('LINE verify returned ' + code + ': ' + res.getContentText());

  const body = JSON.parse(res.getContentText());
  const user = { userId: body.sub, name: body.name || '' };
  const ttl = Math.min(ID_TOKEN_CACHE_SECONDS, Math.floor(body.exp - Date.now() / 1000));
  if (ttl > 0) cache.put(key, JSON.stringify(user), ttl);
  return user;
}

function requireUser_(req) {
  return verifyIdToken_(req.auth && req.auth.idToken);
}

// Driver and admin rows are read on every request, so approval or removal applies at once.
function findDriver_(userId) {
  return readRows_('Drivers').find(d => d.LineUserId === userId) || null;
}

function requireDriver_(req) {
  const user = requireUser_(req);
  const driver = findDriver_(user.userId);
  if (!driver || driver.Status !== 'Active') {
    throw new ApiError('NOT_DRIVER', 'บัญชีนี้ยังไม่ได้รับอนุมัติเป็นคนขับ');
  }
  return { user, driver };
}

function requireAdmin_(req) {
  const user = requireUser_(req);
  const admin = readRows_('Admins').find(a => a.LineUserId === user.userId);
  if (!admin) throw new ApiError('FORBIDDEN', 'ไม่มีสิทธิ์แอดมิน');
  return { user, admin };
}
