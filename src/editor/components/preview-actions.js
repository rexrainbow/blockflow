import { groupType } from '../../lib/blockchart/group-type.js';

// The toolbar disclosure and pointer/keyboard context menu share these definitions.
export function previewActions(group, rootGroupId = null, kind = null) {
  return [
    { action: 'preview-style', label: 'Edit style…', handler: 'openPreviewStyle' },
    { action: 'preview-label', label: 'Edit label…', handler: 'openPreviewLabel' },
    {
      action: 'preview-terminal',
      label: 'Edit terminal…',
      handler: 'openTerminalDetails',
      hidden: kind !== 'terminal',
    },
    {
      action: 'preview-delete-terminal',
      label: 'Delete terminal',
      handler: 'deleteTerminal',
      hidden: kind !== 'terminal',
    },
    {
      action: 'preview-view-contents',
      label: 'View contents',
      handler: 'changeViewScope',
      useId: true,
      hidden: !group || group.id === rootGroupId,
    },
    {
      action: 'preview-toggle-contents',
      label: group?.collapsed ? 'Show contents' : 'Hide contents',
      handler: 'togglePreviewGroup',
      useId: true,
      hidden: !group || groupType(group) === 'container' || group.id === rootGroupId,
    },
  ];
}
