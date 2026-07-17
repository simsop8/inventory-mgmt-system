// Handing a generated file to the user, on phones especially, needs different treatment
// depending on whether the browser can actually *display* that file type:
//
//  - PDFs (and images): opening the blob directly in a new tab hands it to the phone's
//    native full-screen viewer, and that viewer's own Share/Print icons drive the complete
//    OS share sheet — every installed destination, Dropbox included, exactly like the
//    "open in preview, then share" experience of a dedicated app.
//  - Everything else (JSON, etc.) has no such native viewer — opening it directly just
//    renders raw text in the tab with no way to save it at all (confirmed: this used to be
//    a real dead end for Save Work / Backup). For these we go through
//    `navigator.share({ files: [...] })` instead, which opens the real native share sheet
//    (skipping Safari's plain-download interstitial). We deliberately tag the shared File as
//    generic `application/octet-stream` rather than e.g. `application/json` — iOS's share
//    sheet is far more likely to list every destination for a generic binary blob than for
//    an exact, less-common MIME type. If Web Share isn't available (or is rejected), we fall
//    back to a plain `<a download>`, which iOS turns into its own download-and-save flow
//    (Files/iCloud, plus any provider — e.g. Google Drive — installed as a Files location).
//
// Desktop is untouched throughout — it just downloads the file directly, which is already
// the expected/preferred behaviour there.
export function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
}

const PREVIEWABLE_MIME_PREFIXES = ['application/pdf', 'image/'];
function isPreviewable(mimeType: string): boolean {
  return PREVIEWABLE_MIME_PREFIXES.some(p => mimeType.startsWith(p));
}

export type ShareResult = 'previewed' | 'shared' | 'downloaded' | 'cancelled';

// `preOpenedWindow` exists for callers that need to do async work (e.g. `await import('jspdf')`)
// between the click and having the finished blob ready, for previewable types. iOS Safari's
// popup blocker only allows `window.open()` while it's still part of the synchronous
// user-gesture call stack — any `await` in between breaks that chain — so those callers must
// call `window.open('', '_blank')` as the very first, synchronous line of their click handler
// and pass the resulting handle in here once the blob is ready. Callers with no such gap (or
// non-previewable mime types, which never open a tab) can omit it.
export async function shareOrDownload(
  blob: Blob,
  filename: string,
  mimeType: string,
  preOpenedWindow?: Window | null,
): Promise<ShareResult> {
  if (isMobileDevice()) {
    if (isPreviewable(mimeType)) {
      const url = URL.createObjectURL(blob);
      const win = preOpenedWindow !== undefined ? preOpenedWindow : window.open(url, '_blank');
      if (win) {
        if (preOpenedWindow !== undefined) win.location.href = url;
        return 'previewed'; // the tab now owns this URL — don't revoke it here
      }
      URL.revokeObjectURL(url);
      // Popup blocked — fall through to a plain download below so the user still gets the file.
    } else {
      try {
        const file = new File([blob], filename, { type: 'application/octet-stream' });
        const nav = navigator as Navigator & {
          canShare?: (data: { files?: File[] }) => boolean;
          share?: (data: { files?: File[]; title?: string }) => Promise<void>;
        };
        if (nav.canShare && nav.share && nav.canShare({ files: [file] })) {
          await nav.share({ files: [file], title: filename });
          return 'shared';
        }
      } catch (err) {
        if ((err as { name?: string })?.name === 'AbortError') return 'cancelled'; // user dismissed the share sheet
        // Anything else (e.g. share targets rejecting the file) — fall through to a plain download.
      }
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return 'downloaded';
}
