import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import type { ValidateFunction } from 'ajv/dist/2020.js';

const BASE_ID = 'https://schemas.collection-copilot.local/v1/';
export const DEFAULT_CONTRACTS_DIR = resolve(import.meta.dirname, '../../contracts');

type Json = Record<string, unknown>;

export interface ToolDefinition {
  name: string;
  group: string;
  description: string;
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/**
 * Carica `contracts/schemas` (unica fonte di verita): catalogo dei tool, validatori Ajv 2020 strict
 * e gli schemi di input/output "bundled" (riferimenti $ref risolti) da pubblicare in tools/list.
 */
export class Contracts {
  readonly tools: ToolDefinition[];
  private readonly ajv: InstanceType<typeof Ajv2020.default>;
  private readonly byId = new Map<string, Json>();
  private readonly validators = new Map<string, ValidateFunction>();

  constructor(contractsDir: string = DEFAULT_CONTRACTS_DIR) {
    const schemasDir = join(contractsDir, 'schemas');
    this.tools = (JSON.parse(readFileSync(join(schemasDir, 'tools', 'index.json'), 'utf8')) as { tools: ToolDefinition[] }).tools;
    const Ajv = Ajv2020 as unknown as typeof Ajv2020.default;
    this.ajv = new Ajv({ allErrors: true, strict: true, allowUnionTypes: true });
    (addFormats as unknown as typeof addFormats.default)(this.ajv);
    for (const file of walk(schemasDir).filter((f) => f.endsWith('.schema.json'))) {
      const schema = JSON.parse(readFileSync(file, 'utf8')) as Json;
      this.ajv.addSchema(schema);
      this.byId.set(schema.$id as string, schema);
    }
  }

  definition(tool: string): ToolDefinition {
    const def = this.tools.find((t) => t.name === tool);
    if (!def) throw new Error(`Tool non presente in contracts/schemas/tools/index.json: ${tool}`);
    return def;
  }

  private validator(tool: string, kind: 'input' | 'output'): ValidateFunction {
    const ref = `${BASE_ID}tools/${tool}.schema.json#/$defs/${kind}`;
    let v = this.validators.get(ref);
    if (!v) {
      v = this.ajv.getSchema(ref);
      if (!v) throw new Error(`Schema non trovato: ${ref}`);
      this.validators.set(ref, v);
    }
    return v;
  }

  /** Ritorna gli errori in forma leggibile, o null se valido. */
  validate(tool: string, kind: 'input' | 'output', value: unknown): string[] | null {
    const v = this.validator(tool, kind);
    if (v(value)) return null;
    return (v.errors ?? []).map((e) => {
      const extra = e.params && 'additionalProperty' in e.params ? ` "${String(e.params.additionalProperty)}"` : '';
      return `${e.instancePath || '(radice)'}: ${e.message ?? 'non valido'}${extra}`;
    });
  }

  /** Schema $defs/input|output con tutti i $ref risolti in linea (il client MCP non puo risolvere URI relativi). */
  bundled(tool: string, kind: 'input' | 'output'): Json {
    const id = `${BASE_ID}tools/${tool}.schema.json`;
    const root = this.byId.get(id);
    if (!root) throw new Error(`Schema non trovato: ${id}`);
    const node = (root.$defs as Json)[kind] as Json;
    return this.inline(node, id) as Json;
  }

  private inline(node: unknown, baseId: string): unknown {
    if (Array.isArray(node)) return node.map((x) => this.inline(x, baseId));
    if (node === null || typeof node !== 'object') return node;
    const obj = node as Json;
    if (typeof obj.$ref === 'string') {
      const url = new URL(obj.$ref, baseId);
      const docId = url.origin + url.pathname;
      const doc = this.byId.get(docId);
      if (!doc) throw new Error(`Riferimento non risolvibile: ${obj.$ref} (da ${baseId})`);
      let target: unknown = doc;
      const pointer = decodeURIComponent(url.hash.replace(/^#/, ''));
      for (const part of pointer.split('/').filter(Boolean)) target = (target as Json)[part];
      const { $ref: _ref, ...siblings } = obj;
      const resolved = this.inline(target, docId) as Json;
      return { ...resolved, ...(this.inline(siblings, baseId) as Json) };
    }
    const out: Json = {};
    for (const [k, v] of Object.entries(obj)) {
      if (k === '$id' || k === '$schema') continue;
      out[k] = k === 'properties' || k === '$defs' ? this.inlineMap(v as Json, baseId) : this.inline(v, baseId);
    }
    return out;
  }

  private inlineMap(map: Json, baseId: string): Json {
    return Object.fromEntries(Object.entries(map).map(([k, v]) => [k, this.inline(v, baseId)]));
  }
}
