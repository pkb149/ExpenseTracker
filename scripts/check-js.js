#!/usr/bin/env node
const fs = require('fs');
const c = fs.readFileSync('dist/_worker.js', 'utf8');
const start = c.indexOf('<script>') + 8;
const end = c.indexOf('<\\/script>'); // esbuild escapes </ as <\/ in template literals
if (end === -1) { console.error('Could not find </script> in bundle'); process.exit(1); }
const s = c.slice(start, end);
try {
  new Function(s);
  console.log('JS syntax OK');
} catch (e) {
  console.error('JS SYNTAX ERROR:', e.message);
  process.exit(1);
}
