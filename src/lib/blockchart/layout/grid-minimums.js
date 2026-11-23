/** Derive effective Block minima before projection and all geometry measurement.
 * Only explicit module IDs qualify; a Container cell never recursively sizes its
 * children. Applicable Grid bounds combine by max, including across scoped views.
 * No effective dimension is written back into the supplied normalized model.
 */
export function withGridBlockMinimums(model) {
  const configs = [model.layout, ...model.groups.map((g) => g.layout)].filter(
    (c) => c?.type === 'grid' && (c.blockMinWidth !== undefined || c.blockMinHeight !== undefined),
  );
  if (!configs.length) return model;
  const modules = new Map(model.modules.map((m) => [m.id, m]));
  const bounds = new Map();
  for (const config of configs)
    for (const id of config.cells.flat()) {
      const module = modules.get(id);
      if (!module || module.type === 'concat') continue;
      const previous = bounds.get(id) ?? { width: 0, height: 0 };
      bounds.set(id, {
        width: Math.max(previous.width, config.blockMinWidth ?? 0),
        height: Math.max(previous.height, config.blockMinHeight ?? 0),
      });
    }
  let changed = false;
  const effective = model.modules.map((module) => {
    const bound = bounds.get(module.id);
    if (!bound) return module;
    const width = Math.max(module.width ?? 0, bound.width),
      height = Math.max(module.height ?? 0, bound.height);
    const patch = {};
    if (bound.width && width !== module.width) patch.width = width;
    if (bound.height && height !== module.height) patch.height = height;
    if (!Object.keys(patch).length) return module;
    changed = true;
    return { ...module, ...patch };
  });
  return changed ? { ...model, modules: effective } : model;
}
