import {readFile,mkdir,writeFile} from 'node:fs/promises';
import sharp from 'sharp';
import {createDiagramModel,layoutDiagram,renderSvg} from '../src/lib/index.js';
const source=JSON.parse(await readFile(new URL('./boundary-groups.json',import.meta.url),'utf8'));
source.groups.forEach(group=>group.collapsed=true);
const directory=new URL('../output/group-view/',import.meta.url);
await mkdir(directory,{recursive:true});
await writeFile(new URL('source.json',directory),JSON.stringify(source,null,2)+'\n');
for(const rootGroupId of [null,'Outer','Inner']) {
  const name=rootGroupId??'Top',layout=await layoutDiagram(createDiagramModel(source),{rootGroupId}),svg=renderSvg(layout);
  await writeFile(new URL(name+'.layout.json',directory),JSON.stringify(layout,null,2)+'\n');
  await writeFile(new URL(name+'.svg',directory),svg);
  await writeFile(new URL(name+'.png',directory),await sharp(Buffer.from(svg)).png().toBuffer());
  console.log(`${name}: ${layout.modules.length} blocks, ${layout.connections.length} connections`);
}
