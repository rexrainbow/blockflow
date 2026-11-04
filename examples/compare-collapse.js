import {readFile,mkdir,writeFile} from 'node:fs/promises';
import sharp from 'sharp';
import {createDiagramModel,layoutDiagram,renderSvg} from '../src/lib/index.js';

const source=JSON.parse(await readFile(new URL('./boundary-groups.json',import.meta.url),'utf8'));
const directory=new URL('../output/boundary-collapse/',import.meta.url);
await mkdir(directory,{recursive:true});
for(const [name,id] of [['expanded',null],['inner','Inner'],['outer','Outer']]) {
  const input=structuredClone(source);
  if(id) input.groups.find(group=>group.id===id).collapsed=true;
  const layout=await layoutDiagram(createDiagramModel(input)),svg=renderSvg(layout);
  await writeFile(new URL(name+'.json',directory),JSON.stringify(input,null,2)+'\n');
  await writeFile(new URL(name+'.svg',directory),svg);
  await writeFile(new URL(name+'.png',directory),await sharp(Buffer.from(svg)).png().toBuffer());
  console.log(`${name}: ${layout.modules.length} visible blocks, ${layout.groups.length} visible groups, ${layout.connections.length} visible connections`);
}
