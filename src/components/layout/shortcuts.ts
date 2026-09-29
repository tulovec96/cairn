/** Every keyboard shortcut the app implements. The help dialog renders this list, so it can't drift from reality. */
export interface Shortcut {
  keys: string[];
  label: string;
  group: "Global" | "Navigation" | "File manager";
}

export const SHORTCUTS: Shortcut[] = [
  { keys: ["Ctrl", "K"], label: "Open the command palette", group: "Global" },
  { keys: ["/"], label: "Focus the search box", group: "Global" },
  { keys: ["?"], label: "Show keyboard shortcuts", group: "Global" },
  { keys: ["U"], label: "Upload files", group: "Global" },
  { keys: ["G", "D"], label: "Go to the dashboard", group: "Navigation" },
  { keys: ["G", "F"], label: "Go to all files", group: "Navigation" },
  { keys: ["G", "R"], label: "Go to recent files", group: "Navigation" },
  { keys: ["G", "S"], label: "Go to shared links", group: "Navigation" },
  { keys: ["G", "M"], label: "Go to the media library", group: "Navigation" },
  { keys: ["G", "T"], label: "Go to the trash", group: "Navigation" },
  { keys: ["G", "A"], label: "Go to analytics", group: "Navigation" },
  { keys: ["Ctrl", "A"], label: "Select everything in the list", group: "File manager" },
  { keys: ["Shift", "Click"], label: "Select a range of files", group: "File manager" },
  { keys: ["Delete"], label: "Move the selection to the trash", group: "File manager" },
  { keys: ["Esc"], label: "Clear the selection or close a panel", group: "File manager" },
];

export const OPEN_PALETTE_EVENT = "cairn:open-palette";
export const OPEN_SHORTCUTS_EVENT = "cairn:open-shortcuts";