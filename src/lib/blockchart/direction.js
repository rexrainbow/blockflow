export const vertical = (direction) => direction === 'down';
export const portSide = (direction, input, side) =>
  side?({left:'WEST',right:'EAST',top:'NORTH',bottom:'SOUTH'})[side]:vertical(direction) ? (input ? 'NORTH' : 'SOUTH') : input ? 'WEST' : 'EAST';
export function setDirection(document, direction) {
  document.layout ??= {};
  const before = vertical(document.layout.direction),
    after = vertical(direction);
  if (before !== after && document.layout.feedbackSide)
    document.layout.feedbackSide = {
      top: 'left',
      bottom: 'right',
      left: 'top',
      right: 'bottom',
      auto: 'auto',
    }[document.layout.feedbackSide];
  document.layout.direction = direction;
}
