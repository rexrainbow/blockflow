import schema from '../../../schema/story.schema.json' with { type: 'json' };
import { parseStory, storyProblems } from './model.js';
import { documentDiff } from '../blockchart/edit-diff.js';

// Normalization accepts legacy defaults; edits must still reject misspelled fields.
function knownFields(value, definition, path = '') {
  if (definition.$ref) definition = schema.$defs[definition.$ref.split('/').at(-1)];
  if (Array.isArray(value) && definition.items) {
    value.forEach((item, i) => knownFields(item, definition.items, `${path}/${i}`));
  } else if (value && typeof value === 'object' && definition.properties) {
    for (const [key, item] of Object.entries(value)) {
      const child = definition.properties[key];
      if (!Object.hasOwn(definition.properties, key) && definition.additionalProperties === false)
        throw new Error(`${path}/${key}: unknown field`);
      if (child) knownFields(item, child, `${path}/${key}`);
    }
  }
}

function tokens(path) {
  if (typeof path !== 'string' || !path.startsWith('/') || /~(?![01])/u.test(path))
    throw new Error('Expected a non-root JSON Pointer: ' + path);
  const parts = path
    .slice(1)
    .split('/')
    .map((p) => p.replaceAll('~1', '/').replaceAll('~0', '~'));
  if (parts.some((p) => ['__proto__', 'constructor', 'prototype'].includes(p)))
    throw new Error('Unsafe path: ' + path);
  return parts;
}

function locate(document, path, add = false) {
  const parts = tokens(path),
    key = parts.pop();
  let parent = document;
  for (const part of parts) {
    if (!parent || typeof parent !== 'object' || !Object.hasOwn(parent, part))
      throw new Error('Path not found: ' + path);
    parent = parent[part];
  }
  if (!parent || typeof parent !== 'object') throw new Error('Path not found: ' + path);
  if (Array.isArray(parent)) {
    const index = key === '-' && add ? parent.length : /^(0|[1-9]\d*)$/.test(key) ? Number(key) : -1;
    if (index < 0 || index >= parent.length + (add ? 1 : 0)) throw new Error('Index not found: ' + path);
    return { parent, key: index };
  }
  if (!add && !Object.hasOwn(parent, key)) throw new Error('Path not found: ' + path);
  return { parent, key };
}

function remove(document, path) {
  const { parent, key } = locate(document, path),
    value = parent[key];
  if (Array.isArray(parent)) parent.splice(key, 1);
  else delete parent[key];
  return value;
}

/** Apply RFC 6902 add/replace/remove/move operations to a private Story copy. */
export function applyStoryOps(story, operations, index, { allowMissing = false } = {}) {
  if (!Array.isArray(operations)) throw new Error('Expected an operations array');
  if (typeof allowMissing !== 'boolean') throw new Error('allowMissing must be a boolean');
  if (!index?.wires || !index.modules) throw new Error('Expected a Story reference index');
  const before = structuredClone(story),
    result = parseStory(story);
  for (const [i, op] of operations.entries()) {
    try {
      if (!op || !['add', 'replace', 'remove', 'move'].includes(op.op)) throw new Error('Unknown operation');
      const fields =
        op.op === 'move'
          ? ['op', 'path', 'from']
          : op.op === 'remove'
            ? ['op', 'path']
            : ['op', 'path', 'value'];
      if (Object.keys(op).some((key) => !fields.includes(key))) throw new Error('Unexpected operation field');
      let value = op.value;
      if (op.op === 'move') {
        tokens(op.from);
        tokens(op.path);
        if (op.path.startsWith(op.from + '/')) throw new Error('Cannot move into its descendant');
        value = remove(result, op.from);
      } else if (op.op === 'remove') {
        remove(result, op.path);
        continue;
      } else if (!Object.hasOwn(op, 'value')) throw new Error('Missing value');
      const { parent, key } = locate(result, op.path, op.op !== 'replace');
      if (Array.isArray(parent) && op.op !== 'replace') parent.splice(key, 0, structuredClone(value));
      else parent[key] = structuredClone(value);
    } catch (cause) {
      throw new Error(`ops[${i}] ${op?.op ?? '?'} ${op?.path ?? ''}: ${cause.message}`, { cause });
    }
  }
  let document;
  try {
    knownFields(result, schema);
    document = parseStory(result);
  } catch (cause) {
    const context = operations.map((op, i) => `ops[${i}] ${op.op} ${op.path}`).join(', ');
    throw new Error(`After ${context || 'operations'}: ${cause.message}`, { cause });
  }
  const problems = storyProblems(document, index);
  if (problems.length && !allowMissing) {
    const details = problems.map((p) => `chapters[${p.ci}].steps[${p.si}] ${p.type} ${p.ref}`).join(', ');
    throw new Error('Missing references after operations: ' + details);
  }
  return { document, diff: documentDiff(before, document), problems };
}
