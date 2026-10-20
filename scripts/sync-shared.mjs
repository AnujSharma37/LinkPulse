#!/usr/bin/env node
/**
 * shared/ is the single source of truth for code used by BOTH backends (the Node API and the
 * Supabase Edge Functions). This script copies it into each backend with a "generated" header.
 *
 *   node scripts/sync-shared.mjs          write the copies
 *   node scripts/sync-shared.mjs --check  exit 1 if any copy is missing or has drifted (used by CI and tests)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = path.join(root, 'shared');
const targets = [path.join(root, 'server/src/shared'), path.join(root, 'supabase/functions/_shared/core')];
const check = process.argv.includes('--check');

const header = (file) =>
  `// GENERATED from shared/${file} by scripts/sync-shared.mjs — DO NOT EDIT HERE.\n// Edit shared/${file}, then run: npm run sync\n`;

const files = fs.readdirSync(sourceDir).filter((f) => f.endsWith('.ts')).sort();
const problems = [];
for (const file of files) {
  const expected = header(file) + fs.readFileSync(path.join(sourceDir, file), 'utf8');
  for (const dir of targets) {
    const dest = path.join(dir, file);
    const actual = fs.existsSync(dest) ? fs.readFileSync(dest, 'utf8') : null;
    if (actual === expected) continue;
    if (check) { problems.push(path.relative(root, dest)); continue; }
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(dest, expected);
    console.log(`wrote ${path.relative(root, dest)}`);
  }
}
if (check) {
  if (problems.length) {
    console.error('Shared code is out of sync. Run `npm run sync` and commit the result:\n  ' + problems.join('\n  '));
    process.exit(1);
  }
  console.log(`shared/ is in sync (${files.length} files × ${targets.length} targets).`);
}
