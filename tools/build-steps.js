// Generates gas/Steps.gs and web/js/steps.js from steps.json.
// Run: node tools/build-steps.js
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const steps = JSON.parse(fs.readFileSync(path.join(root, 'steps.json'), 'utf8')).steps;

const header = '// Generated from steps.json by tools/build-steps.js. Do not edit.\n';
const body = 'const STEPS = ' + JSON.stringify(steps, null, 2) + ';\n';

for (const out of ['gas/Steps.gs', 'web/js/steps.js']) {
  const file = path.join(root, out);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, header + body);
  console.log('wrote ' + out);
}
