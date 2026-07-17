// iPhone (and many other phone) cameras store photos with EXIF "Orientation"
// metadata instead of actually rotating the pixel data — the phone just tags
// "this needs to be rotated 90°/180°/270° to display upright". Browsers respect
// that tag when showing an <img>, which is why photos look fine in the app.
// But canvas/jsPDF read the raw pixel data and ignore the tag entirely, so the
// same photo comes out sideways in a generated PDF.
//
// The fix: decode the photo once at capture time with orientation already
// applied, downscale it to a sane print resolution, and bake both into the
// pixels via a canvas redraw. From then on the stored photo is genuinely
// upright and reasonably sized everywhere — in the app, in the PDF, anywhere
// else it's used.

// Camera photos are commonly 12-50MP (4000-8000px on the long edge). None of
// that resolution is usable in a printed report — a photo box on the page is
// a few centimetres wide. Capping the long edge here keeps both the saved
// profile and the generated PDF small.
//
// Note on quality: the browser's canvas JPEG encoder (used below) produces
// noticeably larger files than an offline encoder (like the one a phone
// camera or a desktop image tool uses) for the same nominal quality number —
// real-world testing at 1024px/q0.6 landed around ~220-270KB per detailed
// photo. Tightened further (800px/q0.5) to keep the free-tier Supabase
// Postgres database (where every photo is stored inline as base64 in the
// saved_files.json column) from filling up — lands around ~90-130KB per
// detailed photo, roughly half the previous budget, while staying legible
// at print size in the generated PDF.
export const MAX_DIMENSION = 800;
export const JPEG_QUALITY = 0.5;

function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load image'));
    img.src = src;
  });
}

// Returns the EXIF orientation value (1-8), or 1 if the file isn't a JPEG,
// has no EXIF data, or anything goes wrong while parsing. Only used as a
// fallback for browsers without createImageBitmap's imageOrientation option
// (see decodeUpright below) — keeps scanning past non-Exif APP1 segments
// (e.g. an XMP block ahead of the Exif one) instead of bailing out early.
function getExifOrientation(buffer: ArrayBuffer): number {
  try {
    const view = new DataView(buffer);
    if (view.byteLength < 4 || view.getUint16(0, false) !== 0xffd8) return 1; // not a JPEG
    const length = view.byteLength;
    let offset = 2;
    while (offset < length - 1) {
      const marker = view.getUint16(offset, false);
      offset += 2;
      if (marker === 0xffe1) {
        const segLength = view.getUint16(offset, false);
        if (view.getUint32(offset + 2, false) === 0x45786966) {
          const tiffOffset = offset + 8;
          const little = view.getUint16(tiffOffset, false) === 0x4949;
          const firstIFDOffset = view.getUint32(tiffOffset + 4, little);
          let dirOffset = tiffOffset + firstIFDOffset;
          const tags = view.getUint16(dirOffset, little);
          dirOffset += 2;
          for (let i = 0; i < tags; i++) {
            const entryOffset = dirOffset + i * 12;
            if (view.getUint16(entryOffset, little) === 0x0112) {
              return view.getUint16(entryOffset + 8, little);
            }
          }
        }
        // Not an Exif APP1 (e.g. XMP) or no orientation tag in it — keep scanning
        // for another APP1 segment rather than giving up immediately.
        offset += segLength;
      } else if ((marker & 0xff00) !== 0xff00) {
        break;
      } else {
        offset += view.getUint16(offset, false);
      }
    }
  } catch { /* fall through */ }
  return 1;
}

// Standard EXIF orientation → canvas transform table.
function applyOrientationTransform(ctx: CanvasRenderingContext2D, orientation: number, w: number, h: number) {
  switch (orientation) {
    case 2: ctx.transform(-1, 0, 0, 1, w, 0); break;
    case 3: ctx.transform(-1, 0, 0, -1, w, h); break;
    case 4: ctx.transform(1, 0, 0, -1, 0, h); break;
    case 5: ctx.transform(0, 1, 1, 0, 0, 0); break;
    case 6: ctx.transform(0, 1, -1, 0, h, 0); break;
    case 7: ctx.transform(0, -1, -1, 0, h, w); break;
    case 8: ctx.transform(0, -1, 1, 0, 0, w); break;
    default: break; // 1 or unknown — already upright
  }
}

