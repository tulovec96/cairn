/** Every event the platform emits. Webhooks, automations, activity feeds and notifications are all driven from this list. */
export const EVENTS = {
  "file.uploaded": { label: "File uploaded", description: "A file finished uploading and was stored." },
  "file.downloaded": { label: "File downloaded", description: "A file was downloaded (through a share link or the API)." },
  "file.renamed": { label: "File renamed", description: "A file's name changed." },
  "file.moved": { label: "File moved", description: "A file was moved to another folder." },
  "file.copied": { label: "File copied", description: "A file was copied or duplicated." },
  "file.deleted": { label: "File deleted", description: "A file was moved to the trash." },
  "file.restored": { label: "File restored", description: "A file was restored from the trash." },
  "file.version_created": { label: "Version created", description: "A new version of a file was uploaded." },
  "file.version_restored": { label: "Version restored", description: "An older version became the current version." },
  "file.tagged": { label: "File tagged", description: "Tags were added to or removed from a file." },
  "file.quarantined": { label: "File quarantined", description: "A file was blocked by a scan or an administrator." },
  "folder.created": { label: "Folder created", description: "A folder was created." },
  "folder.deleted": { label: "Folder deleted", description: "A folder was moved to the trash." },
  "share.created": { label: "Share created", description: "A share link was created." },
  "share.revoked": { label: "Share revoked", description: "A share link was revoked." },
  "share.deleted": { label: "Share deleted", description: "A share link record was deleted." },
  "request.upload_received": { label: "File request upload", description: "Someone uploaded through one of your file requests or portals." },
  "storage.limit_reached": { label: "Storage limit reached", description: "Storage crossed a warning threshold or is full." },
  "subscription.changed": { label: "Subscription changed", description: "The plan or billing state changed." },
} as const;

export type EventType = keyof typeof EVENTS;
export const EVENT_TYPES = Object.keys(EVENTS) as EventType[];

/** Events that get an entry in a file's / workspace's activity history. */
export const ACTIVITY_EVENTS: ReadonlySet<EventType> = new Set<EventType>([
  "file.uploaded", "file.downloaded", "file.renamed", "file.moved", "file.copied", "file.deleted", "file.restored",
  "file.version_created", "file.version_restored", "file.tagged", "file.quarantined", "folder.created", "folder.deleted",
  "share.created", "share.revoked", "share.deleted", "request.upload_received",
]);