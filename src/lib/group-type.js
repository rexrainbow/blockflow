/** Canonical group type; portMode remains an input compatibility alias. */
export const groupType = group => group.type ?? (group.portMode === 'boundary' ? 'boundary' : 'container');
