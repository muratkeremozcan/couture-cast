/**
 * How long a download's object URL lives after the click. The click only starts the
 * browser's own load of the URL; WebKit resolves a Blob URL in its network process
 * later, and revoking it first drops the download with no error to report. A loaded
 * runner or a slow phone can take more than a second, so the URL stays for 40 s, the
 * window FileSaver.js uses. Every web Blob-URL download (share card, moderation
 * evidence) releases its URL on this one schedule.
 */
export const BLOB_DOWNLOAD_URL_LIFETIME_MS = 40_000
