/** Labels shared by the automation builder UI. The rules themselves are validated and executed on the server. */

export const TRIGGER_LABELS = {
  "file.uploaded": "A file finishes uploading",
  "file.moved": "A file is moved",
  "file.renamed": "A file is renamed",
  "file.tagged": "A file is tagged",
  "request.upload_received": "Someone uploads through a file request",
} as const;
export type TriggerType = keyof typeof TRIGGER_LABELS;

export const CONDITION_FIELDS = {
  name: { label: "File name", ops: ["contains", "startsWith", "endsWith", "is", "isNot"] },
  extension: { label: "Extension", ops: ["is", "isNot"] },
  category: { label: "Type", ops: ["is", "isNot"] },
  mime: { label: "MIME type", ops: ["is", "isNot", "startsWith"] },
  size: { label: "Size", ops: ["gt", "lt"] },
  tag: { label: "Has tag", ops: ["is", "isNot"] },
} as const;
export type ConditionField = keyof typeof CONDITION_FIELDS;

export const OP_LABELS: Record<string, string> = {
  is: "is",
  isNot: "is not",
  contains: "contains",
  startsWith: "starts with",
  endsWith: "ends with",
  gt: "is larger than",
  lt: "is smaller than",
};

export const ACTION_LABELS = {
  move: "Move to a folder",
  copy: "Copy to a folder",
  tag: "Add tags",
  rename: "Rename",
  archive: "Archive",
  share: "Create a share link",
  notify: "Send me a notification",
} as const;
export type ActionType = keyof typeof ACTION_LABELS;
