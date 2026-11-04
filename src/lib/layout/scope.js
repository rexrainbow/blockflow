import { descendants } from '../hierarchy.js';
import { createConnectionContext } from '../connectivity.js';

/** A view of a validated model. Source JSON, identity and collapse flags stay intact. */
export function scopeModel(model, rootGroupId) {
  if (rootGroupId === undefined || rootGroupId === null) return model;
  if (typeof rootGroupId !== 'string' || !model.groups?.some(group=>group.id===rootGroupId))
    throw new Error('Unknown view group: '+String(rootGroupId));
  const included=descendants(model,rootGroupId);included.add(rootGroupId);
  const groups=model.groups.filter(group=>included.has(group.id)).map(group=>group.id===rootGroupId?{...group,collapsed:false}:group);
  const modules=model.modules.filter(module=>included.has(module.id));
  const fullContext=createConnectionContext(model),context=createConnectionContext({modules,groups});
  const connections=model.connections.flatMap(edge=>{
    if(!included.has(edge.source.moduleId)||!included.has(edge.target.moduleId)) return [];
    const from=edge.source.moduleId+'.'+edge.source.portId,to=edge.target.moduleId+'.'+edge.target.portId;
    const original=fullContext.resolve(from,to);
    // Endpoint membership alone would include external G.output -> G.input feedback.
    if(!included.has(original.scope)) return [];
    const resolved=context.resolve(from,to);
    if(resolved.error) throw new Error(resolved.error);
    return [{...edge,scope:resolved.scope,boundaryScoped:resolved.boundaryScoped,insideSelfLoop:resolved.insideSelfLoop}];
  });
  return {...model,rootGroupId,modules,groups,connections};
}
