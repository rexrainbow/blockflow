// Apply a simultaneous ID mapping so rename chains and swaps keep object identity.
// Reference paths address the original snapshot and include both endpoint syntaxes.
export function remapModules(document, names) {
  const references = new Map([...names.keys()].map((id) => [id, []]));
  function replace(value, path, endpoint = false) {
    const id = endpoint ? (typeof value === 'string' ? value.split('.')[0] : value?.moduleId) : value;
    if (!names.has(id)) return value;
    const next = endpoint
      ? typeof value === 'string'
        ? names.get(id) + value.slice(id.length)
        : { ...value, moduleId: names.get(id) }
      : names.get(id);
    references.get(id).push({ path, before: value, after: next });
    return next;
  }
  for (const module of document.modules) module.id = names.get(module.id) ?? module.id;
  function grid(owner, path) {
    owner.layout?.cells?.forEach((row, r) => {
      row.forEach((id, c) => {
        row[c] = replace(id, `${path}/layout/cells/${r}/${c}`);
      });
    });
  }
  grid(document, '');
  document.groups?.forEach((group, i) => {
    group.members = group.members.map((id, j) => replace(id, `/groups/${i}/members/${j}`));
    grid(group, `/groups/${i}`);
  });
  document.connections?.forEach((net, i) => {
    net.from = replace(net.from, `/connections/${i}/from`, true);
    net.to = net.to.map((entry, j) => {
      const path = `/connections/${i}/to/${j}`;
      return Object.hasOwn(entry, 'endpoint')
        ? { ...entry, endpoint: replace(entry.endpoint, path + '/endpoint', true) }
        : replace(entry, path, true);
    });
  });
  return references;
}
