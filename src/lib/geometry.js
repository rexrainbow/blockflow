import { TEXT_STYLE, BLOCK_STYLE } from './styles.js';
import { appearanceGeometry } from './appearances.js';
import { verticalModuleGeometry } from './vertical-geometry.js';

// Shared logical unit: the original plain single-row block, independent of content/style.
export const BLOCK_SIZE_UNIT = Object.freeze({ width: 140, height: 84 });

export const textLines = value => value.replace(/\r\n/g, '\n').split('\n');

// Conservative monospace estimate, preserving single-line measurements.
export function textSize(value, style = TEXT_STYLE) {
  if (style.hidden) return {width:0,height:0};
  const lines = textLines(value);
  return {
    width: Math.max(...lines.map(line => Array.from(line).reduce((sum, char) => sum + (char.codePointAt(0) <= 127 ? 8 : 16), 0))) * style.fontSize / 12,
    height: lines.length * style.fontSize * 1.5,
  };
}

export function textBounds(value, position, style) {
  if (style.hidden) return {x:position.x,y:position.y,width:0,height:0};
  const size = textSize(value, style);
  const offset = position.anchor === 'middle' ? size.width / 2 : position.anchor === 'end' ? size.width : 0;
  return {
    x: position.x - offset - style.padding, y: position.y - size.height / 2 - style.padding,
    width: size.width + 2 * style.padding, height: size.height + 2 * style.padding,
  };
}

/** Size all ports before once layout. Bounds include the inward border. */
export function moduleGeometry(module, direction = 'right') {
  if(direction==='down') return verticalModuleGeometry(module,textSize,BLOCK_SIZE_UNIT);
  const appearance=module.appearance ?? (module.type==='concat'?{type:'bar'}:undefined);
  const compact=appearance?.type==='bar';
  const border = Math.max(0, (module.style?.borderWidth ?? BLOCK_STYLE.borderWidth) - 1);
  const title = module.style?.label ?? TEXT_STYLE;
  const titleSize = textSize(module.label, title);
  const titlePadding=title.hidden?0:title.padding;
  const titleHeight = title.hidden?0:Math.max(36, titleSize.height + 2 * titlePadding + 12);
  const inputs = module.ports.filter(p => p.direction === 'input');
  const outputs = module.ports.filter(p => p.direction === 'output');
  const longest = ports => Math.max(0, ...ports.map(p => {
    if(p.style?.hidden) return 0;
    const style = p.style ?? TEXT_STYLE;
    return textSize(p.displayName, style).width + 2 * style.padding;
  }));
  const rows = Array.from({ length: Math.max(inputs.length, outputs.length) }, (_, i) =>
    Math.max(24, ...[inputs[i], outputs[i]].filter(Boolean).map(p => {
      if(p.style?.hidden) return 0;
      const style = p.style ?? TEXT_STYLE;
      return textSize(p.displayName, style).height + 2 * style.padding;
    })));
  const width = Math.max(compact?12:BLOCK_SIZE_UNIT.width, (module.width ?? 0) * BLOCK_SIZE_UNIT.width,
    title.hidden&&compact?0:titleSize.width + 2 * titlePadding + 24 + 2 * border,
    compact&&module.ports.every(p=>p.style.hidden)?12+2*border:longest(inputs) + longest(outputs) + 20 + 2 * border + 24);
  const naturalHeight = titleHeight + rows.reduce((sum, row) => sum + row, 0) + 24 + 2 * border;
  const height = Math.max(naturalHeight, (module.height ?? 0) * BLOCK_SIZE_UNIT.height);
  const extraGap = (height - naturalHeight) / (rows.length + 1);
  let y = titleHeight + 12 + border + extraGap;
  const rowCenters = rows.map(row => { const center = y + row / 2; y += row + extraGap; return center; });
  const measure=port=>{const style=port.style??TEXT_STYLE;return {...port,width:!style.hidden?textSize(port.displayName,style).width+2*style.padding:0,height:Math.max(24,!style.hidden?textSize(port.displayName,style).height+2*style.padding:0)};};
  const result=appearanceGeometry(appearance,{width,height,titleX:width/2,titleY:border+titleHeight/2,rowCenters,portInset:10+border},
    {stroke:module.style?.borderWidth??1,border,titleWidth:titleSize.width+2*titlePadding,titleHeight:titleSize.height+2*titlePadding,inputs:inputs.map(measure),outputs:outputs.map(measure)});
  if (![result.width, result.height, result.titleX,result.titleY,...Object.values(result.portPoints).flatMap(p=>[p.x,p.y])].every(Number.isFinite)) throw new Error(`Non-finite module dimensions: ${module.id}`);
  return result;
}