interface DecodedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  // Set when the caller still needs to apply the EXIF transform by hand
  // (manual-parse fallback path). When false, `source` is already upright.
  orientation: number;
  needsManualTransform: boolean;
}

// Decodes the file into something drawable, with orientation resolved.
// Prefers createImageBitmap({ imageOrientation: 'from-image' }) — a native
// browser decode that respects EXIF rotation correctly and robustly (handles
// oddities like multiple APP1 segments, HEIC-derived JPEGs, etc. that a
// hand-rolled byte parser can trip over). Falls back to the manual EXIF
// parser + canvas transform for older browsers where that option isn't
// supported.
async function decodeUpright(file: File): Promise<DecodedImage> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, orientation: 1, needsManualTransform: false };
    } catch {
      // Fall through to the manual path below.
    }
  }
  const buffer = await readFileAsArrayBuffer(file);
  const orientation = getExifOrientation(buffer);
  const blob = new Blob([buffer], { type: file.type || 'image/jpeg' });
  const dataUrl = await blobToDataURL(blob);
  const img = await loadImage(dataUrl);
  return { source: img, width: img.naturalWidth, height: img.naturalHeight, orientation, needsManualTransform: orientation > 1 };
}

// Reads a File, corrects its orientation, downscales it to a sane print
// resolution, and returns a plain upright data URL ready to store. Falls
// back to a plain (uncorrected, full-size) data URL if anything about the
// decode/canvas step fails.
export async function normalizeImageOrientation(file: File): Promise<string> {
  try {
    const { source, width, height, orientation, needsManualTransform } = await decodeUpright(file);
    const swap = needsManualTransform && orientation >= 5 && orientation <= 8;
    const uprightW = swap ? height : width;
    const uprightH = swap ? width : height;

    const scale = Math.min(1, MAX_DIMENSION / Math.max(uprightW, uprightH));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(uprightW * scale));
    canvas.height = Math.max(1, Math.round(uprightH * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');

    ctx.scale(scale, scale);
    if (needsManualTransform) applyOrientationTransform(ctx, orientation, width, height);
    ctx.drawImage(source, 0, 0);

    return canvas.toDataURL('image/jpeg', JPEG_QUALITY);
  } catch {
    // Last-resort fallback: just read the file as-is.
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }
}

// Re-encodes an already-stored data URL down to the same size/quality budget
// used at capture time. Used at PDF-export time so photos added before a
// quality/size tune-up (or from an older build) still come out small in the
// generated report, without touching the higher-quality copy kept in the app.
// Returns the original data URL (and a best-effort natural size) if anything
// about the redraw fails, so a PDF export never breaks over one bad photo.
export function recompressDataUrl(
  dataUrl: string,
  maxDimension: number = MAX_DIMENSION,
  quality: number = JPEG_QUALITY
): Promise<{ dataUrl: string; w: number; h: number }> {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      try {
        const naturalW = img.naturalWidth || 1;
        const naturalH = img.naturalHeight || 1;
        const scale = Math.min(1, maxDimension / Math.max(naturalW, naturalH));
        const w = Math.max(1, Math.round(naturalW * scale));
        const h = Math.max(1, Math.round(naturalH * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) { resolve({ dataUrl, w: naturalW, h: naturalH }); return; }
        ctx.drawImage(img, 0, 0, w, h);
        resolve({ dataUrl: canvas.toDataURL('image/jpeg', quality), w, h });
      } catch {
        resolve({ dataUrl, w: img.naturalWidth || 1, h: img.naturalHeight || 1 });
      }
    };
    img.onerror = () => resolve({ dataUrl, w: 1, h: 1 });
    img.src = dataUrl;
  });
}
