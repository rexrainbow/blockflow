import { ancestors } from './hierarchy.js';
import { groupType } from './group-type.js';

export const portOwner = (document, id) => [...document.modules, ...(document.groups ?? [])].find(item => item.id === id);
export const boundaryGroups = document => (document.groups ?? []).filter(group => groupType(group) === 'boundary');

/** Shared endpoint/face rules for model validation and editor option filtering. */
export function createConnectionContext(document) {
  const groups = new Map((document.groups ?? []).map(group => [group.id, group]));
  const owners = new Map([...document.modules, ...groups.values()].map(owner => [owner.id, owner]));
  const paths = new Map([...owners.keys()].map(id => [id, ancestors(document,id)]));
  const ports = new Map();
  for (const owner of owners.values()) {
    if (groups.has(owner.id) && groupType(owner) !== 'boundary') continue;
    for (const port of owner.ports ?? []) ports.set(owner.id+'.'+port.id,{owner,port});
  }
  const lookup = (value, field) => {
    if (typeof value !== 'string' || /^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*$/.exec(value)?.[0] !== value)
      return {error:'Expected moduleId.portId',field};
    const found=ports.get(value);
    if (!found) return {error:'Unknown port: '+value,field};
    return {...found,ref:{moduleId:found.owner.id,portId:found.port.id},isGroup:groups.has(found.owner.id)};
  };
  return {
    resolve(from,to) {
      const source=lookup(from,'from');if (source.error) return source;
      const target=lookup(to,'to');if (target.error) return target;
      const pass=source.isGroup&&source.owner.id===target.owner.id&&source.port.direction==='input'&&target.port.direction==='output';
      const face=(end,peer)=>end.isGroup&&(end.owner.id===peer.owner.id?pass:paths.get(peer.owner.id).includes(end.owner.id));
      source.inside=face(source,target);target.inside=face(target,source);
      for (const [end,field,expected] of [[source,'from',source.inside?'input':'output'],[target,'to',target.inside?'output':'input']]) {
        if (end.port.direction!==expected) return {error:`Expected ${expected} port${end.isGroup ? ' on the '+(end.inside?'inside':'outside')+' of group '+end.owner.id : ''}`,field};
      }
      for (const group of boundaryGroups(document)) {
        const a=paths.get(source.owner.id).includes(group.id),b=paths.get(target.owner.id).includes(group.id);
        if (a!==b&&source.owner.id!==group.id&&target.owner.id!==group.id)
          return {error:`Connection crosses boundary of group ${group.id}; connect through its ports`,field:'to'};
      }
      const sourcePath=[...paths.get(source.owner.id),...(source.inside?[source.owner.id]:[])];
      const targetPath=[...paths.get(target.owner.id),...(target.inside?[target.owner.id]:[])];
      let scope='';
      for(let i=0;i<Math.min(sourcePath.length,targetPath.length)&&sourcePath[i]===targetPath[i];i++) scope=sourcePath[i];
      const scopedPath=scope?[...paths.get(scope),scope]:[];
      return {source,target,scope,insideSelfLoop:pass,boundaryScoped:scopedPath.some(id=>groups.has(id)&&groupType(groups.get(id))==='boundary')};
    },
  };
}

export function boundaryConnectionProblems(document) {
  const context=createConnectionContext(document);
  return (document.connections??[]).flatMap(edge=>{
    const result=context.resolve(edge.from,edge.to);
    return result.error?[`${edge.from} → ${edge.to}: ${result.error}`]:[];
  });
}
