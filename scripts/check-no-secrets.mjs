import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Guard against accidentally committing development credentials. */
const root = process.cwd();
const targets = [
  ...readdirSync(join(root, 'k8s'))
    .filter((f) => f.endsWith('.yaml') && !f.includes('example'))
    .map((f) => join('k8s', f)),
  'docker-compose.yml',
];

const forbidden = [
  'POSTGRES_PASSWORD: civ1',
  'GAME_SERVER_SECRET: dev-',
  'GAME_SERVER_SECRET: k8s-',
  'postgres://civ1:civ1',
];

const violations = [];
for (const file of targets) {
  const text = readFileSync(join(root, file), 'utf8');
  for (const needle of forbidden) {
    if (text.includes(needle)) violations.push(`${file}: contains ${needle}`);
  }
}

if (violations.length) {
  console.error('Committed credentials detected:\n' + violations.join('\n'));
  process.exit(1);
}
console.log('No committed credentials in deployment manifests.');
