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

async function buildDomain(domain, overview) {
  const schema = lf(await readFile(join(root, `schema/${domain}.schema.json`), 'utf8'));
  const template = lf(await readFile(join(root, `docs/${domain}-agent-kit-readme.md`), 'utf8'));
  const entry = join(root, `src/agent-kit/${domain}-converter.js`);
  const elk = JSON.parse(await readFile(join(root, 'node_modules/elkjs/package.json'), 'utf8'));
  const license = lf(await readFile(join(root, 'node_modules/elkjs/LICENSE.md'), 'utf8'));
  const hash = createHash('sha256')
    .update(schema)
    .update(template)
    .update(overview)
    .update(elk.version)
    .update(license);
  hash.update(lf(await readFile(join(root, 'package-lock.json'), 'utf8')));
  for (const path of [
    entry,
    fileURLToPath(import.meta.url),
    ...(await sources(join(root, `src/lib/${domain}`))),
    ...(domain === 'statechart' ? await sources(join(root, 'src/lib/flowchart')) : []),
    ...(await sources(join(root, 'src/lib/shared'))),
  ].sort())
    hash.update(path.slice(root.length).replaceAll('\\', '/')).update(lf(await readFile(path, 'utf8')));
  const version = domain + '-agent-kit-' + hash.digest('hex').slice(0, 20);
  const result = await build({
    configFile: false,
    root,
    logLevel: 'error',
    define: {
      [`__${domain.toUpperCase()}_KIT_VERSION__`]: JSON.stringify(version),
    },
    build: {
      write: false,
      target: 'node22',
      minify: true,
      lib: { entry, formats: ['es'], fileName: () => `${domain}-convert.mjs` },
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
  const guide = template.replaceAll('{{KIT_VERSION}}', version).replaceAll('{{ELK_VERSION}}', elk.version);
  return { domain, schema, bundle, guide, version, license, bytes: Buffer.byteLength(bundle) };
}

/** Generate all domains together so the shared guide and build IDs stay matched. */
export async function buildAgentKit(target = join(root, 'agent-kit')) {
  const overview = lf(await readFile(join(root, 'docs/agent-kit-readme.md'), 'utf8'));
  const block = await buildDomain('blockchart', overview);
  const flow = await buildDomain('flowchart', overview);
  const state = await buildDomain('statechart', overview);
  const versions = overview
    .replaceAll('{{BLOCKCHART_KIT_VERSION}}', block.version)
    .replaceAll('{{FLOWCHART_KIT_VERSION}}', flow.version)
    .replaceAll('{{STATECHART_KIT_VERSION}}', state.version);
  const section = (guide) => guide.replace(/^(#{1,5}) /gm, '#$1 ');
  const readme =
    versions +
    '\n\n' +
    section(block.guide) +
    '\n\n' +
    section(flow.guide) +
    '\n\n' +
    section(state.guide) +
    '\n\n## Bundled elkjs license\n\n' +
    block.license +
    '\n';
  await mkdir(target, { recursive: true });
  for (const item of [block, flow, state]) {
    await writeFile(join(target, `${item.domain}.schema.json`), item.schema, 'utf8');
    await writeFile(join(target, `${item.domain}-convert.mjs`), item.bundle, 'utf8');
  }
  await writeFile(join(target, 'README.md'), readme, 'utf8');
  return {
    version: block.version,
    flowchartVersion: flow.version,
    statechartVersion: state.version,
    directory: target,
    bytes: block.bytes,
    flowchartBytes: flow.bytes,
    statechartBytes: state.bytes,
  };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const result = await buildAgentKit();
  console.log(
    `${result.version}\n${result.flowchartVersion}\n${result.statechartVersion}\nGenerated seven files in ${result.directory}.`,
  );
}
