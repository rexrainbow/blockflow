/** Shared hierarchy helpers for normalized models and raw editor documents. */
export function parentOf(document, id) {
  return document.groups?.find(group => group.members.includes(id))?.id ?? '';
}
export function ancestors(document, id) {
  const result = [], seen = new Set([id]);
  for (let parent = parentOf(document, id); parent && !seen.has(parent); parent = parentOf(document, parent)) {
    seen.add(parent); result.unshift(parent);
  }
  return result;
}
export function descendants(document, id) {
  const groups = new Map((document.groups ?? []).map(group => [group.id, group]));
  const result = new Set(), pending = [...(groups.get(id)?.members ?? [])];
  while (pending.length) {
    const member = pending.pop(); if (result.has(member)) continue;
    result.add(member); pending.push(...(groups.get(member)?.members ?? []));
  }
  return result;
}
export function itemPath(document, id) {
  const items = [...document.modules, ...(document.groups ?? [])];
  return [...ancestors(document, id), id].map(key => ({ id: key, label: items.find(item => item.id === key)?.label ?? key }));
}
export function canPlace(document, id, parent) {
  return parent !== id && !descendants(document, id).has(parent);
}
