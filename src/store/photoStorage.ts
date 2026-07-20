// Keeps condition-report photo bytes out of the `saved_files.json` Postgres column by
// shuttling them through a Supabase Storage bucket instead — only at the cloud sync
// boundary (see cloudFiles.ts). Every other part of the app (display, PDF generation,
// the cross-app exchange format, local IndexedDB storage) still only ever sees plain
// `data:` URLs on Photo.dataUrl, exactly as before; dehydrateJson/hydrateJson are the
// only two places that know Storage exists at all.
//
// Why this exists: photos were embedded as base64 text directly in the json column.
// A condition report with dozens/hundreds of photos pushed individual rows past 9MB,
// which is what was filling up the free-tier database (500MB cap) as photo volume grew.
// Storage doesn't count against that cap and is built for exactly this.
import { supabase } from '../lib/supabaseClient';

const BUCKET = 'condition-photos';
const STORAGE_PREFIX = 'storage:';

interface RawPhoto {
  id: string;
  dataUrl: string;
  [key: string]: unknown;
}

interface RawProfile {
  photos?: RawPhoto[];
  [key: string]: unknown;
}

function dataUrlToBlob(dataUrl: string): { blob: Blob; contentType: string } {
  const m = /^data:([^;,]+)(;[^,]*)?,(.*)$/.exec(dataUrl);
  const contentType = m?.[1] || 'image/jpeg';
  const base64 = m?.[3] ?? '';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { blob: new Blob([bytes], { type: contentType }), contentType };
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function extFromContentType(ct: string): string {
  if (ct.includes('png')) return 'png';
  if (ct.includes('webp')) return 'webp';
  if (ct.includes('heic')) return 'heic';
  return 'jpg';
}

// Uploads every not-yet-uploaded photo in this profile JSON to Storage, then rewrites
// each photo's dataUrl into a lightweight "storage:<path>" reference — what actually gets
// written to the json column carries no image bytes at all once every photo is dehydrated.
// `ownerUserId` is the saved_files row's actual owner (not necessarily whoever is pushing
// this particular sync — see cloudFiles.ts), matching the Storage RLS policies, which key
// off the same "<owner_user_id>/<photo_id>.<ext>" path.
export async function dehydrateJson(json: string, ownerUserId: string): Promise<string> {
  const profile = JSON.parse(json) as RawProfile;
  if (!Array.isArray(profile.photos) || profile.photos.length === 0) return json;

  // One listing call up front instead of one round-trip per photo trying-and-catching a
  // "already exists" conflict — much cheaper once a property has dozens/hundreds of photos.
  // Photos are immutable once uploaded (editing a photo's caption/area only touches the
  // json, never the pixels), so anything already up there never needs re-uploading.
  const alreadyUploaded = new Set<string>();
  try {
    const { data } = await supabase.storage.from(BUCKET).list(ownerUserId, { limit: 1000 });
    (data || []).forEach(f => alreadyUploaded.add(f.name));
  } catch {
    // Listing failed — fall through and let the per-file upload below handle it
    // (upsert: true means a redundant upload is harmless, just a bit slower).
  }

  const photos = await Promise.all(profile.photos.map(async (p): Promise<RawPhoto> => {
    if (!p?.dataUrl || !p.dataUrl.startsWith('data:')) return p; // already a storage ref, or nothing to do
    const { blob, contentType } = dataUrlToBlob(p.dataUrl);
    const name = `${p.id}.${extFromContentType(contentType)}`;
    const path = `${ownerUserId}/${name}`;
    if (!alreadyUploaded.has(name)) {
      const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType, upsert: true });
      if (error) throw error;
    }
    return { ...p, dataUrl: `${STORAGE_PREFIX}${path}` };
  }));
  return JSON.stringify({ ...profile, photos });
}

// Downloads every "storage:<path>" reference back into a real dataUrl. Called right after
// fetching a file's json from the cloud so everything downstream (PDF gen, the Condition
// Report tab, importProfile, addSavedFile) keeps working with real embedded photos and
// never has to know Storage is involved.
export async function hydrateJson(json: string): Promise<string> {
  const profile = JSON.parse(json) as RawProfile;
  if (!Array.isArray(profile.photos) || profile.photos.length === 0) return json;

  const photos = await Promise.all(profile.photos.map(async (p): Promise<RawPhoto> => {
    if (!p?.dataUrl || !p.dataUrl.startsWith(STORAGE_PREFIX)) return p; // inline already (legacy row), or nothing to do
    const path = p.dataUrl.slice(STORAGE_PREFIX.length);
    const { data, error } = await supabase.storage.from(BUCKET).download(path);
    if (error) throw error;
    return { ...p, dataUrl: await blobToDataUrl(data) };
  }));
  return JSON.stringify({ ...profile, photos });
}
