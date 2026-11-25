const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// Compare parsed JSON values, including the order of arrays but not of object keys.
function equal(a, b) {
  if (a === b) return true;
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((v, i) => equal(v, b[i]));
  if (!record(a) || !record(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => Object.hasOwn(b, k) && equal(a[k], b[k]));
}

/** Paths are JSON Pointers into the authored document. Preserve absent fields. */
export function documentDiff(original, edited) {
  const changes = [];
  function visit(before, after, path, context) {
    if (before === after) return;
    if (Array.isArray(before) && Array.isArray(after)) {
      if (before.length === after.length) {
        before.forEach((value, i) => visit(value, after[i], path + '/' + i, context));
        return;
      }
      let i = 0,
        end = before.length,
        next = after.length;
      while (i < end && i < next && equal(before[i], after[i])) i++;
      while (end > i && next > i && equal(before[end - 1], after[next - 1])) {
        end--;
        next--;
      }
      changes.push({
        ...context,
        path,
        index: i,
        removed: before.slice(i, end),
        added: after.slice(i, next),
      });
      return;
    }
    if (record(before) && record(after)) {
      if (path.startsWith('/connections/') && Object.hasOwn(after, 'from')) context = { from: after.from };
      for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
        const child = path + '/' + key.replaceAll('~', '~0').replaceAll('/', '~1');
        if (!Object.hasOwn(before, key)) changes.push({ ...context, path: child, after: after[key] });
        else if (!Object.hasOwn(after, key)) changes.push({ ...context, path: child, before: before[key] });
        else visit(before[key], after[key], child, context);
      }
      return;
    }
    changes.push({ ...context, path, before, after });
  }
  visit(original, edited, '', {});
  return structuredClone(changes);
}
