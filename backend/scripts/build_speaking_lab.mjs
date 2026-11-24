import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const output = path.resolve(process.argv[2]);
if (!output.startsWith(path.join(root, 'reports') + path.sep)) throw new Error('Lab assets must be under reports/');
const require = createRequire(path.join(root, 'frontend/package.json'));
const ts = require('typescript');
fs.mkdirSync(output, { recursive: true });
for (const name of ['pcm-recorder', 'recording-silence']) {
  const source = fs.readFileSync(path.join(root, `frontend/src/lib/${name}.ts`), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
    .replace('"./recording-silence"', '"./recording-silence.js"');
  fs.writeFileSync(path.join(output, name + '.js'), compiled);
}
