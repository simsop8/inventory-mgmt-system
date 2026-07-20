import React, { useEffect, useRef, useState } from 'react';
import { useProperty } from '../store/PropertyContext';
import { useAuth } from '../store/AuthContext';
import { addSavedFile, getAllSavedFiles, deleteSavedFile, renameSavedFile, type SavedFileEntry } from '../store/fileHistory';
import { listCloudFiles, upsertCloudFile, deleteCloudFile, renameCloudFile, getCloudFileJson, type CloudFileEntry } from '../store/cloudFiles';
import { listStaff, addStaff, removeStaff, isStaffAdmin, type StaffEntry } from '../store/staffAccess';
import { listMyShares, addShare, removeShare, type ShareEntry } from '../store/fileShares';
import { shareOrDownload, buildPropertyLabel } from '../utils/share';
import { agentLabel } from '../types';

// A row in the "Saved Files" list, merged from the local IndexedDB library and
// (if signed in) the cloud table — one row per filename, tracking whichever
// local/cloud copy actually exists so Load/Delete can act on both. Note there's no
// `json` here — listing files is metadata-only now (see cloudFiles.ts); use
// resolveEntryJson() below to fetch a specific entry's actual content on demand.
interface MergedFileEntry {
  key: string;
  filename: string;
  savedAt: string;
  local?: SavedFileEntry;
  cloud?: CloudFileEntry;
}

