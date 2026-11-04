import { ancestors } from '../hierarchy.js';
import { createConnectionContext } from '../connectivity.js';
import { resolvePortStyle } from '../styles.js';

/** Full validation precedes projection. Synthetic anchors never enter raw JSON. */
export function visibleModel(model) {
  const collapsed = new Map((model.groups ?? []).filter(group => group.collapsed).map(group => [group.id,group]));
  if (!collapsed.size) return model;
  const representative = id => collapsed.get(ancestors(model,id).find(parent=>collapsed.has(parent)));
  const visible = id => !representative(id);
  const groups=model.groups.filter(group=>visible(group.id)).map(group=>{
    const result={...group,members:group.collapsed?[]:group.members.filter(visible)};
    if(group.type==='collection'&&group.collapsed) {
      const count=group.members.length;
      Object.assign(result,{memberCount:count,stackLayers:Math.min(2,Math.max(0,count-1)),label:group.label+' \u00d7'+count,portMode:'boundary',ports:['input','output'].map(direction=>({
        id:'_collection_'+direction,direction,width:null,displayName:direction==='input'?'Input':'Output',side:direction==='input'?'left':'right',order:0,virtual:true,
        style:resolvePortStyle(model.diagram.style.module,group.portLabelStyle??{},{direction,style:{}}),
      }))});
    }
    return result;
  });
  const modules=model.modules.filter(node=>visible(node.id));
  // A routing shadow gives synthetic anchors geometric roles, without driver checks.
  const context=createConnectionContext({modules,groups:groups.map(group=>group.type==='collection'&&group.collapsed?{...group,type:'boundary'}:group)});
  const connections=model.connections.flatMap(edge=>{
    const a=representative(edge.source.moduleId),b=representative(edge.target.moduleId);
    if((a&&a.type!=='collection')||(b&&b.type!=='collection')||collapsed.has(edge.scope)) return [];
    const source=a?{moduleId:a.id,portId:'_collection_output'}:edge.source;
    const target=b?{moduleId:b.id,portId:'_collection_input'}:edge.target;
    if((a||b)&&source.moduleId===target.moduleId) return [];
    const resolved=context.resolve(source.moduleId+'.'+source.portId,target.moduleId+'.'+target.portId);
    if(resolved.error) throw new Error(resolved.error);
    return [{...edge,source,target,scope:resolved.scope,boundaryScoped:resolved.boundaryScoped,insideSelfLoop:resolved.insideSelfLoop,
      ...(a||b?{originalSource:edge.source,originalTarget:edge.target}:{}),
    }];
  });
  return {...model,modules,groups,connections};
}
