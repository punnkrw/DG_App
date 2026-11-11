const test = require('node:test');
const assert = require('node:assert/strict');
const loadGas = require('./load-gas');

const ContentService = {
  MimeType: { JSON: 'json' },
  createTextOutput: text => ({ text, setMimeType() { return this; } }),
};
const Utilities = { formatDate: () => '2026-11-04T02:41:10+07:00' };
const gas = loadGas(['Router.gs'], { ContentService, Utilities, console: { error() {} } });

const post = body => JSON.parse(gas.doPost({ postData: { contents: body } }).text);

test('ping returns ok', () => {
  assert.deepEqual(post('{"action":"ping"}'), { ok: true, data: { pong: true, at: '2026-11-04T02:41:10+07:00' } });
});

test('bad JSON and missing action are BAD_REQUEST', () => {
  assert.equal(post('not json').error.code, 'BAD_REQUEST');
  assert.equal(post('{}').error.code, 'BAD_REQUEST');
  assert.equal(post('null').error.code, 'BAD_REQUEST');
});

test('unknown action, including inherited names, is UNKNOWN_ACTION', () => {
  assert.equal(post('{"action":"nope"}').error.code, 'UNKNOWN_ACTION');
  assert.equal(post('{"action":"toString"}').error.code, 'UNKNOWN_ACTION');
});

test('unexpected errors become INTERNAL without leaking details', () => {
  require('vm').runInContext("ACTIONS.boom = () => { throw new Error('secret detail'); }", gas);
  assert.deepEqual(post('{"action":"boom"}').error, { code: 'INTERNAL', message: 'เกิดข้อผิดพลาดในระบบ' });
});
