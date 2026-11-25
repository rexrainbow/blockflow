import { documentDiff } from './edit-diff.js';
import { createConnectionContext, receivingFaceKey } from './connectivity.js';
import { endpointKey } from './endpoints.js';
import { targetEndpoint } from './nets.js';

const keyed = (items = []) => items.map((value) => ({ key: value.id, selector: { id: value.id }, value }));
const omit = (value, keys) =>
  Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));

// Keys establish identity; selectors are the agent-facing references for that snapshot.
function collection(before, after, subject, records, compare) {
  const old = new Map(before.map((item) => [item.key, item]));
  const next = new Map(after.map((item) => [item.key, item]));
  for (const item of before) {
    if (!next.has(item.key))
      records.push({ ...subject, ...item.selector, change: 'removed', before: item.value });
  }
  for (const item of after) {
    const previous = old.get(item.key);
    const ref = { ...subject, ...item.selector };
    if (previous) compare(previous.value, item.value, ref);
    else records.push({ ...ref, change: 'added', after: item.value });
  }
  const left = before.filter((item) => next.has(item.key));
  const right = after.filter((item) => old.has(item.key));
  if (left.some((item, i) => item.key !== right[i].key))
    records.push({
      ...subject,
      change: 'order',
      before: left.map((item) => item.selector),
      after: right.map((item) => item.selector),
    });
}

function indexNets(doc) {
  const sources = new Map();
  for (const net of doc.connections ?? []) {
    const key = endpointKey(net.from);
    if (!sources.has(key)) sources.set(key, []);
    sources.get(key).push(net);
  }
  return sources;
}

// A source shared by two boundary faces can survive a membership change or a
// new first destination. A destination retained on both sides identifies the Net.
function sharedTargets(net, candidates) {
  const targets = new Set(net.to.map((entry) => endpointKey(targetEndpoint(entry))));
  return candidates
    .filter((n) => !n.id)
    .map((other) => ({
      other,
      common: other.to.map((entry) => endpointKey(targetEndpoint(entry))).filter((key) => targets.has(key)),
    }))
    .filter((match) => match.common.length);
}

function netItems(doc, ownSources, peerSources) {
  let context;
  return (doc.connections ?? []).map((value) => {
    if (value.id) return { key: 'id:' + value.id, selector: { id: value.id }, value };
    const { from } = value;
    const source = endpointKey(from),
      own = ownSources.get(source),
      peers = peerSources.get(source) ?? [];
    if (own.length > 1 || peers.length > 1) {
      const to = targetEndpoint(value.to[0]);
      const selector = { from, to };
      const matches = sharedTargets(value, peers);
      if (matches.length === 1 && sharedTargets(matches[0].other, own).length === 1) {
        const anchor = matches[0].common.sort()[0];
        return { key: 'pair:' + JSON.stringify([source, anchor]), selector, value };
      }
      // With no unique surviving branch, match the source face used by routing.
      context ??= createConnectionContext(doc);
      const resolved = context.resolve(from, to, value.direction);
      if (resolved.source) return { key: 'face:' + receivingFaceKey(resolved.source), selector, value };
    }
    return { key: 'source:' + source, selector: { from }, value };
  });
}

function branchItems(net) {
  return net.to.map((value) => {
    const to = targetEndpoint(value);
    return {
      key: JSON.stringify([endpointKey(net.from), endpointKey(to)]),
      selector: { from: net.from, to },
      value,
    };
  });
}

export function semanticDiff(original, edited) {
  const records = [];
  function changed(before, after, ref) {
    const fields = documentDiff(before, after);
    if (fields.length) records.push({ ...ref, change: 'updated', fields });
  }
  function grid(before = [], after = [], groupId) {
    for (let row = 0; row < Math.max(before.length, after.length); row++) {
      const a = before[row] ?? [],
        b = after[row] ?? [];
      for (let column = 0; column < Math.max(a.length, b.length); column++) {
        if (a[column] !== b[column])
          records.push({
            kind: 'gridCell',
            groupId,
            row,
            column,
            ...(column < a.length && { before: a[column] }),
            ...(column < b.length && { after: b[column] }),
          });
      }
    }
  }
  // Keep the rest of the layout (including a new Grid's type) in its owner's fields.
  function withoutCells(node, excluded) {
    const fields = omit(node, excluded);
    if (fields.layout) fields.layout = omit(fields.layout, ['cells']);
    return fields;
  }
  function node(before, after, ref) {
    const group = ref.kind === 'group';
    const exclude = group ? ['ports', 'members'] : ['ports'];
    const a = withoutCells(before, exclude),
      b = withoutCells(after, exclude);
    // Preserve the authored distinction between an omitted and an empty port list.
    if (!before.ports?.length && !after.ports?.length) {
      if (before.ports) a.ports = before.ports;
      if (after.ports) b.ports = after.ports;
    }
    changed(a, b, ref);
    collection(keyed(before.ports), keyed(after.ports), { kind: 'port', owner: ref.id }, records, changed);
    if (group) {
      const left = new Set(before.members),
        right = new Set(after.members);
      const removed = before.members.filter((id) => !right.has(id)),
        added = after.members.filter((id) => !left.has(id));
      if (removed.length || added.length) records.push({ kind: 'members', groupId: ref.id, removed, added });
      const commonBefore = before.members.filter((id) => right.has(id)),
        commonAfter = after.members.filter((id) => left.has(id));
      if (commonBefore.some((id, i) => id !== commonAfter[i]))
        records.push({
          kind: 'members',
          groupId: ref.id,
          change: 'order',
          before: commonBefore,
          after: commonAfter,
        });
      grid(before.layout?.cells, after.layout?.cells, ref.id);
    }
  }
  collection(keyed(original.modules), keyed(edited.modules), { kind: 'module' }, records, node);
  collection(keyed(original.groups), keyed(edited.groups), { kind: 'group' }, records, node);
  const oldSources = indexNets(original),
    newSources = indexNets(edited);
  collection(
    netItems(original, oldSources, newSources),
    netItems(edited, newSources, oldSources),
    { kind: 'net' },
    records,
    (before, after, ref) => {
      changed(omit(before, ['to']), omit(after, ['to']), ref);
      const { kind, ...net } = ref;
      collection(
        branchItems(before),
        branchItems(after),
        { kind: 'branch', net },
        records,
        (a, b, branch) => {
          const wrappedA = Object.hasOwn(a, 'endpoint'),
            wrappedB = Object.hasOwn(b, 'endpoint');
          const fields = documentDiff(
            wrappedA ? omit(a, ['endpoint']) : {},
            wrappedB ? omit(b, ['endpoint']) : {},
          );
          if (fields.length) records.push({ ...branch, change: 'updated', fields });
          else if (wrappedA !== wrappedB)
            records.push({ ...branch, change: 'representation', before: a, after: b });
        },
      );
    },
  );
  const lists = ['modules', 'groups', 'connections'];
  changed(withoutCells(original, lists), withoutCells(edited, lists), { kind: 'diagram' });
  grid(original.layout?.cells, edited.layout?.cells, null);
  return structuredClone(records);
}
