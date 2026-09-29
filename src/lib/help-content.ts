/** Help and FAQ copy. Every statement here describes behaviour that exists in the product. */

export interface HelpArticle {
  id: string;
  title: string;
  summary: string;
  steps: string[];
  note?: string;
}

export const HELP_ARTICLES: HelpArticle[] = [
  {
    id: "upload",
    title: "Upload files and folders",
    summary: "Uploads need a signed-in account. They are chunked, verified and resumable.",
    steps: [
      "Open Upload from the sidebar, or open Files and drop files anywhere on the page. Dropping a folder recreates its structure.",
      "The queue at the bottom shows every file's real state: hashing, uploading, verifying, scanning, complete, quarantined or failed.",
      "If you lose your connection or close the tab, come back and choose the same files again from “Interrupted uploads”. Only the missing chunks are sent.",
      "If a file is quarantined, it failed the scan or a file-type rule. It can't be downloaded or shared, and its owner is told why.",
    ],
    note: "Your plan sets the largest file and your total storage. Both are shown on Settings and on the pricing page.",
  },
  {
    id: "share",
    title: "Share a file or folder",
    summary: "A share link is a record you can change or revoke at any time.",
    steps: [
      "Open a file's menu and choose Share, or select several and choose Share in the toolbar.",
      "Set an expiry, an optional password and, if your plan includes them, download or view limits, view-only mode and an IP allow-list.",
      "Copy the link. Anyone who has it can open the page; they don't need an account.",
      "Manage every link under Shared: see views and downloads, change settings, or revoke a link. A revoked link stops working immediately.",
    ],
  },
  {
    id: "request",
    title: "Collect files from other people",
    summary: "A file request lets someone upload to you without an account.",
    steps: [
      "Open File requests and choose New request. Pick the folder where files should land.",
      "Set optional limits: file size, number of files, total size, allowed extensions, an expiry and a password.",
      "Send the link. The sender can only add files; they can't see or change anything else. Each file is scanned like any other upload.",
      "Close the request when you have what you need, or let it expire.",
    ],
    note: "Upload portals are the same idea as a reusable, branded page. Both depend on your plan.",
  },
  {
    id: "people",
    title: "Share a folder with specific people",
    summary: "View-only access for other accounts, separate from public links.",
    steps: [
      "Open a folder's menu in your files and choose Share with people, then enter the email of an account.",
      "They get a notification and find the folder under Shared with me. They can browse it, preview and download files, and can't change, move, delete or re-share anything.",
      "Remove someone from the same dialog and their access ends immediately. They can also leave from their side.",
      "Folders inside an organization use the organization's roles instead, and public links still work for people without an account.",
    ],
    note: "Downloads by people you share with count toward your monthly transfer allowance.",
  },
  {
    id: "search",
    title: "Search with operators",
    summary: "Type in the search box at the top of any page.",
    steps: [
      "Combine words with type:image, ext:pdf, size:>50MB, folder:invoices, tag:2026, modified:<7d, created:>1y, is:shared, has:versions and owner:me.",
      "Put a minus sign in front of a term to exclude it, for example -tag:draft. Quote a phrase to match it exactly.",
      "Choose Save search to keep a query in the sidebar.",
      "The question-mark button next to the search field lists every operator.",
    ],
  },
  {
    id: "versions",
    title: "Versions and the trash",
    summary: "Nothing you delete is gone straight away.",
    steps: [
      "Open a file's details and choose Versions, then upload a new version. The previous one is kept.",
      "Restore an older version to make it current. The one you replaced becomes a version too.",
      "Deleted files go to the trash and can be restored until your plan's retention ends. Trashed files still count toward storage until they are purged.",
      "Empty the trash yourself to free space immediately.",
    ],
    note: "How many versions are kept and for how long depends on your plan.",
  },
  {
    id: "2fa",
    title: "Turn on two-factor authentication",
    summary: "Add a code from your phone to every sign-in.",
    steps: [
      "Open Settings → Security and choose Set up two-factor.",
      "Scan the QR code with an authenticator app, or type the key by hand, then enter the 6-digit code it shows.",
      "Save your backup codes somewhere safe. Each works once and they are shown only now.",
      "You can turn it off, or replace your backup codes, with your password and a current code.",
    ],
  },
  {
    id: "orgs",
    title: "Work in an organization",
    summary: "Shared storage and roles for a team.",
    steps: [
      "Open Organizations and create one, then invite people by email. If email isn't set up, copy the invitation link and send it yourself.",
      "Owners and admins manage members and settings. Members upload, edit, share and delete. Viewers can look and comment.",
      "Switch between personal files and an organization with the workspace switcher at the top of the sidebar.",
      "Storage and limits come from the organization's plan, not yours.",
    ],
  },
  {
    id: "api",
    title: "Use the API",
    summary: "Automate anything you can do in the app.",
    steps: [
      "Open Developer → API keys, create a key with only the scopes it needs, and copy it. It is shown once.",
      "Send it as Authorization: Bearer <key>. The reference lists every endpoint with examples.",
      "Watch your traffic under Developer → API usage. Requests over your plan's per-minute limit get a 429 with a Retry-After header.",
    ],
  },
];