function mergeFileLists(local: SavedFileEntry[], cloud: CloudFileEntry[]): MergedFileEntry[] {
  const map = new Map<string, MergedFileEntry>();
  for (const l of local) {
    map.set(l.filename.toLowerCase(), { key: l.filename.toLowerCase(), filename: l.filename, savedAt: l.savedAt, local: l });
  }
  for (const c of cloud) {
    const key = c.filename.toLowerCase();
    const existing = map.get(key);
    if (existing) {
      const cloudIsNewer = new Date(c.savedAt).getTime() > new Date(existing.savedAt).getTime();
      map.set(key, { ...existing, cloud: c, savedAt: cloudIsNewer ? c.savedAt : existing.savedAt });
    } else {
      map.set(key, { key, filename: c.filename, savedAt: c.savedAt, cloud: c });
    }
  }
  return Array.from(map.values()).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

// Fetches one entry's actual file content, only when something's about to use it
// (Load / Download / Backup) — the freshest copy between local and cloud, preferring
// local when it's not older than the cloud row (no network round-trip needed then).
async function resolveEntryJson(entry: MergedFileEntry): Promise<string> {
  const localIsFreshEnough = entry.local && (!entry.cloud || new Date(entry.local.savedAt) >= new Date(entry.cloud.savedAt));
  if (localIsFreshEnough) return entry.local!.json;
  if (entry.cloud) return getCloudFileJson(entry.cloud.id);
  if (entry.local) return entry.local.json;
  throw new Error('No content available for this file');
}

interface LayoutProps {
  children: React.ReactNode;
  activeTab: string;
  onTabChange: (tab: string) => void;
}

const tabs = [
  { id: 'property', label: 'Property' },
  { id: 'rooms', label: 'Rooms' },
  { id: 'keys', label: 'Keys & Others' },
  { id: 'report', label: 'Inventory Report' },
  { id: 'condition', label: 'Condition Report' },
  { id: 'takeover', label: 'End of Lease Takeover' },
];

const todayStamp = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const nowStamp = () => {
  const d = new Date();
  return `${todayStamp()}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
};

// Strip characters that aren't safe in filenames (Windows/macOS) and tidy whitespace.
const sanitizeForFilename = (s: string) =>
  s.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim();

// Drop a trailing ".json" so a loaded filename can be reused as the Save dialog's default.
const stripJsonExt = (s: string) => s.replace(/\.json$/i, '');

// Default save name convention: condo -> "Condo Name-#Unit-Tenant Name", landed -> "No &
// Street Address-Tenant Name" (Singapore / postal code stripped either way — see
// buildPropertyLabel). Falls back to date if both location and tenant are missing.
const buildDefaultFilename = (profile: {
  details: {
    address: string;
    propertyType?: string;
    condoName?: string;
    unitNo?: string;
    postalCode?: string;
    tenants: { name: string }[];
  };
}) => {
  const location = sanitizeForFilename(buildPropertyLabel(profile.details));
  const tenantName = sanitizeForFilename(
    (profile.details.tenants || []).map(t => t.name).filter(Boolean).join(' & ')
  );
  if (location && tenantName) return `${location}-${tenantName}`;
  if (location) return location;
  if (tenantName) return tenantName;
  return `property-inventory-${todayStamp()}`;
};

type SaveWritable = { write: (d: string) => Promise<void>; close: () => Promise<void> };
type SaveFileHandle = { name: string; createWritable: () => Promise<SaveWritable> };

export const Layout: React.FC<LayoutProps> = ({ children, activeTab, onTabChange }) => {
  const { profile, isLocked, exportProfile, importProfile, clearAllSignatures, resetProfile } = useProperty();
  const { session, cloudSyncEnabled, authError, clearAuthError, signInWithGoogle, switchAccount, signOut } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveFilename, setSaveFilename] = useState('');
  const [savedFilesOpen, setSavedFilesOpen] = useState(false);
  const [mergedFiles, setMergedFiles] = useState<MergedFileEntry[]>([]);
  const [backingUp, setBackingUp] = useState(false);
  const [syncingToCloud, setSyncingToCloud] = useState(false);
  const [syncingEntryKey, setSyncingEntryKey] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [accountDialogOpen, setAccountDialogOpen] = useState(false);
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [staffPanelOpen, setStaffPanelOpen] = useState(false);
  const [staffList, setStaffList] = useState<StaffEntry[]>([]);
  const [newStaffEmail, setNewStaffEmail] = useState('');
  const [staffSubmitting, setStaffSubmitting] = useState(false);
  const [sharePanelOpen, setSharePanelOpen] = useState(false);
  const [shareList, setShareList] = useState<ShareEntry[]>([]);
  const [newShareEmail, setNewShareEmail] = useState('');
  const [shareSubmitting, setShareSubmitting] = useState(false);
  const [renameEntry, setRenameEntry] = useState<MergedFileEntry | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameSubmitting, setRenameSubmitting] = useState(false);
  // Which entries are checked for a selective backup, in the Saved Files list.
  // Keyed by MergedFileEntry.key.
  const [selectedForBackup, setSelectedForBackup] = useState<Set<string>>(new Set());
  // Remembers the file handle + name from the last successful "Save Work" this session,
  // so hitting Save again with the same name overwrites it in place instead of prompting
  // a fresh "Save As" — only renaming the field triggers a new location/handle. The handle
  // itself lives in a ref (only ever touched inside the save handler, never rendered);
  // the name is separate React state since it's also shown/compared in the dialog UI.
  const lastSavedHandleRef = useRef<SaveFileHandle | null>(null);
  // Persisted (not just in-memory) so the "Active" badge in Saved Files still knows which
  // file is open after a page reload — the file handle above can't survive a reload, but the
  // name-based "which entry is this" comparison the badge relies on doesn't need the handle.
  const LAST_SAVED_NAME_KEY = 'property-inventory-last-saved-name';
  const [lastSavedName, setLastSavedNameState] = useState<string | null>(() => {
    return typeof window !== 'undefined' ? window.localStorage.getItem(LAST_SAVED_NAME_KEY) : null;
  });
  const setLastSavedName = (name: string | null) => {
    setLastSavedNameState(name);
    if (typeof window !== 'undefined') {
      if (name) window.localStorage.setItem(LAST_SAVED_NAME_KEY, name);
      else window.localStorage.removeItem(LAST_SAVED_NAME_KEY);
    }
  };

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3200);
  };

  // Surfaces OAuth failures (unapproved Google account) or a mid-session
  // revocation (removed from Staff Access) as a toast, and opens the
  // Account dialog so there's an obvious next step.
  useEffect(() => {
    if (!authError) return;
    showToast(authError);
    setAccountDialogOpen(true);
    clearAuthError();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authError]);

  // Checks admin status whenever the signed-in user changes, so the Staff
  // Access entry point only shows up for admins.
  useEffect(() => {
    if (!session?.user.email) { setIsAdmin(false); return; }
    isStaffAdmin(session.user.email).then(setIsAdmin);
  }, [session?.user.email]);

  const openStaffPanel = async () => {
    setStaffPanelOpen(true);
    try {
      setStaffList(await listStaff());
    } catch {
      showToast("Couldn't load staff list");
    }
  };

  const handleAddStaff = async () => {
    const email = newStaffEmail.trim().toLowerCase();
    if (!email) return;
    setStaffSubmitting(true);
    try {
      await addStaff(email, session?.user.email || '');
      setNewStaffEmail('');
      setStaffList(await listStaff());
      showToast(`${email} can now sign in`);
    } catch (err) {
      showToast(`Couldn't add ${email}: ${(err as Error).message}`);
    } finally {
      setStaffSubmitting(false);
    }
  };

  const handleRemoveStaff = async (email: string) => {
    if (!confirm(`Remove ${email}? Their access is cut off immediately — they'll be signed out next time the app checks (usually within a few seconds), and can no longer sign in.`)) return;
    try {
      await removeStaff(email);
      setStaffList(await listStaff());
      showToast(`${email} removed`);
    } catch (err) {
      showToast(`Couldn't remove ${email}: ${(err as Error).message}`);
    }
  };

  // Sharing your own Saved Files with another existing (approved) user —
  // separate from Staff Access, which controls who can sign in at all.
  // Anyone signed in can share their own files, not just admins.
  const openSharePanel = async () => {
    setSharePanelOpen(true);
    try {
      setShareList(await listMyShares());
    } catch {
      showToast("Couldn't load your shares");
    }
  };

  const handleAddShare = async () => {
    const email = newShareEmail.trim().toLowerCase();
    if (!email) return;
    setShareSubmitting(true);
    try {
      await addShare(email);
      setNewShareEmail('');
      setShareList(await listMyShares());
      showToast(`${email} can now see and edit your saved files`);
    } catch (err) {
      showToast(`Couldn't share with ${email}: ${(err as Error).message}`);
    } finally {
      setShareSubmitting(false);
    }
  };

  const handleRemoveShare = async (share: ShareEntry) => {
    if (!confirm(`Stop sharing your files with ${share.sharedWithEmail}? Their access is cut off immediately.`)) return;
    try {
      await removeShare(share.id);
      setShareList(await listMyShares());
      showToast(`${share.sharedWithEmail} can no longer see your files`);
    } catch (err) {
      showToast(`Couldn't remove ${share.sharedWithEmail}: ${(err as Error).message}`);
    }
  };

  const handleGoogleSignIn = async () => {
    setAuthSubmitting(true);
    try {
      await signInWithGoogle();
    } finally {
      setAuthSubmitting(false);
    }
  };

  const handleSwitchAccount = async () => {
    setAuthSubmitting(true);
    try {
      await switchAccount();
    } finally {
      setAuthSubmitting(false);
    }
  };

  // Human-readable labels for whichever roles currently have a saved signature —
  // shown in the lock banner so it's obvious which pads still need clearing.
  const signedLabels = profile.signatures.map(s => {
    const idx = parseInt(s.role.split('_')[1], 10) || 0;
    if (s.role.startsWith('landlord_')) return profile.details.landlords.length > 1 ? `Landlord ${idx + 1}` : 'Landlord';
    if (s.role.startsWith('tenant_')) return profile.details.tenants.length > 1 ? `Tenant ${idx + 1}` : 'Tenant';
    if (s.role.startsWith('agent_')) {
      const agents = profile.details.agents || [];
      return agentLabel(agents[idx], idx, agents.length);
    }
    return s.name || 'Signature';
  });

  const handleClearAllSignatures = () => {
    if (confirm('Clear all signatures? Everyone will need to sign again afterwards.')) {
      clearAllSignatures();
      showToast('All signatures cleared — editing unlocked');
    }
  };

  const handleReset = () => {
    if (confirm("This will clear all data on this property — rooms, items, keys, photos, and signatures. This can't be undone, so back up first if you might need it again. Continue?")) {
      resetProfile();
      lastSavedHandleRef.current = null;
      setLastSavedName(null);
      showToast('All data cleared');
    }
  };

  const handleSignOut = async () => {
    await signOut();
    setAccountDialogOpen(false);
    showToast('Signed out');
  };

  const closeAccountDialog = () => {
    setAccountDialogOpen(false);
  };

  const openSaveDialog = () => {
    // Always suggest the name the current property details compute to under the naming
    // convention — not whatever this file happened to be called last (which matters for
    // files loaded from an older save, an import, or a colleague's share that predates
    // the convention, or that just have a different tenant/unit filled in now). If nothing
    // about the property has changed since the last save, this naturally comes out
    // identical to lastSavedName anyway, so the one-click "Save again = overwrite" flow
    // for repeat saves of the same property is unaffected.
    setSaveFilename(buildDefaultFilename(profile));
    setSaveDialogOpen(true);
  };

  const refreshSavedFiles = async () => {
    let local: SavedFileEntry[] = [];
    try {
      local = await getAllSavedFiles();
    } catch {
      /* ignore */
    }
    let cloud: CloudFileEntry[] = [];
    if (cloudSyncEnabled && session) {
      try {
        cloud = await listCloudFiles();
      } catch {
        /* offline or request failed — fall back to local-only list below */
      }
    }
    setMergedFiles(mergeFileLists(local, cloud));
  };

  // Best-effort push to the cloud table. Returns null when sync isn't applicable
  // (not signed in / not configured), true on success, false on failure — callers
  // use this to fold a "· synced" / "· cloud sync failed" note into their toast
  // without ever blocking on it or breaking the local save.
  const trySync = async (filename: string, json: string): Promise<boolean | null> => {
    if (!cloudSyncEnabled || !session) return null;
    try {
      await upsertCloudFile(filename, json);
      return true;
    } catch {
      return false;
    }
  };

  // Turns a trySync() result into a short suffix for the save toast.
  const syncSuffix = (cloudOk: boolean | null) =>
    cloudOk === true ? ' · synced to cloud' : cloudOk === false ? ' · cloud sync failed (saved locally)' : '';

  // Explicit, user-triggered push of every locally-saved file up to the cloud — the
  // counterpart to local-first saving. Saves never wait on the network, so this is how
  // you catch the cloud back up after working offline (or any time you just want to be
  // sure everything's mirrored). Best-effort per file: one failure doesn't stop the rest.
  const syncAllToCloud = async () => {
    if (!cloudSyncEnabled || !session) return;
    setSyncingToCloud(true);
    try {
      const local = await getAllSavedFiles();
      if (local.length === 0) { showToast('No saved files to sync yet'); return; }
      let ok = 0, fail = 0;
      for (const entry of local) {
        try { await upsertCloudFile(entry.filename, entry.json); ok++; }
        catch { fail++; }
      }
      showToast(fail === 0
        ? `Synced ${ok} file${ok === 1 ? '' : 's'} to cloud`
        : `Synced ${ok} file${ok === 1 ? '' : 's'} · ${fail} failed (offline?)`);
      void refreshSavedFiles();
    } finally {
      setSyncingToCloud(false);
    }
  };

  // Pushes just one Saved Files entry up to the cloud — the one-off counterpart to
  // "Sync to Cloud" for when only a single file's status light is red. Needs the entry's
  // local copy (json) since that's the freshest thing worth pushing.
  const syncEntryToCloud = async (entry: MergedFileEntry) => {
    if (!cloudSyncEnabled || !session || !entry.local) return;
    setSyncingEntryKey(entry.key);
    try {
      await upsertCloudFile(entry.local.filename, entry.local.json);
      showToast(`Synced ${entry.filename} to cloud`);
      void refreshSavedFiles();
    } catch {
      showToast(`Couldn't sync ${entry.filename} — offline?`);
    } finally {
      setSyncingEntryKey(null);
    }
  };

  const confirmSave = async () => {
    const rawName = saveFilename.trim() || `property-inventory-${todayStamp()}`;
    const finalName = rawName.endsWith('.json') ? rawName : `${rawName}.json`;
    const json = exportProfile();

    // Signed in: local storage (IndexedDB) is the durable save and always completes
    // instantly, whether online or not — Save Work never waits on the network, so a
    // spotty/no-internet connection can't make saving feel slow or delayed. Cloud sync
    // (if enabled) is a background, best-effort push after the fact; it never blocks
    // or gates the save, and can also be triggered on demand any time via "Sync to
    // Cloud" in the header.
    if (cloudSyncEnabled && session) {
      await addSavedFile(finalName, json);
      lastSavedHandleRef.current = null;
      setLastSavedName(rawName);
      setSaveDialogOpen(false);
      showToast(`Saved: ${finalName}`);
      void trySync(finalName, json).then(cloudOk => {
        if (cloudOk === false) showToast(`${finalName} saved locally — cloud sync failed (offline?). Try "Sync to Cloud" later.`);
      });
      return;
    }

    // Same name as the last save this session — overwrite that same file handle directly,
    // no dialog needed. Renaming the field (any different name) skips this and falls
    // through to a fresh Save As below.
    if (lastSavedHandleRef.current && lastSavedName === rawName) {
      try {
        const handle = lastSavedHandleRef.current;
        const writable = await handle.createWritable();
        await writable.write(json);
        await writable.close();
        await addSavedFile(handle.name || finalName, json);
        const cloudOk = await trySync(handle.name || finalName, json);
        setSaveDialogOpen(false);
        showToast(`Overwrote ${handle.name || finalName}${syncSuffix(cloudOk)}`);
        return;
      } catch {
        // Handle went stale (permission revoked, file moved/deleted, etc.) — fall
        // through to a fresh Save As below instead of failing silently.
      }
    }

    // Chrome/Edge: a real "Save As" dialog lets the user pick the exact folder.
    const picker = (window as unknown as { showSaveFilePicker?: (opts: unknown) => Promise<SaveFileHandle> }).showSaveFilePicker;

    if (picker) {
      try {
        const handle = await picker({
          suggestedName: finalName,
          types: [{ description: 'Property Inventory JSON', accept: { 'application/json': ['.json'] } }],
        });
        const writable = await handle.createWritable();
        await writable.write(json);
        await writable.close();
        await addSavedFile(handle.name || finalName, json);
        const cloudOk = await trySync(handle.name || finalName, json);
        lastSavedHandleRef.current = handle;
        setLastSavedName(rawName);
        setSaveDialogOpen(false);
        showToast(`Saved to ${handle.name || finalName}${syncSuffix(cloudOk)}`);
        return;
      } catch (err) {
        if ((err as { name?: string })?.name === 'AbortError') return; // user cancelled the dialog
        // fall through to the download fallback below
      }
    }

    // Not signed in (or the cloud save above failed) — no file-system picker here either
    // (mobile Safari, older desktop Safari/Firefox). JSON has no native in-browser viewer
    // (unlike PDF), so we go through the OS share sheet
    // instead — Save to Files (iCloud), Google Drive, Dropbox, AirDrop, Mail, etc. all one tap
    // away. Falls back to a plain download (Files/iCloud + any installed Files-provider app) if
    // sharing isn't available. Desktop without a picker just downloads normally. Either way
    // there's no reusable file handle, so leave lastSavedName alone (don't claim a name we can't
    // actually reuse next time).
    const blob = new Blob([json], { type: 'application/json' });
    const result = await shareOrDownload(blob, finalName, 'application/json');
    if (result === 'cancelled') return; // user dismissed the share sheet — nothing was saved

    await addSavedFile(finalName, json);
    const cloudOk = await trySync(finalName, json);
    setSaveDialogOpen(false);
    showToast((result === 'shared' ? 'Saved — check the destination you chose' : 'File saved to your computer') + syncSuffix(cloudOk));
  };

  // Shared by "Backup" (everything) and "Backup Selected" (a chosen subset) —
  // writes each file into a folder the user picks (Chrome/Edge), or falls back
  // to one bundled download/share on browsers without a folder picker.
  const backupFiles = async (filesToBackUp: { filename: string; json: string }[], bundleLabel: string) => {
    if (!filesToBackUp.length) {
      showToast('Nothing selected to back up');
      return;
    }
    setBackingUp(true);
    try {
      const dirPicker = (window as unknown as { showDirectoryPicker?: (opts: unknown) => Promise<{ getFileHandle: (name: string, opts: { create: boolean }) => Promise<{ createWritable: () => Promise<{ write: (d: string) => Promise<void>; close: () => Promise<void> }> }> }> }).showDirectoryPicker;

      if (dirPicker) {
        try {
          const dirHandle = await dirPicker({ mode: 'readwrite' });
          let count = 0;
          for (const f of filesToBackUp) {
            const fileHandle = await dirHandle.getFileHandle(f.filename, { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(f.json);
            await writable.close();
            count++;
          }
          showToast(`Backed up ${count} file${count === 1 ? '' : 's'} to folder`);
          return;
        } catch (err) {
          if ((err as { name?: string })?.name === 'AbortError') return; // user cancelled folder picker
          // fall through to bundle-download fallback
        }
      }

      // No folder picker here (mobile Safari, older desktop Safari/Firefox) — bundle everything
      // into one file and route it through the same share-sheet flow as Save Work, so phones
      // get Files/iCloud/Drive/Dropbox/AirDrop/etc. instead of just a plain download.
      const bundleName = `${bundleLabel}-${nowStamp()}.json`;
      const bundle = JSON.stringify({ exportedAt: new Date().toISOString(), files: filesToBackUp }, null, 2);
      const blob = new Blob([bundle], { type: 'application/json' });
      const result = await shareOrDownload(blob, bundleName, 'application/json');
      if (result === 'cancelled') return; // user dismissed the share sheet — nothing was saved
      showToast(result === 'shared'
        ? 'Backed up — check the destination you chose'
        : "Your browser doesn't support folder backup — saved one bundle file instead");
    } finally {
      setBackingUp(false);
    }
  };


  const toggleBackupSelection = (key: string) => {
    setSelectedForBackup(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleSelectAllForBackup = () => {
    setSelectedForBackup(prev => {
      const allKeys = mergedFiles.map(f => f.key);
      return prev.size === allKeys.length ? new Set() : new Set(allKeys);
    });
  };

  const handleBackupSelected = async () => {
    const files: { filename: string; json: string }[] = [];
    for (const entry of mergedFiles) {
      if (!selectedForBackup.has(entry.key)) continue;
      const filename = entry.filename.endsWith('.json') ? entry.filename : `${entry.filename}.json`;
      try {
        files.push({ filename, json: await resolveEntryJson(entry) });
      } catch {
        showToast(`Couldn't fetch ${entry.filename} — skipped`);
      }
    }
    await backupFiles(files, 'property-inventory-backup-selected');
  };

  const handleLoad = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    let processed = 0;
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = async (ev) => {
        const text = ev.target?.result as string;
        // Always keep a copy in the Saved Files library so it can be reloaded later.
        try { await addSavedFile(file.name, text); } catch { /* ignore */ }
        // Best-effort mirror to the cloud too, so a file loaded from disk on this
        // device also shows up in Saved Files on your other devices. Not awaited —
        // loading shouldn't wait on a network round-trip.
        trySync(file.name, text);

        if (files.length === 1) {
          const ok = importProfile(text);
          showToast(ok ? `Imported: ${file.name}` : 'Invalid file — could not import');
          if (ok) {
            // The old save handle belongs to a different file — forget it so "Save Work"
            // doesn't silently overwrite it, and prefill the dialog with this file's own name.
            lastSavedHandleRef.current = null;
            setLastSavedName(stripJsonExt(file.name));
          }
        }
        processed++;
        if (files.length > 1 && processed === files.length) {
          showToast(`Imported ${files.length} files into Saved Files`);
          refreshSavedFiles();
        }
      };
      reader.readAsText(file);
    });
    e.target.value = '';
  };

  const openSavedFiles = async () => {
    await refreshSavedFiles();
    setSelectedForBackup(new Set());
    setSavedFilesOpen(true);
  };

  const handleLoadMerged = async (entry: MergedFileEntry) => {
    let json: string;
    try {
      json = await resolveEntryJson(entry);
    } catch {
      showToast(`Couldn't load ${entry.filename} — offline?`);
      return;
    }
    const ok = importProfile(json);
    showToast(ok ? `Loaded: ${entry.filename}` : 'Invalid file — could not load');
    if (ok) {
      // Same reasoning as handleLoad: this is a different file, so drop the stale
      // handle/name from whatever was saved before and adopt this file's name instead.
      lastSavedHandleRef.current = null;
      setLastSavedName(stripJsonExt(entry.filename));
      // A cloud-only entry (loaded on a device that hadn't saved it locally yet) —
      // cache it locally too so it's available offline next time.
      if (!entry.local) {
        try { await addSavedFile(entry.filename, json); } catch { /* ignore */ }
      }
      setSavedFilesOpen(false);
    }
  };

  const handleDeleteMerged = async (entry: MergedFileEntry) => {
    if (entry.local) await deleteSavedFile(entry.local.id);
    if (entry.cloud) {
      try { await deleteCloudFile(entry.cloud.id); } catch { /* offline — local delete still went through */ }
    }
    refreshSavedFiles();
  };

  // Explicit, on-demand export of one saved file to local storage / another cloud
  // provider (via the OS share sheet on mobile) — separate from Save Work, which
  // on mobile now saves straight to the cloud without prompting for a destination.
  const handleDownloadMerged = async (entry: MergedFileEntry) => {
    let json: string;
    try {
      json = await resolveEntryJson(entry);
    } catch {
      showToast(`Couldn't download ${entry.filename} — offline?`);
      return;
    }
    const blob = new Blob([json], { type: 'application/json' });
    const result = await shareOrDownload(blob, entry.filename, 'application/json');
    if (result !== 'cancelled') {
      showToast(result === 'shared' ? 'Check the destination you chose' : 'Downloaded');
    }
  };

  // Closes the Saved Files list before opening Rename on top of it — otherwise
  // both dialogs are stacked at the same z-index and the (later-mounted) Saved
  // Files backdrop visually covers the Rename dialog until it's dismissed.
  const openRenameDialog = (entry: MergedFileEntry) => {
    setSavedFilesOpen(false);
    setRenameEntry(entry);
    setRenameValue(stripJsonExt(entry.filename));
  };

  // Cancelling/dismissing Rename returns to the Saved Files list it was opened from.
  const closeRenameDialog = () => {
    setRenameEntry(null);
    setSavedFilesOpen(true);
  };

  // Renames both the local and cloud copies independently (they have separate
  // ids) — whichever of the two actually exist for this entry.
  const confirmRename = async () => {
    if (!renameEntry) return;
    const rawName = renameValue.trim();
    if (!rawName) return;
    const finalName = rawName.endsWith('.json') ? rawName : `${rawName}.json`;
    setRenameSubmitting(true);
    try {
      if (renameEntry.local) await renameSavedFile(renameEntry.local.id, finalName);
      if (renameEntry.cloud) {
        try { await renameCloudFile(renameEntry.cloud.id, finalName); } catch { /* offline — local rename still went through */ }
      }
      // Renaming to match whatever was last saved this session keeps "Save Work" overwriting correctly.
      if (lastSavedName && stripJsonExt(renameEntry.filename) === lastSavedName) {
        lastSavedHandleRef.current = null; // old handle's name is now stale
        setLastSavedName(rawName);
      }
      setRenameEntry(null);
      showToast(`Renamed to ${finalName}`);
      await refreshSavedFiles();
      setSavedFilesOpen(true); // back to the (now updated) list, matching where Rename was opened from
    } catch (err) {
      showToast(`Couldn't rename: ${(err as Error).message}`);
    } finally {
      setRenameSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-gray-900 text-white text-base px-4 py-2 rounded-lg shadow-lg pointer-events-none">
          {toast}
        </div>
      )}

      {saveDialogOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40" onClick={() => setSaveDialogOpen(false)}>
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full mx-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-gray-900 mb-1">Save Work</h3>
            <p className="text-base text-gray-700 mb-4">
              {lastSavedName && saveFilename.trim() === lastSavedName
                ? 'Same name as your last save — this will overwrite that file. Change the name to save a new copy instead.'
                : 'Set a filename, then choose exactly where to save it on your computer.'}
            </p>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Filename</label>
              <div className="flex items-center border border-gray-400 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-primary-500">
                <input
                  autoFocus
                  type="text"
                  value={saveFilename}
                  onChange={e => setSaveFilename(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') confirmSave(); if (e.key === 'Escape') setSaveDialogOpen(false); }}
                  className="flex-1 px-3 py-2 text-base focus:outline-none"
                />
                <span className="px-3 text-base text-gray-600 bg-gray-50 border-l border-gray-300 py-2">.json</span>
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={confirmSave} className="flex-1 py-2 text-base font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700">
                {lastSavedName && saveFilename.trim() === lastSavedName ? 'Save (Overwrite)' : 'Choose Folder & Save'}
              </button>
              <button onClick={() => setSaveDialogOpen(false)} className="flex-1 py-2 text-base font-medium text-gray-800 bg-white border border-gray-400 rounded-lg hover:bg-gray-50">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {renameEntry && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40" onClick={closeRenameDialog}>
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full mx-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-gray-900 mb-1">Rename</h3>
            <p className="text-base text-gray-700 mb-4">Renaming "{renameEntry.filename}" — updates it everywhere it's saved (this device and the cloud, if synced).</p>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">New name</label>
              <div className="flex items-center border border-gray-400 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-primary-500">
                <input
                  autoFocus
                  type="text"
                  value={renameValue}
                  onChange={e => setRenameValue(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') confirmRename(); if (e.key === 'Escape') closeRenameDialog(); }}
                  className="flex-1 px-3 py-2 text-base focus:outline-none"
                />
                <span className="px-3 text-base text-gray-600 bg-gray-50 border-l border-gray-300 py-2">.json</span>
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={confirmRename} disabled={renameSubmitting || !renameValue.trim()} className="flex-1 py-2 text-base font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 disabled:opacity-50">
                Rename
              </button>
              <button onClick={closeRenameDialog} className="flex-1 py-2 text-base font-medium text-gray-800 bg-white border border-gray-400 rounded-lg hover:bg-gray-50">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json,text/json,text/plain"
        multiple
        className="hidden"
        onChange={handleLoad}
      />

      {savedFilesOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40" onClick={() => setSavedFilesOpen(false)}>
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-md w-full mx-4 max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-gray-900 mb-1">Saved Files</h3>
            <p className="text-base text-gray-700 mb-1">Every file you've saved with "Save Work" (or loaded in) lives here. Load any of them back in, or check the ones you want and hit Backup Selected.</p>
            {!session && (
              <p className="text-sm text-amber-700 mb-3">
                Only showing files saved on this device.{' '}
                <button onClick={() => { setSavedFilesOpen(false); setAccountDialogOpen(true); }} className="underline font-medium hover:no-underline">
                  Sign in
                </button>{' '}
                to see files from your other devices too.
              </p>
            )}
            {mergedFiles.length > 0 && (
              <div className="flex items-center justify-between px-1 py-1.5 border-b border-gray-300">
                <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 cursor-pointer">
                  <input type="checkbox" checked={selectedForBackup.size === mergedFiles.length && selectedForBackup.size > 0} onChange={toggleSelectAllForBackup} />
                  Select all
                </label>
                <span className="text-sm text-gray-600">{selectedForBackup.size} selected</span>
              </div>
            )}
            <div className="flex-1 overflow-y-auto -mx-2 px-2 mt-2">
              {mergedFiles.length === 0 ? (
                <p className="text-base text-gray-600 py-6 text-center">No saved files yet.</p>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {mergedFiles.map(entry => {
                    const sharedByOther = entry.cloud?.ownerEmail && entry.cloud.ownerEmail.toLowerCase() !== (session?.user.email || '').toLowerCase();
                    const isActive = !!lastSavedName && stripJsonExt(entry.filename) === lastSavedName;
                    return (
                    <li key={entry.key} className="flex items-start gap-3 py-2.5">
                      <input
                        type="checkbox"
                        checked={selectedForBackup.has(entry.key)}
                        onChange={() => toggleBackupSelection(entry.key)}
                        className="shrink-0 mt-1"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-base font-medium text-gray-900 break-words" title={entry.filename}>
                          {entry.filename}
                          {isActive && (
                            <span className="ml-1.5 inline-block align-middle text-xs font-semibold text-primary-700 bg-primary-50 border border-primary-200 rounded px-1.5 py-0.5">
                              Active
                            </span>
                          )}
                        </p>
                        <p className="text-sm text-gray-600">
                          {new Date(entry.savedAt).toLocaleString()}
                          {sharedByOther && <span className="ml-1.5 text-amber-600">· shared by {entry.cloud!.ownerEmail}</span>}
                        </p>
                        {cloudSyncEnabled && (() => {
                          // "Synced" means there's a cloud copy AND it's not older than what's saved
                          // locally — a cloud row alone isn't enough if the local save has since moved
                          // on (e.g. an earlier background sync failed while offline).
                          const isStale = !!entry.local && !!entry.cloud && new Date(entry.local.savedAt) > new Date(entry.cloud.savedAt);
                          const isSynced = !!entry.cloud && !isStale;
                          return (
                          <div className="flex items-center gap-3 mt-1">
                            <span className="flex items-center gap-1 text-xs text-gray-600" title={entry.local ? 'Saved on this device' : "Not saved on this device — hit Load to pull a local copy"}>
                              <span className={`w-2 h-2 rounded-full ${entry.local ? 'bg-green-500' : 'bg-red-500'}`} />
                              Saved
                            </span>
                            <span className="flex items-center gap-1 text-xs text-gray-600" title={isSynced ? 'Synced to the cloud' : isStale ? 'Cloud copy is out of date' : 'Not synced to the cloud yet'}>
                              <span className={`w-2 h-2 rounded-full ${isSynced ? 'bg-green-500' : 'bg-red-500'}`} />
                              Synced
                            </span>
                            {entry.local && session && (
                              <button
                                onClick={() => { void syncEntryToCloud(entry); }}
                                disabled={syncingEntryKey === entry.key}
                                className={`text-xs font-medium underline disabled:opacity-50 ${isSynced ? 'text-gray-500 hover:text-gray-700' : 'text-primary-600 hover:text-primary-700'}`}
                              >
                                {syncingEntryKey === entry.key ? 'Syncing…' : isSynced ? 'Re-sync' : 'Sync now'}
                              </button>
                            )}
                          </div>
                          );
                        })()}
                        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                          <button
                            onClick={() => handleLoadMerged(entry)}
                            className="px-2.5 py-1 text-sm font-medium text-primary-600 bg-primary-50 rounded-md hover:bg-primary-100"
                          >
                            Load
                          </button>
                          <button
                            onClick={() => openRenameDialog(entry)}
                            className="px-2.5 py-1 text-sm font-medium text-gray-700 bg-gray-50 rounded-md hover:bg-gray-100"
                          >
                            Rename
                          </button>
                          <button
                            onClick={() => handleDownloadMerged(entry)}
                            className="px-2.5 py-1 text-sm font-medium text-gray-700 bg-gray-50 rounded-md hover:bg-gray-100"
                            title="Download this file to your device / share to another app"
                          >
                            Download
                          </button>
                          <button
                            onClick={() => handleDeleteMerged(entry)}
                            className="px-2.5 py-1 text-sm font-medium text-gray-700 bg-gray-50 rounded-md hover:bg-gray-100"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </li>
                    );
                  })}
                </ul>
              )}
            </div>
            <div className="flex gap-3 mt-4">
              <button
                onClick={handleBackupSelected}
                disabled={backingUp || selectedForBackup.size === 0}
                className="flex-1 py-2 text-base font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 disabled:opacity-50"
              >
                {backingUp ? 'Backing up…' : `Backup Selected${selectedForBackup.size ? ` (${selectedForBackup.size})` : ''}`}
              </button>
              <button onClick={() => setSavedFilesOpen(false)} className="flex-1 py-2 text-base font-medium text-gray-800 bg-white border border-gray-400 rounded-lg hover:bg-gray-50">
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {accountDialogOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40" onClick={closeAccountDialog}>
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full mx-4 relative" onClick={e => e.stopPropagation()}>
            <button
              onClick={closeAccountDialog}
              aria-label="Close"
              className="absolute top-4 right-4 w-6 h-6 flex items-center justify-center text-gray-600 hover:text-gray-700 text-lg leading-none"
            >
              ✕
            </button>
            {!cloudSyncEnabled ? (
              <>
                <h3 className="text-base font-semibold text-gray-900 mb-1 pr-6">Cloud Sync</h3>
                <p className="text-base text-gray-700">Cloud sync isn't configured for this build of the app.</p>
              </>
            ) : session ? (
              <>
                <h3 className="text-base font-semibold text-gray-900 mb-1 pr-6">Account</h3>
                <p className="text-base text-gray-700 mb-4">
                  Signed in as <span className="font-medium text-gray-800">{session.user.email}</span>. Files you save are synced privately to your account — reachable from any device you sign into, and not visible to anyone else.
                </p>
                {isAdmin && (
                  <button
                    onClick={() => { setAccountDialogOpen(false); openStaffPanel(); }}
                    className="w-full mb-2 py-2 text-base font-medium text-gray-800 bg-white border border-gray-400 rounded-lg hover:bg-gray-50"
                  >
                    Manage Staff Access
                  </button>
                )}
                <button
                  onClick={() => { setAccountDialogOpen(false); openSharePanel(); }}
                  className="w-full mb-2 py-2 text-base font-medium text-gray-800 bg-white border border-gray-400 rounded-lg hover:bg-gray-50"
                >
                  Share My Files
                </button>
                <button
                  onClick={handleSwitchAccount}
                  disabled={authSubmitting}
                  className="w-full mb-2 py-2 text-base font-medium text-gray-800 bg-white border border-gray-400 rounded-lg hover:bg-gray-50 disabled:opacity-50"
                >
                  Switch Account
                </button>
                <button onClick={handleSignOut} className="w-full py-2 text-base font-medium text-red-600 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100">
                  Sign Out
                </button>
              </>
            ) : (
              <>
                <h3 className="text-base font-semibold text-gray-900 mb-1 pr-6">Sign In to Sync</h3>
                <p className="text-base text-gray-700 mb-4">
                  Sign in with Google to sync your own files privately across devices. Only staff emails your admin has approved can sign in.
                </p>
                <button
                  onClick={handleGoogleSignIn}
                  disabled={authSubmitting}
                  className="w-full flex items-center justify-center gap-2 py-2 text-base font-medium text-gray-800 bg-white border border-gray-400 rounded-lg hover:bg-gray-50 disabled:opacity-50"
                >
                  <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
                    <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 8 3l5.7-5.7C34.6 6.1 29.6 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.7-.4-3.5z" />
                    <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 15.9 18.9 13 24 13c3.1 0 5.8 1.1 8 3l5.7-5.7C34.6 6.1 29.6 4 24 4c-7.4 0-13.7 4.2-16.9 10.4z" />
                    <path fill="#4CAF50" d="M24 44c5.5 0 10.4-2.1 14.1-5.5l-6.5-5.5C29.6 34.9 26.9 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.6 5.1C9.5 39.7 16.2 44 24 44z" />
                    <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.2 4.3-4.2 5.7l6.5 5.5C41.9 35.9 44 30.3 44 24c0-1.3-.1-2.7-.4-3.5z" />
                  </svg>
                  {authSubmitting ? 'Working…' : 'Continue with Google'}
                </button>
              </>
            )}
            <div className="mt-4 pt-4 border-t border-gray-300">
              <p className="text-sm text-gray-600 mb-2">
                Cloudflare Access checks your Google account before the app even loads — separate from the sign-in above. If it's stuck on the wrong account, log out of Access to pick a different one.
              </p>
              <a
                href="/cdn-cgi/access/logout"
                className="block w-full text-center py-2 text-base font-medium text-gray-800 bg-white border border-gray-400 rounded-lg hover:bg-gray-50"
              >
                Log Out of Cloudflare Access
              </a>
            </div>
          </div>
        </div>
      )}

      {staffPanelOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40" onClick={() => setStaffPanelOpen(false)}>
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full mx-4 max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-gray-900 mb-1">Staff Access</h3>
            <p className="text-base text-gray-700 mb-3">Only these emails can create an account and sync. Each person's saved files are private to them — this list controls who can sign in, not who can see whose data.</p>
            <div className="flex gap-2 mb-3">
              <input
                type="email"
                value={newStaffEmail}
                onChange={e => setNewStaffEmail(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleAddStaff(); }}
                placeholder="newstaff@example.com"
                className="flex-1 px-3 py-2 text-base border border-gray-400 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
              <button
                onClick={handleAddStaff}
                disabled={staffSubmitting || !newStaffEmail.trim()}
                className="px-3 py-2 text-base font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 disabled:opacity-50"
              >
                Add
              </button>
            </div>
            <div className="flex-1 overflow-y-auto -mx-2 px-2">
              {staffList.length === 0 ? (
                <p className="text-base text-gray-600 py-6 text-center">No staff yet.</p>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {staffList.map(s => (
                    <li key={s.email} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <p className="text-base font-medium text-gray-900 truncate">{s.email}</p>
                        {s.isAdmin && <p className="text-sm text-primary-600">Admin</p>}
                      </div>
                      {!s.isAdmin && (
                        <button
                          onClick={() => handleRemoveStaff(s.email)}
                          className="px-2.5 py-1 text-sm font-medium text-red-600 bg-red-50 rounded-md hover:bg-red-100 shrink-0"
                        >
                          Remove
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <button onClick={() => setStaffPanelOpen(false)} className="mt-4 w-full py-2 text-base font-medium text-gray-800 bg-white border border-gray-400 rounded-lg hover:bg-gray-50">
              Close
            </button>
          </div>
        </div>
      )}

      {sharePanelOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40" onClick={() => setSharePanelOpen(false)}>
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full mx-4 max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-gray-900 mb-1">Share My Files</h3>
            <p className="text-base text-gray-700 mb-3">Anyone you add here can view, edit, and delete all of your saved files — the same access you have. They must already be an approved user who can sign in. Remove them any time to cut off access immediately.</p>
            <div className="flex gap-2 mb-3">
              <input
                type="email"
                value={newShareEmail}
                onChange={e => setNewShareEmail(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleAddShare(); }}
                placeholder="colleague@example.com"
                className="flex-1 px-3 py-2 text-base border border-gray-400 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
              <button
                onClick={handleAddShare}
                disabled={shareSubmitting || !newShareEmail.trim()}
                className="px-3 py-2 text-base font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 disabled:opacity-50"
              >
                Share
              </button>
            </div>
            <div className="flex-1 overflow-y-auto -mx-2 px-2">
              {shareList.length === 0 ? (
                <p className="text-base text-gray-600 py-6 text-center">You haven't shared your files with anyone.</p>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {shareList.map(s => (
                    <li key={s.id} className="flex items-center justify-between gap-3 py-2.5">
                      <p className="text-base font-medium text-gray-900 truncate">{s.sharedWithEmail}</p>
                      <button
                        onClick={() => handleRemoveShare(s)}
                        className="px-2.5 py-1 text-sm font-medium text-red-600 bg-red-50 rounded-md hover:bg-red-100 shrink-0"
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <button onClick={() => setSharePanelOpen(false)} className="mt-4 w-full py-2 text-base font-medium text-gray-800 bg-white border border-gray-400 rounded-lg hover:bg-gray-50">
              Close
            </button>
          </div>
        </div>
      )}

      {isLocked && (
        <div className="bg-amber-50 border-b border-amber-200 text-amber-800 text-base px-4 py-2">
          <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-2">
            <span>
              🔒 Locked for editing — signed by <strong>{signedLabels.join(', ')}</strong>. Clear each of these signatures on the Report tab to make changes (everyone will need to sign again afterwards).
            </span>
            <button onClick={handleClearAllSignatures} className="text-sm font-semibold text-amber-900 underline hover:no-underline whitespace-nowrap">
              Clear All Signatures
            </button>
          </div>
        </div>
      )}

      <header className="bg-white border-b border-gray-300 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div className="min-w-0">
              <h1 className="text-xl font-bold text-gray-900">Property Inventory Handover</h1>
              <p className="text-sm text-gray-600 truncate max-w-[60vw] sm:max-w-sm" title={lastSavedName ? `${lastSavedName}.json` : undefined}>
                {lastSavedName ? `📄 ${lastSavedName}` : 'Unsaved — not yet saved'}
              </p>
            </div>

            {/* Desktop/tablet: full button row, unchanged. */}
            <div className="hidden sm:flex items-center gap-2">
              {cloudSyncEnabled && (
                <button
                  onClick={() => setAccountDialogOpen(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-base text-gray-700 bg-white border border-gray-400 rounded-lg hover:bg-gray-50 transition-colors"
                  title={session ? `Signed in as ${session.user.email}` : 'Sign in to sync your Saved Files across devices'}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${session ? 'bg-green-500' : 'bg-gray-300'}`} />
                  {session ? 'Account' : 'Sign In'}
                </button>
              )}
              {cloudSyncEnabled && session && (
                <button
                  onClick={() => { void syncAllToCloud(); }}
                  disabled={syncingToCloud}
                  className="px-3 py-1.5 text-base text-gray-700 bg-white border border-gray-400 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
                  title="Push every file saved on this device up to the cloud — saves themselves are always local-first and never wait on this"
                >
                  {syncingToCloud ? 'Syncing…' : '☁ Sync to Cloud'}
                </button>
              )}
              <div className="w-px h-6 bg-gray-300 mx-1" />
              <button
                onClick={openSavedFiles}
                className="px-3 py-1.5 text-base text-gray-700 bg-white border border-gray-400 rounded-lg hover:bg-gray-50 transition-colors"
                title="Browse and reload files you've saved before"
              >
                Saved Files
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="px-3 py-1.5 text-base text-gray-700 bg-white border border-gray-400 rounded-lg hover:bg-gray-50 transition-colors"
                title="Import one file, or select several at once to import them all"
              >
                Import File
              </button>
              <div className="w-px h-6 bg-gray-300 mx-1" />
              <button
                onClick={openSaveDialog}
                className="flex items-center gap-1.5 px-4 py-1.5 text-base font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 transition-colors shadow-sm"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Save Work
              </button>
              <button
                onClick={handleReset}
                className="px-3 py-1.5 text-base font-medium text-red-600 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 transition-colors"
                title="Clear all data on this property — rooms, items, keys, photos, and signatures"
              >
                Reset
              </button>
            </div>

            {/* Mobile: every header action collapses into a single menu. */}
            <div className="relative sm:hidden">
              <button
                onClick={() => setMenuOpen(o => !o)}
                aria-label="Open menu"
                aria-expanded={menuOpen}
                className="w-10 h-10 flex items-center justify-center text-gray-700 bg-white border border-gray-400 rounded-lg hover:bg-gray-50 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>

              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                  <div className="absolute right-0 top-full mt-2 w-56 bg-white border border-gray-300 rounded-lg shadow-lg z-50 py-1.5">
                    {cloudSyncEnabled && (
                      <button
                        onClick={() => { setMenuOpen(false); setAccountDialogOpen(true); }}
                        className="w-full flex items-center gap-1.5 text-left px-4 py-2.5 text-base text-gray-800 hover:bg-gray-50 transition-colors"
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${session ? 'bg-green-500' : 'bg-gray-300'}`} />
                        {session ? 'Account' : 'Sign In'}
                      </button>
                    )}
                    {cloudSyncEnabled && session && (
                      <button
                        onClick={() => { setMenuOpen(false); void syncAllToCloud(); }}
                        disabled={syncingToCloud}
                        className="w-full text-left px-4 py-2.5 text-base text-gray-800 hover:bg-gray-50 transition-colors disabled:opacity-50"
                      >
                        {syncingToCloud ? '☁ Syncing…' : '☁ Sync to Cloud'}
                      </button>
                    )}
                    <div className="my-1 border-t border-gray-300" />
                    <button
                      onClick={() => { setMenuOpen(false); openSavedFiles(); }}
                      className="w-full text-left px-4 py-2.5 text-base text-gray-800 hover:bg-gray-50 transition-colors"
                    >
                      Saved Files
                    </button>
                    <button
                      onClick={() => { setMenuOpen(false); fileInputRef.current?.click(); }}
                      className="w-full text-left px-4 py-2.5 text-base text-gray-800 hover:bg-gray-50 transition-colors"
                    >
                      Import File
                    </button>
                    <div className="my-1 border-t border-gray-300" />
                    <button
                      onClick={() => { setMenuOpen(false); openSaveDialog(); }}
                      className="w-full text-left px-4 py-2.5 text-base font-medium text-primary-700 hover:bg-primary-50 transition-colors"
                    >
                      Save Work
                    </button>
                    <div className="my-1 border-t border-gray-300" />
                    <button
                      onClick={() => { setMenuOpen(false); handleReset(); }}
                      className="w-full text-left px-4 py-2.5 text-base font-medium text-red-600 hover:bg-red-50 transition-colors"
                    >
                      Reset
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      <nav className="bg-white border-b border-gray-300">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex space-x-1 overflow-x-auto">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => onTabChange(tab.id)}
                className={`px-4 py-3 text-base font-medium whitespace-nowrap border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? 'border-primary-500 text-primary-600'
                    : 'border-transparent text-gray-700 hover:text-gray-800 hover:border-gray-400'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </nav>

      {/* Generous bottom padding (beyond the top's pt-6) so the last item in a long,
          expanded list — e.g. the last room's item form on the Rooms tab — has real
          breathing room to scroll clear of the viewport edge / mobile browser chrome
          instead of sitting tight against the bottom. */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 pb-48">
        {children}
      </main>
    </div>
  );
};
