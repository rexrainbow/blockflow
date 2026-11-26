import { readFile, open, rename, unlink, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

export function parse(text, name) {
  try {
    return JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch (cause) {
    throw new Error(name + ': ' + cause.message, { cause });
  }
}

function encode(document, original) {
  const indent = original.match(/\n([ \t]+)"/)?.[1] ?? (original.includes('\n') ? 2 : undefined);
  const eol = original.includes('\r\n') ? '\r\n' : '\n';
  return (
    (original.startsWith('\uFEFF') ? '\uFEFF' : '') +
    JSON.stringify(document, null, indent).replaceAll('\n', eol) +
    (original.endsWith('\n') ? eol : '')
  );
}

export async function replaceDocument(file, original, document) {
  const lock = file + '.blockflow-edit.lock';
  const guard = await open(lock, 'wx');
  try {
    const tmp = file + '.' + randomUUID() + '.tmp';
    const handle = await open(tmp, 'wx', (await stat(file)).mode);
    try {
      try {
        await handle.writeFile(encode(document, original), 'utf8');
      } finally {
        await handle.close();
      }
      if ((await readFile(file, 'utf8')) !== original)
        throw new Error('Diagram changed during apply: ' + file);
      await rename(tmp, file);
    } finally {
      await unlink(tmp).catch((e) => {
        if (e.code !== 'ENOENT') throw e;
      });
    }
  } finally {
    await guard.close();
    await unlink(lock);
  }
}
