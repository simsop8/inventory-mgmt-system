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
  if (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent)) return true;
  // iPadOS 13+ Safari reports its User-Agent as desktop macOS by default (no
  // "iPad" token), so the check above alone misses every modern iPad — it falls
  // through to the desktop code path, which is the flaky one on iPad Safari
  // (blob downloads via `<a download>` can silently fail or leave a blank tab).
  // A touch-capable "MacIntel" is the standard way to catch this case.
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
}

// Builds a readable report filename, e.g. buildReportFilename(['Inventory Report', address, tenantNames])
// -> "Inventory Report-123 Example Rd-Jane Tan.pdf". Empty/undefined parts are skipped so the
// name degrades gracefully (e.g. no tenant signed yet) instead of leaving stray dashes.
// Only characters that are unsafe in a filename on Windows/macOS are stripped — everything
// else (spaces, commas, accents) is kept so the name stays human-readable.
export function buildReportFilename(parts: Array<string | null | undefined>, extension = 'pdf'): string {
  const clean = parts
    .map(p => (p || '').replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const base = (clean.join('-') || 'report').slice(0, 150);
  return `${base}.${extension}`;
}

// The "location" portion of a save/report filename, per the naming convention:
// unit numbers repeat across every condo in Singapore, so a unit number alone is
// meaningless in a filename — condos are identified by "Condo Name-#Unit" instead.
// Landed properties have no condo name, so the block-and-street address stands in
// for it. Either way, "Singapore" and the postal code are stripped out — the
// postal-code lookup auto-fills them onto the address field, but they're just
// clutter in a filename.
export function buildPropertyLabel(details: {
  propertyType?: string;
  condoName?: string;
  unitNo?: string;
  address?: string;
  postalCode?: string;
}): string {
  if (details.propertyType === 'condo' && details.condoName) {
    return [details.condoName, details.unitNo ? `#${details.unitNo}` : null].filter(Boolean).join('-');
  }
  return stripSingaporePostal(details.address, details.postalCode);
}

// Removes a trailing/embedded "Singapore 123456" (or a bare postal code) from an
// address string, e.g. "12 Jalan Besar, Singapore 123456" -> "12 Jalan Besar".
function stripSingaporePostal(address = '', postalCode = ''): string {
  let a = address;
  if (postalCode) {
    a = a.replace(new RegExp(`,?\\s*Singapore\\s*${postalCode}\\b`, 'i'), '');
    a = a.replace(new RegExp(`,?\\s*\\b${postalCode}\\b`), '');
  }
  a = a.replace(/,?\s*\bSingapore\b/i, '');
  return a.replace(/\s*,\s*$/, '').replace(/\s+/g, ' ').trim();
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
    // Only take the "hand off to an already-open tab" path when a caller explicitly
    // pre-opened one (see the doc comment above) — e.g. an immediate preview-on-generate
    // flow with no in-app preview UI of its own. Every current caller shows its own
    // in-app preview first and calls this only when the user taps an explicit
    // "Download / Share" button, so this branch is effectively unused today, but is
    // kept for that use case.
    if (preOpenedWindow !== undefined && isPreviewable(mimeType)) {
      const url = URL.createObjectURL(blob);
      if (preOpenedWindow) {
        preOpenedWindow.location.href = url;
        return 'previewed'; // the tab now owns this URL — don't revoke it here
      }
      URL.revokeObjectURL(url);
      // Popup blocked — fall through to a real share/download below so the user still gets the file.
    }

    // The actual "give me this file" request. Wrapping it in a `File` (not a bare
    // `Blob`) is what lets iOS's share sheet / Save-to-Files suggest the *real*
    // filename — a bare blob: URL opened in a second tab (the old behaviour here for
    // PDFs/images) has no filename info at all, so iOS falls back to either the blob
    // URL's own random UUID or "Unknown", which is exactly the bug this fixes.
    try {
      const file = new File([blob], filename, {
        type: isPreviewable(mimeType) ? mimeType : 'application/octet-stream',
      });
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