export interface Faq {
  q: string;
  a: string;
}

export const FAQS: Faq[] = [
  { q: "Do I need an account to upload?", a: "Yes. Every stored file belongs to an account. There are no anonymous uploads and no guest accounts." },
  { q: "Do people need an account to download my files?", a: "No. Anyone with a share link can open it, subject to the password, expiry and limits you set." },
  { q: "Can someone send me files without signing up?", a: "Yes, through a file request or an upload portal. They get a link, not an account, and can only add files to the folder you chose." },
  { q: "What if my upload is interrupted?", a: "It resumes. Files are sent in chunks, so choosing the same file again continues from where it stopped. Interrupted uploads are listed on the upload page." },
  { q: "What happens when my storage is full?", a: "New uploads are refused with a message that says why. Free space by deleting large files or emptying the trash (trashed files count until purged). Nothing is deleted automatically." },
  { q: "How long are files kept?", a: "Until you delete them or they reach an expiry you set. Your plan may cap how long a file can live; the upload options show exactly what's allowed. Deleted files stay recoverable in the trash for your plan's retention." },
  { q: "Are files scanned for malware?", a: "Yes, if the operator has connected a scanner such as ClamAV; otherwise file-type rules still apply. Flagged files are quarantined and reviewed by a person before anything is released." },
  { q: "Are my files encrypted?", a: "They travel over HTTPS if the installation uses it. Cairn doesn't encrypt files at rest itself, and files aren't end-to-end encrypted, because the server has to read them to scan and preview. Use disk or bucket encryption on the storage." },
  { q: "Do you track me or sell my data?", a: "No trackers, no ads, no third-party scripts. The only cookies are your session and your theme. Share analytics are simple counters and never identify visitors." },
  { q: "I forgot my password.", a: "Use “Forgot password” on the sign-in page. If email delivery isn't configured on this installation, ask an administrator for a one-time recovery link." },
  { q: "How do I delete my account?", a: "Settings → Your data. You can export everything first. Deleting removes your files, links, keys and sessions for good." },
  { q: "Where are my files stored?", a: "That's up to whoever runs this installation. It can store files on local disk or in any S3-compatible bucket (AWS S3, Cloudflare R2, MinIO and similar). As a user you use it the same way either way." },
  { q: "Is there a mobile app?", a: "No. The web app is built to work on phones, with touch-friendly menus and layouts, and it can be used from any modern browser." },
  { q: "Why is a feature missing from my plan?", a: "Some features depend on the plan. The pricing page lists exactly what each plan includes, and the app tells you when something isn't part of yours." },
];
