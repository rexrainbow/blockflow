import {readFile,mkdir,writeFile} from 'node:fs/promises';
import sharp from 'sharp';
import {createDiagramModel,layoutDiagram,renderSvg} from '../src/lib/index.js';
const source=JSON.parse(await readFile(new URL('./collection-instances.json',import.meta.url),'utf8'));
const directory=new URL('../output/collection/',import.meta.url);
await mkdir(directory,{recursive:true});
for(const collapsed of [true,false]) {
  const input=structuredClone(source),name=collapsed?'collapsed':'expanded';
  input.groups[0].collapsed=collapsed;
  const layout=await layoutDiagram(createDiagramModel(input)),svg=renderSvg(layout);
  await writeFile(new URL(name+'.json',directory),JSON.stringify(input,null,2)+'\n');
  await writeFile(new URL(name+'.svg',directory),svg);
  await writeFile(new URL(name+'.png',directory),await sharp(Buffer.from(svg)).png().toBuffer());
  console.log(`${name}: ${layout.modules.length} blocks, ${layout.connections.length} connections`);
}
