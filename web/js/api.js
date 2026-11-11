// Calls the Apps Script /exec endpoint. The body is JSON sent as text/plain with no custom
// headers, so the browser does not send a CORS preflight.
class ApiError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// auth: { idToken } for drivers and admins, { customerToken } for the customer page.
async function callApi(action, auth, params = {}) {
  let res;
  try {
    res = await fetch(CONFIG.EXEC_URL, {
      method: 'POST',
      body: JSON.stringify({ ...params, action, auth }),
    });
  } catch (err) {
    throw new ApiError('NETWORK', 'เชื่อมต่อไม่ได้ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่');
  }
  const json = await res.json().catch(() => null);
  if (!json) throw new ApiError('BAD_RESPONSE', 'ระบบตอบกลับผิดรูปแบบ');
  if (!json.ok) throw new ApiError(json.error.code, json.error.message);
  return json.data;
}
