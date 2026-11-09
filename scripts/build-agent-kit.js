import { build } from 'vite';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const lf = (text) => text.replace(/\r\n/g, '\n');
async function sources(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await sources(path)));
    else if (entry.name.endsWith('.js')) files.push(path);
  }
  return files;
}

export async function buildAgentKit(target = join(root, 'agent-kit')) {
  const schema = lf(await readFile(join(root, 'schema/blockflow.schema.json'), 'utf8'));
  const template = lf(await readFile(join(root, 'docs/agent-kit-readme.md'), 'utf8'));
  const entry = join(root, 'src/agent-kit/converter.js');
  const elk = JSON.parse(await readFile(join(root, 'node_modules/elkjs/package.json'), 'utf8'));
  const license = lf(await readFile(join(root, 'node_modules/elkjs/LICENSE.md'), 'utf8'));
  const hash = createHash('sha256').update(schema).update(template).update(elk.version).update(license);
  hash.update(lf(await readFile(join(root, 'package-lock.json'), 'utf8')));
  for (const path of [
    entry,
    fileURLToPath(import.meta.url),
    ...(await sources(join(root, 'src/lib'))),
  ].sort())
    hash.update(path.slice(root.length).replaceAll('\\', '/')).update(lf(await readFile(path, 'utf8')));
  const version = 'blockflow-agent-kit-' + hash.digest('hex').slice(0, 20);
  const result = await build({
    configFile: false,
    root,
    logLevel: 'error',
    define: { __BLOCKFLOW_KIT_VERSION__: JSON.stringify(version) },
    build: {
      write: false,
      target: 'node22',
      minify: true,
      lib: { entry, formats: ['es'], fileName: () => 'blockflow-convert.mjs' },
      rolldownOptions: {
        platform: 'node',
        external: (id) => id.startsWith('node:'),
        output: { codeSplitting: false },
      },
    },
  });
  const outputs = (Array.isArray(result) ? result : [result]).flatMap((r) => r.output);
  if (outputs.length !== 1 || outputs[0].type !== 'chunk')
    throw new Error('Agent kit must produce exactly one JavaScript file.');
  const bundle =
    `/* ${version}\nIncludes elkjs ${elk.version}, Copyright Kiel University and contributors.\nDistributed under EPL-2.0; source: https://github.com/kieler/elkjs\nFull third-party license is in the accompanying README.md. */\n` +
    outputs[0].code;
  const readme =
    template.replaceAll('{{KIT_VERSION}}', version).replaceAll('{{ELK_VERSION}}', elk.version) +
    '\n\n## Bundled elkjs license\n\n' +
    license +
    '\n';
  await mkdir(target, { recursive: true });
  await writeFile(join(target, 'blockflow.schema.json'), schema, 'utf8');
  await writeFile(join(target, 'blockflow-convert.mjs'), bundle, 'utf8');
  await writeFile(join(target, 'README.md'), readme, 'utf8');
  return { version, directory: target, bytes: Buffer.byteLength(bundle) };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const result = await buildAgentKit();
  console.log(`${result.version}: generated three files in ${result.directory} (${result.bytes} JS bytes).`);
}
