import { endpointKey } from './endpoints.js';

export const targetEntries = (connection) => connection.to;
export const targetEndpoint = (entry) =>
  entry && typeof entry === 'object' && Object.hasOwn(entry, 'endpoint') ? entry.endpoint : entry;
export const targetEndpoints = (connection) => targetEntries(connection).map(targetEndpoint);
export function mapConnectionEndpoints(connection, transform) {
  connection.from = transform(connection.from);
  const map = (entry) =>
    entry && typeof entry === 'object' && Object.hasOwn(entry, 'endpoint')
      ? { ...entry, endpoint: transform(entry.endpoint) }
      : transform(entry);
  connection.to = connection.to.map(map);
}
export function pruneConnections(document, remove) {
  document.connections = (document.connections ?? []).filter((edge) => {
    if (remove(edge.from)) return false;
    edge.to = edge.to.filter((entry) => !remove(targetEndpoint(entry)));
    return edge.to.length > 0;
  });
}
export const netKey = (edge) =>
  edge.id
    ? `@net:${edge.id}`
    : `${endpointKey(edge.from)}->${targetEndpoints(edge).map(endpointKey).join('|')}`;
