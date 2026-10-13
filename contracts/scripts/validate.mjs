// Valida i contratti di Collection Copilot:
// - compila tutti i JSON Schema (draft 2020-12)
// - verifica che gli esempi in examples/ siano validi e quelli in examples-invalid/ vengano rifiutati
// - controlla la coerenza tra catalogo dei tool, file di schema ed esempi
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, basename, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const schemasDir = join(root, 'schemas');
const BASE_ID = 'https://schemas.collection-copilot.local/v1/';

const errors = [];
const warnings = [];
let checked = 0;

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const rel = (file) => relative(root, file).split(sep).join('/');
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

// 1. Carica e compila gli schemi
const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
addFormats(ajv);

const schemaFiles = walk(schemasDir).filter((f) => f.endsWith('.schema.json'));
for (const file of schemaFiles) {
  const schema = readJson(file);
  const expectedId = BASE_ID + relative(schemasDir, file).split(sep).join('/');
  if (schema.$id !== expectedId) {
    errors.push(`${rel(file)}: $id atteso "${expectedId}", trovato "${schema.$id}"`);
  }
  ajv.addSchema(schema);
}
for (const file of schemaFiles) {
  const id = BASE_ID + relative(schemasDir, file).split(sep).join('/');
  try {
    ajv.getSchema(id);
  } catch (e) {
    errors.push(`${rel(file)}: schema non compilabile - ${e.message}`);
  }
}

// 2. Associa ogni esempio al suo schema
function schemaRefFor(file, baseDir) {
  const parts = relative(baseDir, file).split(sep);
  const [area, name] = [parts[0], parts[parts.length - 1]];
  if (area === 'blocks') return 'blocks/block.schema.json';
  if (area === 'events') return 'events/sse-event.schema.json';
  if (area === 'api') return `api/${name.split('.')[0]}.schema.json`;
  if (area === 'tools') {
    const m = name.match(/^([a-z_]+)\.(input|output)\.json$/);
    if (!m) return null;
    return `tools/${m[1]}.schema.json#/$defs/${m[2]}`;
  }
  return null;
}

function validateDocument(ref, doc) {
  let validate;
  try {
    validate = ajv.getSchema(BASE_ID + ref);
  } catch (e) {
    return [`schema "${ref}" non compilabile - ${e.message}`];
  }
  if (!validate) return [`schema "${ref}" non trovato`];
  if (validate(doc)) return [];
  return validate.errors.map((e) => `${e.instancePath || '/'} ${e.message}`);
}

function documentsOf(file) {
  if (file.endsWith('.jsonl')) {
    return readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .filter((line) => line.trim() !== '')
      .map((line, i) => ({ label: `riga ${i + 1}`, doc: JSON.parse(line) }));
  }
  return [{ label: null, doc: readJson(file) }];
}

function checkExamples(baseDir, expectValid) {
  for (const file of walk(baseDir)) {
    const ref = schemaRefFor(file, baseDir);
    if (!ref) {
      errors.push(`${rel(file)}: impossibile determinare lo schema dal percorso`);
      continue;
    }
    const failures = [];
    for (const { label, doc } of documentsOf(file)) {
      const errs = validateDocument(ref, doc);
      if (errs.length) failures.push(...errs.map((e) => (label ? `${label}: ${e}` : e)));
    }
    checked++;
    if (expectValid && failures.length) {
      errors.push(`${rel(file)} non valido rispetto a ${ref}:\n    ${failures.join('\n    ')}`);
    }
    if (!expectValid && failures.length === 0) {
      errors.push(`${rel(file)} doveva essere rifiutato da ${ref} ma risulta valido`);
    }
  }
}

checkExamples(join(root, 'examples'), true);
checkExamples(join(root, 'examples-invalid'), false);

// 3. Coerenza catalogo tool <-> schemi <-> esempi
const toolsDir = join(schemasDir, 'tools');
const catalog = readJson(join(toolsDir, 'index.json'));
const catalogNames = new Set(catalog.tools.map((t) => t.name));
const schemaNames = new Set(
  readdirSync(toolsDir).filter((f) => f.endsWith('.schema.json')).map((f) => f.replace('.schema.json', ''))
);
for (const name of catalogNames) {
  if (!schemaNames.has(name)) errors.push(`tool "${name}" nel catalogo senza file di schema`);
}
for (const name of schemaNames) {
  if (!catalogNames.has(name)) errors.push(`schema tools/${name}.schema.json non presente nel catalogo`);
}
const toolExamples = new Set(readdirSync(join(root, 'examples', 'tools')).map((f) => f.split('.')[0]));
for (const name of catalogNames) {
  if (!toolExamples.has(name)) warnings.push(`tool "${name}" senza esempi`);
}

// 4. Ogni tipo di blocco ha almeno un esempio
const blockTypes = readJson(join(schemasDir, 'blocks', 'block.schema.json')).oneOf.map(
  ({ $ref }) => readJson(join(schemasDir, 'blocks', $ref)).properties.type.const
);
const exampleTypes = new Set(walk(join(root, 'examples', 'blocks')).map((f) => readJson(f).type));
for (const t of blockTypes) {
  if (!exampleTypes.has(t)) errors.push(`blocco "${t}" senza esempio in examples/blocks`);
}

// Esito
console.log(`Schemi: ${schemaFiles.length} · Esempi verificati: ${checked} · Tool: ${catalogNames.size} · Blocchi: ${blockTypes.length}`);
if (warnings.length) console.log(`\nAvvisi (${warnings.length}):\n  - ${warnings.join('\n  - ')}`);
if (errors.length) {
  console.error(`\nErrori (${errors.length}):\n  - ${errors.join('\n  - ')}`);
  process.exit(1);
}
console.log('\nContratti validi.');
