/** Typed description of the implemented public API. The documentation page renders straight from this. */

export interface Param {
  name: string;
  type: string;
  required?: boolean;
  description: string;
}

export interface Endpoint {
  id: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  summary: string;
  description?: string;
  /** none = public, required = API key or browser session, session = browser session only. */
  auth: "none" | "required" | "session";
  scope?: string;
  query?: Param[];
  body?: Param[];
  example?: string;
  response?: string;
}

export interface Section {
  id: string;
  title: string;
  intro?: string;
  endpoints: Endpoint[];
}

const FILE_JSON = `{
  "id": "fil_Xk3v9QmZp2LrT7aB",
  "name": "report.pdf",
  "extension": "pdf",
  "mime": "application/pdf",
  "category": "document",
  "size": 482113,
  "sha256": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
  "status": "available",
  "scanStatus": "not_scanned",
  "folderId": null,
  "version": 1,
  "description": "",
  "tags": [{ "id": "tag_…", "name": "invoices", "color": "#2557e8" }],
  "createdAt": "2030-01-01T12:00:00.000Z",
  "expiresAt": null,
  "downloadCount": 0,
  "favorite": false,
  "share": null
}`;

const SHARE_OPTIONS: Param[] = [
  { name: "password", type: "string | null", description: "4–128 characters. Stored as a scrypt hash." },
  { name: "expiresAt", type: "ISO 8601 | null", description: "Link expiry." },
  { name: "maxDownloads", type: "integer | null", description: "Stops the link after this many downloads. Needs a plan with download limits." },
  { name: "maxViews", type: "integer | null", description: "Stops the link after this many page views. Needs a plan with download limits." },
  { name: "permissions", type: "(\"view\" | \"download\")[]", description: "Leave out \"download\" for a view-only link. Needs a plan with advanced link permissions." },
  { name: "ipAllowlist", type: "string[]", description: "Exact IPs or IPv4 CIDR blocks that may open the link. Same plan requirement." },
  { name: "title", type: "string | null", description: "Heading shown on the link page. Needs custom branding." },
  { name: "message", type: "string | null", description: "Message shown on the link page. Needs custom branding." },
  { name: "showSha256", type: "boolean", description: "Show the checksum on the page (default true)." },
  { name: "embedEnabled", type: "boolean", description: "Allow other sites to embed the file. Needs a plan with embeds." },
];

