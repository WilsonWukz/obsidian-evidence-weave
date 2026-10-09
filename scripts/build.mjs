import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
if (!/^[a-z][a-z0-9-]+$/.test(manifest.id)) throw new Error('Invalid Obsidian plugin id');
const src = await readFile(join(root, 'src', 'main.js'), 'utf8');
if (!src.includes('module.exports.default')) throw new Error('Expected Obsidian CommonJS export');
await writeFile(join(root, 'main.js'), `// EvidenceWeave v${manifest.version} — built from src/main.js; do not edit directly.\n${src}`);
console.log(`Built main.js for ${manifest.id}@${manifest.version}`);
