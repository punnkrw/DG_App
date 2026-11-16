// Single endpoint. Requests are POST with a JSON body sent as text/plain to avoid CORS preflight.

class ApiError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// action -> handler(req) returning the response data. Handlers throw ApiError on failure.
// Handlers are wrapped because other .gs files may not be loaded yet when this object is built.
const ACTIONS = {
  ping: () => ({ pong: true, at: nowIso_() }),
  'driver.me': req => driverMe_(req),
};

function doPost(e) {
  let res;
  try {
    const req = parseRequest_(e);
    if (!Object.prototype.hasOwnProperty.call(ACTIONS, req.action)) {
      throw new ApiError('UNKNOWN_ACTION', 'ไม่รู้จักคำสั่ง ' + req.action);
    }
    res = { ok: true, data: ACTIONS[req.action](req) };
  } catch (err) {
    if (err instanceof ApiError) {
      res = { ok: false, error: { code: err.code, message: err.message } };
    } else {
      console.error(err && err.stack ? err.stack : err);
      res = { ok: false, error: { code: 'INTERNAL', message: 'เกิดข้อผิดพลาดในระบบ' } };
    }
  }
  return ContentService.createTextOutput(JSON.stringify(res)).setMimeType(ContentService.MimeType.JSON);
}

// GET is used only as the redirect target of the Microsoft sign-in (see startOneDriveAuth).
function doGet(e) {
  const p = (e && e.parameter) || {};
  let msg = 'DG Trip Report';
  if (p.state) {
    try {
      msg = handleOneDriveCallback_(p);
    } catch (err) {
      console.error(err && err.stack ? err.stack : err);
      msg = 'เชื่อม OneDrive ไม่สำเร็จ: ' + (err.message || err);
    }
  }
  return HtmlService.createHtmlOutput('<p style="font:18px sans-serif;padding:24px">' + escapeHtml_(msg) + '</p>')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function escapeHtml_(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function parseRequest_(e) {
  let req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    throw new ApiError('BAD_REQUEST', 'รูปแบบคำขอไม่ถูกต้อง');
  }
  if (!req || typeof req !== 'object' || typeof req.action !== 'string') {
    throw new ApiError('BAD_REQUEST', 'รูปแบบคำขอไม่ถูกต้อง');
  }
  return req;
}

function nowIso_() {
  return Utilities.formatDate(new Date(), 'Asia/Bangkok', "yyyy-MM-dd'T'HH:mm:ssXXX");
}