export function buildSections(base: string): Section[] {
  return [
    {
      id: "uploads",
      title: "Uploading",
      intro:
        "Uploading always needs an account (session or API key). For scripts, send the whole file in one request. For large files or unreliable connections, use resumable uploads: create a session, send chunks in any order (each can be retried), then complete. Plan limits (file size, storage, versions) are enforced by the server.",
      endpoints: [
        {
          id: "upload-simple",
          method: "POST",
          path: "/api/v1/files",
          summary: "Upload a file in one request",
          description: "Accepts multipart/form-data (field name `file`) or a raw body with `?name=`. Options go in form fields (before the file) or query parameters.",
          auth: "required",
          scope: "files:upload",
          body: [
            { name: "file", type: "file", required: true, description: "The file to upload (multipart field)." },
            { name: "folderId", type: "string", description: "Destination folder id. Omit for the top level." },
            { name: "expiresAt", type: "ISO 8601 | \"never\"", description: "When the file is deleted. Omit for no expiry (bounded by your plan)." },
            { name: "share", type: "\"true\" | \"false\"", description: "Also create a public link. Defaults to false, unless a password or download limit is given (those only apply to links)." },
            { name: "password", type: "string", description: "Protects the created link (4–128 characters)." },
            { name: "maxDownloads", type: "integer", description: "Download limit for the created link (plan feature)." },
            { name: "sha256", type: "hex", description: "If provided, the upload is rejected when the checksum differs." },
            { name: "replaceFileId", type: "string", description: "Upload as a new version of this file (plan feature: file versions)." },
          ],
          example: `curl -H "Authorization: Bearer $CAIRN_KEY" \\
     -F "file=@report.pdf" \\
     ${base}/api/v1/files

# raw body
curl -X POST -H "Authorization: Bearer $CAIRN_KEY" \\
     --data-binary @report.pdf \\
     "${base}/api/v1/files?name=report.pdf"`,
          response: `{ "file": ${FILE_JSON.replace(/\n/g, "\n  ")}, "shareUrl": "${base}/d/bN32mHftU1CPf2tqSg5y2l9V" }`,
        },
        {
          id: "upload-init",
          method: "POST",
          path: "/api/v1/uploads",
          summary: "Start a resumable upload",
          description: "Returns the chunk size the server expects.",
          auth: "required",
          scope: "files:upload",
          body: [
            { name: "fileName", type: "string", required: true, description: "Original file name. It is sanitized; it never becomes a filesystem path." },
            { name: "size", type: "integer", required: true, description: "Total size in bytes (> 0)." },
            { name: "folderId", type: "string | null", description: "Destination folder." },
            { name: "expiresAt", type: "ISO 8601 | null", description: "null = never expires (where the plan allows)." },
            { name: "password", type: "string | null", description: "Password for the created link." },
            { name: "maxDownloads", type: "integer | null", description: "Download limit for the created link." },
            { name: "share", type: "boolean", description: "Create a public link when finished." },
            { name: "sha256", type: "hex | null", description: "Expected SHA-256 of the whole file (verified after upload)." },
            { name: "replaceFileId", type: "string | null", description: "Upload as a new version of this file." },
          ],
          example: `curl -X POST ${base}/api/v1/uploads -H "Authorization: Bearer $CAIRN_KEY" \\
     -H "Content-Type: application/json" -d '{"fileName":"backup.tar","size":734003200}'`,
          response: `{ "upload": { "id": "upl_…", "chunkSize": 8388608, "totalChunks": 88, "received": [], "status": "active", "expiresAt": "…" } }`,
        },
        {
          id: "upload-chunk",
          method: "PUT",
          path: "/api/v1/uploads/{id}/chunks/{index}",
          summary: "Send one chunk",
          description: "The body is the raw bytes of chunk `index` (0-based). Every chunk except the last must be exactly `chunkSize` bytes. Chunks can be sent in any order, in parallel, and re-sent safely. Send `X-Chunk-Sha256` to have the server verify the chunk; a mismatch returns 422 `checksum_mismatch`.",
          auth: "required",
          scope: "files:upload",
          response: `{ "chunk": { "index": 0, "sha256": "…", "received": 1 } }`,
        },
        { id: "upload-status", method: "GET", path: "/api/v1/uploads/{id}", summary: "Upload status and resume point", description: "`received` lists the chunk indexes the server has. Send only the missing ones to resume.", auth: "required", scope: "files:upload" },
        {
          id: "upload-complete",
          method: "POST",
          path: "/api/v1/uploads/{id}/complete",
          summary: "Finish the upload",
          description: "409 `incomplete_upload` lists any missing chunks. Otherwise the server hashes the file, verifies your checksum, detects the real content type, stores it and starts scanning. Returns 202 `finalizing`; poll the status endpoint or add `?wait=<seconds>`.",
          auth: "required",
          scope: "files:upload",
          query: [{ name: "wait", type: "integer", description: "Seconds to wait (max 120) for finalization." }],
          body: [{ name: "sha256", type: "hex", description: "Expected SHA-256 of the whole file." }],
        },
        { id: "upload-abort", method: "DELETE", path: "/api/v1/uploads/{id}", summary: "Cancel an upload", description: "Discards received data. Returns 204.", auth: "required", scope: "files:upload" },
        {
          id: "import-url",
          method: "POST",
          path: "/api/v1/imports",
          summary: "Import a file from a URL",
          description: "The server fetches the address in the background and stores the result in your personal files. Private, loopback and link-local addresses are refused, including after redirects and DNS changes. Needs a plan with URL import.",
          auth: "required",
          scope: "files:upload",
          body: [{ name: "url", type: "string", required: true, description: "http(s) address." }, { name: "folderId", type: "string | null", description: "Destination folder." }],
          response: `{ "import": { "id": "imp_…", "status": "queued", "url": "…" } }`,
        },
        { id: "import-list", method: "GET", path: "/api/v1/imports", summary: "Import history and progress", auth: "required", scope: "files:read" },
      ],
    },
    {
      id: "files",
      title: "Files",
      endpoints: [
        {
          id: "files-list",
          method: "GET",
          path: "/api/v1/files",
          summary: "List and search files",
          description: "Cursor-paginated. Folder entries come with the first page. `q` accepts words plus operators, see Search.",
          auth: "required",
          scope: "files:read",
          query: [
            { name: "view", type: "all | recent | favorites | shared | archived", description: "Which collection to list (default all)." },
            { name: "folderId", type: "string | root", description: "Folder to list (view=all)." },
            { name: "q", type: "string", description: "Search string, e.g. `type:image size:>1GB tag:project`." },
            { name: "type", type: "image | video | audio | document | archive | code | other", description: "Filter by category." },
            { name: "sort", type: "name | size | created | modified | downloads | type", description: "Sort field (default name)." },
            { name: "order", type: "asc | desc", description: "Sort direction." },
            { name: "by", type: "uploaded | modified | accessed | shared", description: "Sub-list for view=recent." },
            { name: "cursor", type: "string", description: "`nextCursor` from the previous page." },
            { name: "limit", type: "integer", description: "1–200, default 50." },
          ],
          response: `{ "folders": [ … ], "files": [ … ], "nextCursor": "fil_…", "breadcrumbs": [ … ], "total": 132, "queryErrors": [] }`,
        },
        { id: "file-get", method: "GET", path: "/api/v1/files/{id}", summary: "File details", description: "Metadata, folder path and share links.", auth: "required", scope: "files:read" },
        {
          id: "file-update",
          method: "PATCH",
          path: "/api/v1/files/{id}",
          summary: "Rename, move, describe, label",
          auth: "required",
          scope: "files:write",
          body: [
            { name: "name", type: "string", description: "New file name." },
            { name: "folderId", type: "string | null", description: "Move to a folder (null = top level)." },
            { name: "expiresAt", type: "ISO 8601 | null", description: "New expiry." },
            { name: "favorite", type: "boolean", description: "Star or unstar." },
            { name: "description", type: "string", description: "Up to 2000 characters." },
            { name: "notes", type: "string", description: "Private notes, up to 10000 characters." },
            { name: "colorLabel", type: "#rrggbb | null", description: "Color label." },
            { name: "metadata", type: "object", description: "Custom key/value pairs (strings, up to 30)." },
            { name: "archived", type: "boolean", description: "Archive or unarchive." },
          ],
        },
        { id: "file-delete", method: "DELETE", path: "/api/v1/files/{id}", summary: "Move a file to the trash", description: "Restorable until your plan's trash retention ends.", auth: "required", scope: "files:delete", response: `{ "trashed": 1, "trashIds": ["bat_…"] }` },
        { id: "file-restore", method: "POST", path: "/api/v1/files/{id}/restore", summary: "Restore from the trash", auth: "required", scope: "files:write" },
        { id: "file-copy", method: "POST", path: "/api/v1/files/{id}/copy", summary: "Copy or duplicate a file", description: "The data is copied, so it counts against storage.", auth: "required", scope: "files:write", body: [{ name: "folderId", type: "string | null", description: "Destination (default: same folder)." }, { name: "name", type: "string", description: "Name of the copy." }] },
        { id: "file-versions", method: "GET", path: "/api/v1/files/{id}/versions", summary: "Version history", description: "Needs a plan with file versions. The number kept is limited by the plan.", auth: "required", scope: "files:read" },
        { id: "file-version-restore", method: "POST", path: "/api/v1/files/{id}/versions/{version}", summary: "Make a version current", description: "The version it replaces is kept.", auth: "required", scope: "files:write" },
        { id: "file-version-download", method: "GET", path: "/api/v1/files/{id}/versions/{version}/download", summary: "Download an older version", auth: "required", scope: "files:read" },
        { id: "file-version-delete", method: "DELETE", path: "/api/v1/files/{id}/versions/{version}", summary: "Delete an older version", auth: "required", scope: "files:delete" },
        { id: "file-comments", method: "GET", path: "/api/v1/files/{id}/comments", summary: "Comments on a file", description: "Needs a plan with comments.", auth: "required", scope: "files:read" },
        { id: "file-comment-add", method: "POST", path: "/api/v1/files/{id}/comments", summary: "Add a comment", auth: "required", scope: "files:write", body: [{ name: "body", type: "string", required: true, description: "Up to 4000 characters. @handles mention workspace members." }, { name: "parentId", type: "string", description: "Reply to a comment." }] },
        { id: "file-activity", method: "GET", path: "/api/v1/files/{id}/activity", summary: "Activity history of a file", auth: "required", scope: "files:read" },
        { id: "activity", method: "GET", path: "/api/v1/activity", summary: "Workspace activity", description: "Uploads, downloads, renames, moves, deletes and shares.", auth: "required", scope: "files:read", query: [{ name: "cursor", type: "string", description: "Pagination cursor." }, { name: "action", type: "string", description: "e.g. uploaded, renamed." }] },
        { id: "duplicates", method: "GET", path: "/api/v1/duplicates", summary: "Duplicate files", description: "Groups of files with identical content (same SHA-256). Nothing is ever removed automatically.", auth: "required", scope: "files:read" },
        {
          id: "batch-rename",
          method: "POST",
          path: "/api/v1/batch-rename",
          summary: "Rename many files by pattern",
          description: "With `apply: false` returns a preview with conflicts. With `apply: true` renames all or nothing.",
          auth: "required",
          scope: "files:write",
          body: [{ name: "fileIds", type: "string[]", required: true, description: "Up to 500 files." }, { name: "pattern", type: "string", required: true, description: "Tokens: {name}, {ext}, {number} or {number:3}, {date}, {created}." }, { name: "start", type: "integer", description: "First number for {number}." }, { name: "apply", type: "boolean", description: "Apply the rename (default false = preview)." }],
        },
        { id: "tags-list", method: "GET", path: "/api/v1/tags", summary: "List tags", auth: "required", scope: "files:read" },
        { id: "tags-create", method: "POST", path: "/api/v1/tags", summary: "Create a tag", auth: "required", scope: "files:write", body: [{ name: "name", type: "string", required: true, description: "Up to 40 characters." }, { name: "color", type: "#rrggbb", description: "Tag color." }] },
        { id: "tags-update", method: "PATCH", path: "/api/v1/tags/{id}", summary: "Rename or recolor a tag", auth: "required", scope: "files:write" },
        { id: "tags-delete", method: "DELETE", path: "/api/v1/tags/{id}", summary: "Delete a tag", description: "Removes it from every file. The files stay.", auth: "required", scope: "files:write" },
      ],
    },
    {
      id: "search",
      title: "Search",
      intro:
        "The `q` parameter of GET /api/v1/files is a small query language. Words match file names (all must match); quote phrases with \"double quotes\". Prefix any term with - to exclude it. Relative dates are ages: `modified:<7d` means changed within the last 7 days. Unknown operators are reported in `queryErrors`, never silently ignored.",
      endpoints: [
        {
          id: "search-operators",
          method: "GET",
          path: "/api/v1/files?q=…",
          summary: "Operators",
          auth: "required",
          scope: "files:read",
          body: [
            { name: "type:", type: "category", description: "image, video, audio, document, archive, code, other." },
            { name: "ext:", type: "extension", description: "ext:png" },
            { name: "mime:", type: "content type", description: "mime:image/* or mime:application/pdf" },
            { name: "folder:", type: "name", description: "Files in folders whose name matches (subfolders included)." },
            { name: "tag:", type: "name", description: "Files with a tag (repeat for AND)." },
            { name: "owner:", type: "email | me", description: "Uploader." },
            { name: "size:", type: "comparison", description: "size:>1GB, size:<=10MB, size:10MB..1GB" },
            { name: "created: / modified:", type: "date", description: "ISO date, today, yesterday, or ages like 7d, 2w, 3m, 1y." },
            { name: "is:", type: "favorite | shared | private | archived", description: "State filters." },
            { name: "status:", type: "available | scanning | quarantined", description: "Processing state." },
            { name: "has:", type: "versions | comments | description | tags", description: "Presence filters." },
          ],
        },
        { id: "saved-searches", method: "GET", path: "/api/v1/saved-searches", summary: "List saved searches", description: "Create with POST `{ name, query, pinned }`; change with PATCH and remove with DELETE on `/api/v1/saved-searches/{id}` (browser session).", auth: "session" },
      ],
    },
    {
      id: "downloads",
      title: "Downloads",
      intro: "All download endpoints stream from storage, support HTTP `Range` (resumable downloads) and send `X-Content-Type-Options: nosniff`. Uploaded HTML and scripts are never served inline. Transfer counts against your plan's monthly allowance.",
      endpoints: [
        { id: "download-file", method: "GET", path: "/api/v1/files/{id}/download", summary: "Download your file", description: "Returns `Content-Disposition: attachment`, `Accept-Ranges` and an `ETag` (the file's SHA-256). `HEAD` is supported.", auth: "required", scope: "files:read", example: `curl -L -O -J -C - -H "Authorization: Bearer $CAIRN_KEY" ${base}/api/v1/files/$ID/download` },
        { id: "download-preview", method: "GET", path: "/api/v1/files/{id}/preview", summary: "Inline preview", description: "Images, audio, video and PDFs as stored; SVG sanitized; text and code as `text/plain`. Other types return 415.", auth: "required", scope: "files:read" },
        { id: "download-thumb", method: "GET", path: "/api/v1/files/{id}/thumbnail", summary: "Thumbnail (WebP)", auth: "required", scope: "files:read", query: [{ name: "size", type: "s | m | l", description: "160, 480 or 1280 px (default m)." }] },
        {
          id: "download-public",
          method: "GET",
          path: "/dl/{token}",
          summary: "Download via a share link",
          description: "No key needed. Password-protected links must be unlocked first. View-only links serve previews but refuse downloads (403). For folder shares use `?f=<fileId>` or `?mode=zip`.",
          auth: "none",
          query: [{ name: "f", type: "string", description: "File id inside a shared folder." }, { name: "mode", type: "download | preview | thumb | zip", description: "Rendition (default download)." }, { name: "embed", type: "1", description: "Only honored when the owner enabled embeds for the link." }],
        },
        { id: "archive-create", method: "POST", path: "/api/v1/archives", summary: "Build a ZIP of several items", description: "Built in the background. Poll `GET /api/v1/archives/{id}` until `ready`, then download from `/api/v1/archives/{id}/download`.", auth: "required", scope: "files:read", body: [{ name: "fileIds", type: "string[]", description: "Files (max 1000)." }, { name: "folderIds", type: "string[]", description: "Folders, recursively (max 200)." }] },
        { id: "archive-get", method: "GET", path: "/api/v1/archives/{id}", summary: "Archive progress", auth: "required", scope: "files:read" },
        { id: "archive-download", method: "GET", path: "/api/v1/archives/{id}/download", summary: "Download the finished ZIP", auth: "required", scope: "files:read" },
      ],
    },
    {
      id: "folders",
      title: "Folders",
      endpoints: [
        { id: "folders-list", method: "GET", path: "/api/v1/folders", summary: "List all folders (flat)", description: "`{ id, name, parentId, color }` for every folder, so a tree can be built client-side.", auth: "required", scope: "files:read" },
        { id: "folders-create", method: "POST", path: "/api/v1/folders", summary: "Create a folder", auth: "required", scope: "folders:write", body: [{ name: "name", type: "string", required: true, description: "Unique among siblings." }, { name: "parentId", type: "string | null", description: "Parent folder." }, { name: "color", type: "#rrggbb | null", description: "Color label." }, { name: "description", type: "string", description: "Description." }] },
        { id: "folders-get", method: "GET", path: "/api/v1/folders/{id}", summary: "Get a folder", auth: "required", scope: "files:read" },
        { id: "folders-update", method: "PATCH", path: "/api/v1/folders/{id}", summary: "Rename, move, favorite, archive", description: "Moving a folder into itself or a descendant returns 409.", auth: "required", scope: "folders:write", body: [{ name: "name", type: "string", description: "New name." }, { name: "parentId", type: "string | null", description: "New parent." }, { name: "favorite", type: "boolean", description: "Star or unstar." }, { name: "color", type: "#rrggbb | null", description: "Color." }, { name: "description", type: "string", description: "Description." }, { name: "archived", type: "boolean", description: "Archive." }] },
        { id: "folders-delete", method: "DELETE", path: "/api/v1/folders/{id}", summary: "Move a folder to the trash", description: "Everything inside moves with it and can be restored together.", auth: "required", scope: "files:delete" },
        { id: "folders-members-list", method: "GET", path: "/api/v1/folders/{id}/members", summary: "People a folder is shared with", description: "View-only sharing with other accounts, separate from public links. Personal files only; folders in an organization use the organization's roles. Only the owner can list members.", auth: "required", scope: "shares:write", response: `{ "items": [{ "id": "fmb_…", "userId": "usr_…", "name": "Sam", "email": "sam@example.com", "addedAt": "2030-01-01T12:00:00.000Z" }] }` },
        { id: "folders-members-add", method: "POST", path: "/api/v1/folders/{id}/members", summary: "Share a folder with someone", description: "The answer is identical whether or not an account exists for the address, so it can't be used to discover accounts. People with an account are notified. Up to 50 people per folder.", auth: "required", scope: "shares:write", body: [{ name: "email", type: "string", required: true, description: "The person's account email." }] },
        { id: "folders-members-remove", method: "DELETE", path: "/api/v1/folders/{id}/members/{memberId}", summary: "Remove someone, or leave", description: "The owner removes a member; a member can remove their own access with their membership id.", auth: "required", scope: "files:read" },
      ],
    },
    {
      id: "shared-with-me",
      title: "Shared with me",
      intro: "Folders other accounts shared with you. Members can browse, preview and download what's inside, and nothing else. Anything outside the shared folders answers 404.",
      endpoints: [
        { id: "swm-list", method: "GET", path: "/api/v1/shared-with-me", summary: "Folders shared with you", auth: "required", scope: "files:read", response: `{ "items": [{ "membershipId": "fmb_…", "folderId": "fld_…", "name": "Project", "ownerName": "Alex", "sharedAt": "2030-01-01T12:00:00.000Z" }] }` },
        { id: "swm-browse", method: "GET", path: "/api/v1/shared-with-me/folders/{id}", summary: "Browse a shared folder or any subfolder", description: "Returns subfolders, available files, and the path back to the shared root.", auth: "required", scope: "files:read" },
        { id: "swm-download", method: "GET", path: "/api/v1/shared-with-me/files/{id}/download", summary: "Download a shared file", description: "Supports `Range`. Counts against the owner's transfer allowance.", auth: "required", scope: "files:read" },
        { id: "swm-preview", method: "GET", path: "/api/v1/shared-with-me/files/{id}/preview", summary: "Inline preview of a shared file", auth: "required", scope: "files:read" },
        { id: "swm-thumbnail", method: "GET", path: "/api/v1/shared-with-me/files/{id}/thumbnail", summary: "Thumbnail of a shared file", auth: "required", scope: "files:read", query: [{ name: "size", type: "s | m | l", description: "Default m." }] },
      ],
    },
    {
      id: "shares",
      title: "Shares",
      intro: "Public links are separate from accounts: visitors never get an account or session. Options that need a paid feature are refused with 403 `plan_required`.",
      endpoints: [
        { id: "shares-list", method: "GET", path: "/api/v1/shares", summary: "List your links", auth: "required", scope: "files:read" },
        {
          id: "shares-create",
          method: "POST",
          path: "/api/v1/shares",
          summary: "Create a link",
          description: "Tokens are 24 random base62 characters.",
          auth: "required",
          scope: "shares:write",
          body: [{ name: "fileId", type: "string", description: "Provide exactly one of fileId or folderId." }, { name: "folderId", type: "string", description: "The folder to share." }, ...SHARE_OPTIONS],
          example: `curl -X POST ${base}/api/v1/shares -H "Authorization: Bearer $CAIRN_KEY" -H "Content-Type: application/json" \\
     -d '{"fileId":"fil_…","password":"hunter22","expiresAt":"2030-02-01T00:00:00Z"}'`,
        },
        { id: "shares-update", method: "PATCH", path: "/api/v1/shares/{id}", summary: "Modify or revoke a link", description: "Send `{ \"revoked\": true }` to revoke. `password: null` removes the password.", auth: "required", scope: "shares:write", body: SHARE_OPTIONS },
        { id: "shares-delete", method: "DELETE", path: "/api/v1/shares/{id}", summary: "Delete a link record", auth: "required", scope: "shares:write" },
        { id: "shares-analytics", method: "GET", path: "/api/v1/shares/{id}/analytics", summary: "Views, downloads and referring sites", description: "Counts only; visitors are never identified. Needs a plan with share analytics.", auth: "required", scope: "files:read", query: [{ name: "days", type: "integer", description: "1–365, default 30." }] },
        { id: "shares-public", method: "GET", path: "/api/v1/public/shares/{token}", summary: "Public link metadata", description: "Name, size, preview kind and scan state. Nothing is revealed until a protected link is unlocked.", auth: "none" },
        { id: "shares-unlock", method: "POST", path: "/api/v1/public/shares/{token}/unlock", summary: "Unlock a protected link", description: "Rate limited per address and per link.", auth: "none", body: [{ name: "password", type: "string", required: true, description: "The link password." }] },
        { id: "shares-view", method: "POST", path: "/api/v1/public/shares/{token}/view", summary: "Count a page view", description: "Called once per opening of the link page; applies the view limit.", auth: "none" },
        { id: "shares-report", method: "POST", path: "/api/v1/public/shares/{token}/report", summary: "Report abuse", auth: "none", body: [{ name: "category", type: "malware | copyright | illegal | spam | abuse | other", required: true, description: "Reason." }, { name: "description", type: "string", required: true, description: "Details (5–2000 characters)." }, { name: "contact", type: "string", description: "Optional contact." }, { name: "fileId", type: "string", description: "For folder links: the file being reported." }] },
      ],
    },
    {
      id: "requests",
      title: "File requests & portals",
      intro:
        "Collect files from people without accounts. Uploaders get an upload page at /r/{token} and a per-upload key that can only move bytes for that one upload; everything they send is checked against the request's limits and the owner's plan. Needs plans with file requests (and portals for reusable branded pages).",
      endpoints: [
        { id: "requests-list", method: "GET", path: "/api/v1/requests", summary: "List requests and portals", auth: "required", scope: "files:read" },
        {
          id: "requests-create",
          method: "POST",
          path: "/api/v1/requests",
          summary: "Create a request",
          auth: "required",
          scope: "shares:write",
          body: [
            { name: "name", type: "string", required: true, description: "Shown to uploaders." },
            { name: "kind", type: "request | portal", description: "Portals are reusable and can be branded." },
            { name: "description", type: "string", description: "Instructions for uploaders." },
            { name: "folderId", type: "string | null", description: "Where uploads land." },
            { name: "expiresAt", type: "ISO 8601 | null", description: "Closes automatically." },
            { name: "maxFileBytes / maxFiles / maxTotalBytes", type: "integer | null", description: "Limits per file, file count, and total size." },
            { name: "allowedExtensions", type: "string[]", description: "Empty allows any type that isn't blocked." },
            { name: "password", type: "string | null", description: "Uploaders must enter it first." },
            { name: "brandName / accent / welcomeMessage", type: "string | null", description: "Branding (plan feature)." },
          ],
        },
        { id: "requests-update", method: "PATCH", path: "/api/v1/requests/{id}", summary: "Edit, close or reopen", description: "`{ \"closed\": true }` closes it.", auth: "required", scope: "shares:write" },
        { id: "requests-delete", method: "DELETE", path: "/api/v1/requests/{id}", summary: "Delete a request", auth: "required", scope: "shares:write" },
        { id: "requests-public", method: "GET", path: "/api/v1/public/requests/{token}", summary: "Public request details", auth: "none" },
        { id: "requests-unlock", method: "POST", path: "/api/v1/public/requests/{token}/unlock", summary: "Unlock a protected request", auth: "none", body: [{ name: "password", type: "string", required: true, description: "The request password." }] },
        { id: "requests-upload-init", method: "POST", path: "/api/v1/public/requests/{token}/uploads", summary: "Start an upload (no account)", description: "Returns an `uploadKey`. Send it as `X-Upload-Key` on the calls below.", auth: "none", body: [{ name: "fileName", type: "string", required: true, description: "File name." }, { name: "size", type: "integer", required: true, description: "Bytes." }, { name: "uploaderLabel", type: "string", description: "The uploader's name (optional)." }] },
        { id: "requests-upload-chunk", method: "PUT", path: "/api/v1/public/uploads/{id}/chunks/{index}", summary: "Send a chunk", description: "Same rules as resumable uploads. Header `X-Upload-Key` required.", auth: "none" },
        { id: "requests-upload-complete", method: "POST", path: "/api/v1/public/uploads/{id}/complete", summary: "Finish the upload", description: "Header `X-Upload-Key` required.", auth: "none" },
      ],
    },
    {
      id: "webhooks",
      title: "Webhooks",
      intro:
        "Webhooks POST a JSON event to your endpoint. Each delivery carries `X-Cairn-Event`, `X-Cairn-Delivery`, `X-Cairn-Timestamp` and `X-Cairn-Signature: t=<unix seconds>,v1=<hex>` where v1 is HMAC-SHA256 of `<t>.<raw body>` keyed with your signing secret. Verify the signature in constant time and reject timestamps older than five minutes to prevent replays. Failed deliveries retry with backoff; endpoints that fail 25 times in a row are disabled. Targets on private networks are refused. Needs a plan with webhooks.",
      endpoints: [
        { id: "webhooks-list", method: "GET", path: "/api/v1/webhooks", summary: "List webhooks", auth: "required", scope: "webhooks:write" },
        { id: "webhooks-create", method: "POST", path: "/api/v1/webhooks", summary: "Create a webhook", description: "The signing secret is returned once.", auth: "required", scope: "webhooks:write", body: [{ name: "name", type: "string", required: true, description: "Label." }, { name: "url", type: "string", required: true, description: "https endpoint." }, { name: "events", type: "string[]", required: true, description: "Event types or \"*\": file.uploaded, file.downloaded, file.renamed, file.moved, file.copied, file.deleted, file.restored, file.version_created, file.version_restored, file.tagged, file.quarantined, folder.created, folder.deleted, share.created, share.revoked, share.deleted, request.upload_received, storage.limit_reached, subscription.changed." }], response: `{ "webhook": { "id": "wbh_…", … }, "secret": "whsec_…" }` },
        { id: "webhooks-update", method: "PATCH", path: "/api/v1/webhooks/{id}", summary: "Edit or enable/disable", auth: "required", scope: "webhooks:write" },
        { id: "webhooks-delete", method: "DELETE", path: "/api/v1/webhooks/{id}", summary: "Delete a webhook", auth: "required", scope: "webhooks:write" },
        { id: "webhooks-secret", method: "POST", path: "/api/v1/webhooks/{id}/secret", summary: "Rotate the signing secret", auth: "required", scope: "webhooks:write" },
        { id: "webhooks-test", method: "POST", path: "/api/v1/webhooks/{id}/test", summary: "Send a test event", auth: "required", scope: "webhooks:write" },
        { id: "webhooks-deliveries", method: "GET", path: "/api/v1/webhooks/{id}/deliveries", summary: "Delivery history", auth: "required", scope: "webhooks:write" },
        { id: "webhooks-replay", method: "POST", path: "/api/v1/webhooks/{id}/deliveries/{deliveryId}", summary: "Replay a delivery", auth: "required", scope: "webhooks:write" },
      ],
    },
    {
      id: "automations",
      title: "Automations",
      intro: "Rules run in the background with the owner's permissions: when a trigger happens to a file and every condition matches, the actions run in order. Actions never trigger other automations. Needs a plan with automations.",
      endpoints: [
        { id: "automations-list", method: "GET", path: "/api/v1/automations", summary: "List automations", auth: "required", scope: "automations:read" },
        {
          id: "automations-create",
          method: "POST",
          path: "/api/v1/automations",
          summary: "Create an automation",
          auth: "required",
          scope: "automations:write",
          body: [
            { name: "name", type: "string", required: true, description: "Label." },
            { name: "trigger", type: "{ type, folderId? }", required: true, description: "type: file.uploaded, file.moved, file.renamed, file.tagged, request.upload_received." },
            { name: "conditions", type: "{ field, op, value }[]", description: "field: name, extension, category, mime, size, tag. op: is, isNot, contains, startsWith, endsWith, gt, lt." },
            { name: "actions", type: "object[]", required: true, description: "move { folderId }, copy { folderId }, tag { tags }, rename { pattern }, archive, share { expiresInDays }, notify." },
          ],
          example: `{ "name": "File PDFs", "trigger": { "type": "file.uploaded" },
  "conditions": [ { "field": "extension", "op": "is", "value": "pdf" } ],
  "actions": [ { "type": "tag", "tags": ["pdf"] }, { "type": "move", "folderId": "fld_…" } ] }`,
        },
        { id: "automations-update", method: "PATCH", path: "/api/v1/automations/{id}", summary: "Edit or enable/disable", auth: "required", scope: "automations:write" },
        { id: "automations-delete", method: "DELETE", path: "/api/v1/automations/{id}", summary: "Delete an automation", auth: "required", scope: "automations:write" },
        { id: "automations-runs", method: "GET", path: "/api/v1/automations/{id}/runs", summary: "Run history", auth: "required", scope: "automations:read" },
      ],
    },
    {
      id: "bulk",
      title: "Bulk actions & trash",
      endpoints: [
        {
          id: "bulk",
          method: "POST",
          path: "/api/v1/bulk",
          summary: "Apply an action to many items",
          description: "Actions: `delete`, `move`, `copy`, `favorite`, `unfavorite`, `archive`, `unarchive`, `tag`, `expiry`, `color`, `share`, `restore`, `purge`. Up to 500 ids per list; failures are reported per id. Needs `files:delete` for delete/purge and `shares:write` for share.",
          auth: "required",
          scope: "files:write",
          example: `curl -X POST ${base}/api/v1/bulk -H "Authorization: Bearer $CAIRN_KEY" -H "Content-Type: application/json" \\
     -d '{"action":"tag","fileIds":["fil_a","fil_b"],"add":["invoices"]}'`,
          response: `{ "done": 2, "failed": [] }`,
        },
        { id: "trash-list", method: "GET", path: "/api/v1/trash", summary: "List trashed items", auth: "required", scope: "files:read" },
        { id: "trash-restore", method: "POST", path: "/api/v1/trash/{id}", summary: "Restore a trash entry", auth: "required", scope: "files:write" },
        { id: "trash-purge", method: "DELETE", path: "/api/v1/trash/{id}", summary: "Permanently delete a trash entry", auth: "required", scope: "files:delete" },
        { id: "trash-empty", method: "DELETE", path: "/api/v1/trash", summary: "Empty the trash", auth: "required", scope: "files:delete" },
      ],
    },
    {
      id: "workspaces",
      title: "Organizations & workspaces",
      intro:
        "Every request runs in one workspace: your personal files, or an organization you belong to. Send `X-Cairn-Workspace: <organization id>` with an API key to work in an organization (membership and role are verified on every request). Roles: owner and admin can do everything; members can read, comment, write, delete and share; viewers can read and comment.",
      endpoints: [
        { id: "me", method: "GET", path: "/api/v1/auth/me", summary: "Who am I", description: "User, workspace, memberships, plan features and limits.", auth: "required" },
        { id: "usage-storage", method: "GET", path: "/api/v1/analytics/storage", summary: "Storage breakdown", description: "By type, largest files, trash and version usage. Growth and duplicate figures need a plan with advanced analytics.", auth: "required", scope: "usage:read" },
        { id: "usage-transfer", method: "GET", path: "/api/v1/analytics/transfer", summary: "Upload and download volume", auth: "required", scope: "usage:read", query: [{ name: "days", type: "integer", description: "7–90, default 30." }] },
        { id: "org-list", method: "GET", path: "/api/v1/organizations", summary: "Your organizations", description: "Creating, inviting and changing roles (POST/PATCH/DELETE under /api/v1/organizations) is available in the browser.", auth: "session" },
        { id: "plans", method: "GET", path: "/api/v1/plans", summary: "Plan catalogue", description: "Prices, features and limits for every public plan, straight from the plan records.", auth: "none" },
      ],
    },
  ];
}

