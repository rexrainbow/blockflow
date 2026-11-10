/** Coordinates here are absolute. Body paths/shapes and dimensions stay local and unchanged. */
export function translatePoint(point, dx, dy) {
  point.x += dx;
  point.y += dy;
}

export function translatePort(port, dx, dy) {
  for (const point of [port, port.labelPosition, port.labelBounds]) translatePoint(point, dx, dy);
}

/** Translate one owned node; the caller decides whether to recurse through group members. */
export function translateNode(node, dx, dy) {
  for (const point of [node, node.labelPosition, node.labelBounds]) translatePoint(point, dx, dy);
  if (node.anchor) translatePoint(node.anchor, dx, dy);
  for (const port of node.ports ?? []) translatePort(port, dx, dy);
}

/** Translate each label instance once, then restore first-instance aliases. */
export function translateConnection(connection, dx, dy) {
  for (const section of connection.sections)
    for (const point of section.points) translatePoint(point, dx, dy);
  for (const point of connection.routingInfo?.waypoints ?? []) translatePoint(point, dx, dy);
  for (const arrow of [connection.arrow, connection.startArrow])
    if (arrow) {
      arrow.points.forEach((point) => translatePoint(point, dx, dy));
      translatePoint(arrow.bounds, dx, dy);
    }
  if (connection.labelInstances?.length) {
    for (const label of connection.labelInstances) {
      translatePoint(label.position, dx, dy);
      translatePoint(label.bounds, dx, dy);
      label.leader?.forEach((point) => translatePoint(point, dx, dy));
    }
    connection.labelPosition = connection.labelInstances[0].position;
    connection.labelBounds = connection.labelInstances[0].bounds;
  } else if (connection.labelPosition) {
    translatePoint(connection.labelPosition, dx, dy);
    translatePoint(connection.labelBounds, dx, dy);
  }
}
