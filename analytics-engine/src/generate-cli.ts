// Scrive il dataset sintetico in analytics-engine/data/ per ispezione.
// Uso: npm run generate -- [--seed N] [--out DIR]
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { generateDataset } from './generate.ts';
import { GENERATOR_PARAMS } from './params.ts';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const seed = arg('seed') !== undefined ? Number(arg('seed')) : GENERATOR_PARAMS.defaultSeed;
if (!Number.isInteger(seed)) throw new Error('--seed deve essere un intero');
const out = resolve(arg('out') ?? resolve(import.meta.dirname, '../data'));

const dataset = generateDataset(seed);
mkdirSync(out, { recursive: true });
writeFileSync(resolve(out, 'affidi.json'), JSON.stringify(dataset, null, 1) + '\n');
writeFileSync(resolve(out, 'generator-params.json'), JSON.stringify({ seed, ...GENERATOR_PARAMS }, null, 2) + '\n');
console.log(`${dataset.affidi.length} affidi, ${dataset.incassiSenzaAffido.length} incassi senza affido (seed ${seed}) -> ${out}`);