export const ERROR_CODES: Array<{ code: string; status: number; meaning: string }> = [
  { code: "bad_request", status: 400, meaning: "The request is malformed." },
  { code: "unauthorized", status: 401, meaning: "Missing or invalid credentials." },
  { code: "password_required", status: 401, meaning: "A password-protected link must be unlocked first." },
  { code: "invalid_password", status: 401, meaning: "Wrong link or account password." },
  { code: "two_factor_required", status: 401, meaning: "The account needs a two-factor code to sign in." },
  { code: "invalid_code", status: 401, meaning: "The two-factor or backup code isn't valid." },
  { code: "forbidden", status: 403, meaning: "No access, the key lacks the scope, or your workspace role doesn't allow it." },
  { code: "account_suspended", status: 403, meaning: "The account is suspended." },
  { code: "plan_required", status: 403, meaning: "The feature isn't included in the plan; `details.requiredPlan` names one that has it." },
  { code: "plan_limit_reached", status: 403, meaning: "A plan limit (keys, webhooks, automations, requests…) was reached." },
  { code: "feature_disabled", status: 403, meaning: "The administrator turned this capability off." },
  { code: "quarantined", status: 403, meaning: "The file was blocked by a security scan or an administrator." },
  { code: "not_found", status: 404, meaning: "The item doesn't exist or you don't have access to it." },
  { code: "conflict", status: 409, meaning: "The operation conflicts with existing data (name in use, invalid move…)." },
  { code: "incomplete_upload", status: 409, meaning: "Not every chunk has been received; `details.missing` lists them." },
  { code: "upload_closed", status: 409, meaning: "The upload was cancelled, expired or is being finalized." },
  { code: "gone", status: 410, meaning: "The link or file has expired, was revoked or removed." },
  { code: "file_too_large", status: 413, meaning: "Larger than the per-file limit of the plan." },
  { code: "blocked_file_type", status: 415, meaning: "This file type isn't allowed." },
  { code: "validation_error", status: 422, meaning: "A field is invalid; see `details`." },
  { code: "checksum_mismatch", status: 422, meaning: "A chunk or file didn't match its SHA-256." },
  { code: "scan_pending", status: 423, meaning: "The file is still being scanned." },
  { code: "rate_limited", status: 429, meaning: "Slow down; see the `Retry-After` header." },
  { code: "quota_exceeded", status: 507, meaning: "Not enough storage for this upload." },
  { code: "maintenance", status: 503, meaning: "Uploads or downloads are temporarily disabled." },
  { code: "internal_error", status: 500, meaning: "Unexpected server error. The response never includes internals." },
];

export const SCOPE_DOCS: Array<{ scope: string; description: string }> = [
  { scope: "files:read", description: "List, read and download files; read upload, archive, import, activity and trash state." },
  { scope: "files:upload", description: "Start and complete uploads and imports. (`files:write` also allows uploading.)" },
  { scope: "files:write", description: "Rename, move, copy, tag, comment on and version files; bulk actions; restore from trash." },
  { scope: "files:delete", description: "Move files and folders to the trash and delete permanently." },
  { scope: "folders:write", description: "Create, rename, move and archive folders." },
  { scope: "shares:write", description: "Create, change, revoke and delete share links, requests and portals." },
  { scope: "webhooks:write", description: "Manage webhooks and read their deliveries." },
  { scope: "automations:read", description: "List automations and their runs." },
  { scope: "automations:write", description: "Create, change and delete automations." },
  { scope: "usage:read", description: "Read storage and transfer analytics." },
];
