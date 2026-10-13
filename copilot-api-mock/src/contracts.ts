import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

export const BASE_ID = 'https://schemas.collection-copilot.local/v1/';
export const DEFAULT_SCHEMAS_DIR = resolve(import.meta.dirname, '../../contracts/schemas');

export type Validator = (doc: unknown) => string[];

export interface Contracts {
  /** Restituisce un validatore per lo schema indicato (es. "api/copilot-result.schema.json"). */
  validator(ref: string): Validator;
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/** Carica tutti gli schemi di contracts/ in un Ajv 2020 strict (stessa configurazione di contracts/scripts/validate.mjs). */
export function loadContracts(schemasDir: string = DEFAULT_SCHEMAS_DIR): Contracts {
  const Ajv = Ajv2020 as unknown as typeof Ajv2020.default;
  const ajv = new Ajv({ allErrors: true, strict: true, allowUnionTypes: true });
  (addFormats as unknown as typeof addFormats.default)(ajv);
  for (const file of walk(schemasDir).filter((f) => f.endsWith('.schema.json'))) {
    ajv.addSchema(JSON.parse(readFileSync(file, 'utf8')));
  }
  return {
    validator(ref) {
      const validate = ajv.getSchema(BASE_ID + ref);
      if (!validate) throw new Error(`Schema non trovato: ${ref}`);
      return (doc) => (validate(doc) ? [] : (validate.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message}`));
    },
  };
}
