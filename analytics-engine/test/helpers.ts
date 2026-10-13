import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { expect } from 'vitest';

const BASE_ID = 'https://schemas.collection-copilot.local/v1/';
const SCHEMAS_DIR = resolve(import.meta.dirname, '../../contracts/schemas');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const Ajv = Ajv2020 as unknown as typeof Ajv2020.default;
const ajv = new Ajv({ allErrors: true, strict: true, allowUnionTypes: true });
(addFormats as unknown as typeof addFormats.default)(ajv);
for (const file of walk(SCHEMAS_DIR).filter((f) => f.endsWith('.schema.json'))) {
  ajv.addSchema(JSON.parse(readFileSync(file, 'utf8')));
}

/** Valida `doc` contro $defs/output dello schema del tool (es. "get_kpi_catalog"). */
export function expectValidToolOutput(tool: string, doc: unknown) {
  const validate = ajv.getSchema(`${BASE_ID}tools/${tool}.schema.json#/$defs/output`);
  if (!validate) throw new Error(`Schema non trovato: ${tool}`);
  validate(doc);
  expect(validate.errors ?? []).toEqual([]);
}
