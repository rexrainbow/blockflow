import { singleLine } from '../components/ui.js';

export const validViewRoot = (document, id) =>
  document.groups?.some((group) => group.id === id) ? id : null;

export function viewScopeOptions(document) {
  const groups = document.groups ?? [];
  const names = groups.map((group) => singleLine(group.label ?? group.id));
  const counts = new Map([['Top', 1]]);
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  return [
    { value: '', label: 'Top' },
    ...groups.map((group, index) => ({
      value: group.id,
      label: names[index] + (counts.get(names[index]) > 1 ? ' [' + group.id + ']' : ''),
    })),
  ];
}
