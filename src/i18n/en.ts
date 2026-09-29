/**
 * English message catalog. User-facing wording that is shared across screens lives here so another language
 * is a new file with the same keys (see src/i18n/index.ts). Only English is shipped today; screens that
 * still hold inline copy can be moved over one at a time without changing how they behave.
 */
export const en = {
  "upload.status.waiting": "Waiting",
  "upload.status.uploading": "Uploading",
  "upload.status.paused": "Paused",
  "upload.status.hashing": "Verifying",
  "upload.status.quarantined": "Quarantined",
  "upload.status.finalizing": "Finalizing",
  "upload.status.processing": "Processing",
  "upload.status.scanning": "Scanning",
  "upload.status.complete": "Complete",
  "upload.status.failed": "Failed",
  "upload.status.cancelled": "Cancelled",
  "upload.status.retrying": "Retrying",

  "activity.uploaded": "Uploaded",
  "activity.downloaded": "Downloaded",
  "activity.renamed": "Renamed",
  "activity.moved": "Moved",
  "activity.copied": "Copied",
  "activity.deleted": "Moved to trash",
  "activity.restored": "Restored",
  "activity.version_created": "Uploaded a new version of",
  "activity.version_restored": "Restored an older version of",
  "activity.tagged": "Changed tags on",
  "activity.quarantined": "Quarantined",
  "activity.created": "Created",
  "activity.revoked": "Revoked a link for",
  "activity.upload_received": "Received an upload",

  "common.cancel": "Cancel",
  "common.save": "Save",
  "common.delete": "Delete",
  "common.close": "Close",
  "common.tryAgain": "Try again",
  "common.loading": "Loading…",

  "plan.upgrade.title": "{feature} isn't included in your {plan} plan.",
  "plan.upgrade.link": "See what each plan includes",
  "storage.full": "Storage is full. New uploads are blocked.",
  "storage.percent": "Storage is {percent}% full.",
} as const;

export type MessageKey = keyof typeof en;
export type Catalog = Record<MessageKey, string>;
