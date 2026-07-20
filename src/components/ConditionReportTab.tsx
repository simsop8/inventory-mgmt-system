import React, { useRef, useState } from 'react';
import { useProperty } from '../store/PropertyContext';
import type { Photo } from '../types';
import { GENERAL_AREA_LABEL, OTHERS_AREA_LABEL } from '../types';
import { normalizeImageOrientation } from '../utils/image';
import { shareOrDownload, buildReportFilename, buildPropertyLabel } from '../utils/share';
import { buildConditionReportPDF } from '../utils/reports';
import { buildConditionReportExport, parseConditionReportImport, exchangeToPhotos } from '../utils/conditionReportExchange';
import { useDragReorder } from '../utils/dragReorder';

// Note: this tab is intentionally independent of the move-in inventory's lock/signature
// cycle (see isLocked in PropertyContext). Tenants get a warranty period after handover
// to report defects, so this log needs to stay editable indefinitely — signing the
// move-in inventory or the Takeover form never disables anything here.
export const ConditionReportTab: React.FC = () => {
  const { profile, addPhoto, addPhotos, updatePhoto, deletePhoto, reorderRoomTo } = useProperty();
  const fileRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const exchangeFileRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // Sorted explicitly by the Rooms tab's own `order` field, so this tab's grouping always
  // matches the Rooms tab's sequence regardless of how the underlying array happens to be
  // ordered. Only these (real Room entities) can be drag-reordered — Others/General/custom
  // areas below aren't rooms, so there's no "order" for them to slot into.
  const orderedRooms = [...profile.rooms].sort((a, b) => a.order - b.order);
  const roomAreaNames = orderedRooms.map(r => r.name);
  // Built-in areas + any custom area names already used on past photos (so a custom
  // area you typed once shows back up in the picker without retyping it).
  const builtInAreas = [...roomAreaNames, OTHERS_AREA_LABEL, GENERAL_AREA_LABEL];
  const usedCustomAreas = [...new Set(profile.photos.map(p => p.area || GENERAL_AREA_LABEL))].filter(a => !builtInAreas.includes(a));
  const areaOptions = [...builtInAreas, ...usedCustomAreas];
  // Non-room areas render after the rooms, in this fixed order, and aren't draggable.
  const extraAreas = [OTHERS_AREA_LABEL, GENERAL_AREA_LABEL, ...usedCustomAreas];

  // Persisted separately from the profile so a background/reload mid-capture (a known
  // iOS Safari quirk after using the native camera) restores the last-picked area
  // instead of silently falling back to the first room in the list.
  const CURRENT_AREA_KEY = 'condition-report-current-area';
  const [currentArea, setCurrentArea] = useState(() => {
    const saved = typeof window !== 'undefined' ? window.localStorage.getItem(CURRENT_AREA_KEY) : null;
    return saved || areaOptions[0] || GENERAL_AREA_LABEL;
  });
  const [addingCustomArea, setAddingCustomArea] = useState(false);
  const [customAreaInput, setCustomAreaInput] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [photosPerPage, setPhotosPerPage] = useState<2 | 4 | 6 | 8>(4);
  const [generating, setGenerating] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [preview, setPreview] = useState<{ url: string; filename: string; blob: Blob } | null>(null);
  // Which photos are checked for bulk delete — keyed by Photo.id, across all areas.
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<Set<string>>(new Set());
  // Which area sections are collapsed — keyed by area name. Areas start collapsed (every
  // area present at mount is seeded in here) so a long room list opens as a scannable
  // list of headers; a newly-added area afterwards defaults to expanded since it's new
  // and won't be in this initial set.
  const [collapsedAreas, setCollapsedAreas] = useState<Set<string>>(() => new Set(areaOptions));
  const toggleAreaCollapsed = (area: string) => {
    setCollapsedAreas(prev => {
      const next = new Set(prev);
      if (next.has(area)) next.delete(area);
      else next.add(area);
      return next;
    });
  };

  // Drag-to-reorder for room sections — same press-and-slide gesture as the Rooms tab,
  // committing straight to the shared room order (reorderRoomTo) so Rooms, Inventory
  // Report, and this tab always stay in sync.
  const { dragId, startDrag, getRowStyle } = useDragReorder(orderedRooms.length, reorderRoomTo);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 2500); };

  const togglePhotoSelection = (id: string) => {
    setSelectedPhotoIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAllPhotos = () => {
    setSelectedPhotoIds(prev =>
      prev.size === profile.photos.length ? new Set() : new Set(profile.photos.map(p => p.id))
    );
  };

  const deleteSelectedPhotos = () => {
    const count = selectedPhotoIds.size;
    if (!count) return;
    if (!confirm(`Delete ${count} selected photo${count === 1 ? '' : 's'}? This can't be undone.`)) return;
    selectedPhotoIds.forEach(id => deletePhoto(id));
    setSelectedPhotoIds(new Set());
    showToast(`Deleted ${count} photo${count === 1 ? '' : 's'}`);
  };

  // Bundles every selected photo into a single .zip (rather than firing off N separate
  // downloads, which browsers throttle/prompt on and which is a poor experience anyway).
  const downloadSelectedPhotos = async () => {
    const selected = profile.photos.filter(p => selectedPhotoIds.has(p.id));
    if (selected.length === 0) return;
    showToast(`Zipping ${selected.length} photo${selected.length === 1 ? '' : 's'}…`);
    const { default: JSZip } = await import('jszip');
    const zip = new JSZip();
    // Sequential per-area numbering (Powder Bathroom-01, -02, ...) guarantees unique
    // names within the zip without falling back to the photo's random internal ID.
    const areaCounts = new Map<string, number>();
    selected.forEach(photo => {
      const m = /^data:image\/(\w+);base64,(.*)$/.exec(photo.dataUrl);
      const ext = (m?.[1] || 'jpg').toLowerCase();
      const base64 = m?.[2] ?? photo.dataUrl.split(',')[1] ?? '';
      const area = photo.area || GENERAL_AREA_LABEL;
      const seq = (areaCounts.get(area) || 0) + 1;
      areaCounts.set(area, seq);
      const filename = buildReportFilename([area, `Photo ${seq}`], ext === 'jpeg' ? 'jpg' : ext);
      zip.file(filename, base64, { base64: true });
    });
    const blob = await zip.generateAsync({ type: 'blob' });
    await shareOrDownload(blob, `condition-photos-${new Date().toISOString().slice(0, 10)}.zip`, 'application/zip');
    showToast(`Downloaded ${selected.length} photo${selected.length === 1 ? '' : 's'} as a zip`);
  };

  // Cross-app exchange with "Report Anything Anywhere Anytime" (same photo-capture/PDF
  // architecture, separate app/storage). Export produces a JSON file that app can import,
  // and vice versa — see utils/conditionReportExchange.ts for the shared format.
  const handleExportConditionReport = async () => {
    if (profile.photos.length === 0) { showToast('No photos to export yet'); return; }
    const exchange = buildConditionReportExport(profile);
    const filename = buildReportFilename(['Condition Report Export', buildPropertyLabel(profile.details)], 'json');
    const blob = new Blob([JSON.stringify(exchange, null, 2)], { type: 'application/json' });
    const result = await shareOrDownload(blob, filename, 'application/json');
    if (result !== 'cancelled') showToast(result === 'shared' ? 'Check the destination you chose' : 'Exported');
  };

  const handleImportConditionReportChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const text = ev.target?.result as string;
      const exchange = parseConditionReportImport(text);
      if (!exchange) { showToast("Not a recognized Condition Report file"); return; }
      const photos = exchangeToPhotos(exchange);
      if (photos.length === 0) { showToast('Nothing to import — no photos in that file'); return; }
      addPhotos(photos);
      showToast(`Imported ${photos.length} photo${photos.length === 1 ? '' : 's'}`);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const pickArea = (val: string) => {
    setCurrentArea(val);
    if (typeof window !== 'undefined') window.localStorage.setItem(CURRENT_AREA_KEY, val);
  };
  const handleAreaSelectChange = (val: string) => {
    if (val === '__custom__') { setAddingCustomArea(true); setCustomAreaInput(''); }
    else { setAddingCustomArea(false); pickArea(val); }
  };
  const confirmCustomArea = () => {
    const name = customAreaInput.trim();
    if (!name) return;
    pickArea(name);
    setAddingCustomArea(false);
    setCustomAreaInput('');
  };

  // If the current (possibly just-typed) area isn't in the option list yet, show it anyway.
  const selectableAreas = [...new Set([...areaOptions, currentArea])];

  const processFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const area = currentArea;
    Array.from(files).forEach(file => {
      // Bakes iPhone/camera EXIF rotation into the pixels so the photo stays upright
      // everywhere (app + PDF), not just in contexts that happen to respect EXIF tags.
      normalizeImageOrientation(file).then(dataUrl => addPhoto({ dataUrl, area }));
    });
    if (fileRef.current) fileRef.current.value = '';
    if (camRef.current) camRef.current.value = '';
    showToast(`Added to ${area} — snap another, or switch area above`);
  };

  // Filename follows the same "area-sequence" convention as the zip download below —
  // no random photo ID, so what you get in your downloads folder actually reads as a
  // real name instead of "photo-a1b2c3d4.jpg".
  const handleDownload = (photo: Photo, area: string, indexInArea: number) => {
    const m = /^data:image\/(\w+);base64,/.exec(photo.dataUrl);
    const ext = (m?.[1] || 'jpg').toLowerCase();
    const filename = buildReportFilename([area, `Photo ${indexInArea + 1}`], ext === 'jpeg' ? 'jpg' : ext);
    const a = document.createElement('a');
    a.href = photo.dataUrl; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  };

  const generateConditionReportPDF = async () => {
    if (profile.photos.length === 0) { showToast('No photos to include yet'); return; }
    setGenerating(true);
    try {
      const result = await buildConditionReportPDF(profile, photosPerPage);
      if (!result) { showToast('No photos to include yet'); return; }
      const { blob, filename } = result;
      const url = URL.createObjectURL(blob);
      setPreview(prev => { if (prev) URL.revokeObjectURL(prev.url); return { url, filename, blob }; });
    } finally {
      setGenerating(false);
    }
  };

  const closePreview = () => {
    setPreview(prev => { if (prev) URL.revokeObjectURL(prev.url); return null; });
  };

  const downloadPreview = async () => {
    if (!preview) return;
    await shareOrDownload(preview.blob, preview.filename, 'application/pdf');
  };

  return (
    <div className="space-y-6">
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-gray-900 text-white text-base px-4 py-2 rounded-lg shadow-lg pointer-events-none">
          {toast}
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-blue-50 border border-blue-200 rounded-lg p-4">
        <p className="text-base text-blue-800">
          A running condition log, grouped by room — separate from the signed move-in inventory. Keep adding photos and notes any time, including during the tenant's warranty period after handover.
        </p>
        <button
          onClick={() => setAddMenuOpen(true)}
          className="shrink-0 flex items-center justify-center gap-2 px-4 py-2 text-base font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 transition-colors shadow-sm"
        >
          <span className="text-base leading-none">＋</span> Add Photo
        </button>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-3 bg-white rounded-lg shadow p-4">
        <div className="flex items-center gap-2">
          <label htmlFor="photos-per-page" className="text-base font-medium text-gray-800 whitespace-nowrap">Layout</label>
          <select
            id="photos-per-page"
            value={photosPerPage}
            onChange={e => setPhotosPerPage(Number(e.target.value) as 2 | 4 | 6 | 8)}
            className="border border-gray-400 rounded-md px-2.5 py-2 text-base focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            {([2, 4, 6, 8] as const).map(n => (
              <option key={n} value={n}>{n} photos per page</option>
            ))}
          </select>
        </div>
        <button
          onClick={generateConditionReportPDF}
          disabled={generating || profile.photos.length === 0}
          className="flex-1 flex items-center gap-2.5 px-4 py-2 bg-primary-50 rounded-lg hover:bg-primary-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <span className="text-xl">📄</span>
          <div className="text-left">
            <div className="font-semibold text-primary-700 text-base">{generating ? 'Generating…' : 'Preview Condition Report PDF'}</div>
            <div className="text-sm text-primary-500">Grouped by room — separate from the Report &amp; Takeover PDFs</div>
          </div>
        </button>
      </div>

      <div className="bg-white rounded-lg shadow p-4">
        <h3 className="text-base font-semibold text-gray-900 mb-1">Exchange with Report Anything Anywhere</h3>
        <p className="text-sm text-gray-700 mb-3">Move condition-report photos to or from the other app — useful if a photo shoot started there, or you want a copy here too.</p>
        <input
          ref={exchangeFileRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={handleImportConditionReportChange}
        />
        <div className="flex gap-2">
          <button
            onClick={() => { void handleExportConditionReport(); }}
            disabled={profile.photos.length === 0}
            className="flex-1 px-3 py-2 text-sm font-medium text-gray-800 bg-gray-100 rounded-md hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Export Photos
          </button>
          <button
            onClick={() => exchangeFileRef.current?.click()}
            className="flex-1 px-3 py-2 text-sm font-medium text-gray-800 bg-gray-100 rounded-md hover:bg-gray-200"
          >
            Import Photos
          </button>
        </div>
      </div>

      {profile.photos.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-8 text-center text-gray-600 text-base">No photos yet — tap "Add Photo" above to add your first one.</div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between bg-white rounded-lg shadow px-4 py-2.5">
            <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 cursor-pointer">
              <input type="checkbox" checked={selectedPhotoIds.size === profile.photos.length && selectedPhotoIds.size > 0} onChange={toggleSelectAllPhotos} />
              Select all
            </label>
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-600">{selectedPhotoIds.size} selected</span>
              <button
                onClick={() => { void downloadSelectedPhotos(); }}
                disabled={selectedPhotoIds.size === 0}
                className="px-3 py-1.5 text-sm font-medium text-gray-800 bg-gray-100 rounded-md hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Download Selected (.zip)
              </button>
              <button
                onClick={deleteSelectedPhotos}
                disabled={selectedPhotoIds.size === 0}
                className="px-3 py-1.5 text-sm font-medium text-red-600 bg-red-50 rounded-md hover:bg-red-100 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Delete Selected
              </button>
            </div>
          </div>
          {(() => {
            const renderAreaCard = (area: string, drag?: { roomId: string; index: number }) => {
              const areaPhotos = profile.photos.filter(p => (p.area || GENERAL_AREA_LABEL) === area);
              if (areaPhotos.length === 0) return null;
              const isCollapsed = collapsedAreas.has(area);
              return (
                <div
                  key={area}
                  ref={drag ? (el => { if (el) rowRefs.current.set(drag.roomId, el); else rowRefs.current.delete(drag.roomId); }) : undefined}
                  className="bg-white rounded-lg shadow overflow-hidden"
                  style={drag ? getRowStyle(drag.roomId, drag.index) : undefined}
                >
                  <div className="flex items-center gap-1 px-2 py-2 bg-gray-50 border-b border-gray-300">
                    {drag && (
                      <button
                        type="button"
                        onPointerDown={e => {
                          setCollapsedAreas(new Set(areaOptions)); // collapse everyone first so every row shares one height during the drag
                          startDrag(e, drag.roomId, drag.index, rowRefs.current.get(drag.roomId) || null);
                        }}
                        className={`w-8 h-8 flex-shrink-0 flex items-center justify-center text-gray-500 hover:text-gray-700 hover:bg-gray-200 rounded touch-none ${dragId === drag.roomId ? 'cursor-grabbing text-primary-600 bg-gray-200' : 'cursor-grab'}`}
                        title="Press and drag to reorder"
                        aria-label="Drag to reorder room"
                      >
                        <span className="text-xl leading-none select-none">⠿</span>
                      </button>
                    )}
                    <button
                      onClick={() => toggleAreaCollapsed(area)}
                      aria-expanded={!isCollapsed}
                      className="flex-1 flex items-center gap-2 px-2 py-1 hover:bg-gray-100 rounded transition-colors text-left"
                    >
                      <span className="text-gray-500 text-sm shrink-0">{isCollapsed ? '▶' : '▼'}</span>
                      <span className="font-semibold text-gray-900">{area}</span>
                      <span className="text-sm text-gray-600 bg-gray-200 px-2 py-0.5 rounded-full">{areaPhotos.length} photo{areaPhotos.length !== 1 ? 's' : ''}</span>
                    </button>
                  </div>
                  {!isCollapsed && (
                  <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {areaPhotos.map((photo, photoIdx) => (
                      <div key={photo.id} className={`border rounded-lg overflow-hidden ${selectedPhotoIds.has(photo.id) ? 'border-primary-400 ring-2 ring-primary-200' : 'border-gray-300'}`}>
                        {/* object-contain (not cover) so tall screenshots/portrait photos show in full
                            instead of having their top/bottom cropped off to fill a fixed 16:9 box. */}
                        <div className="relative aspect-video bg-gray-100">
                          <img src={photo.dataUrl} alt={photo.caption || area} className="w-full h-full object-contain" />
                          <label className="absolute top-2 left-2 flex items-center justify-center w-6 h-6 bg-white/90 rounded shadow cursor-pointer">
                            <input type="checkbox" checked={selectedPhotoIds.has(photo.id)} onChange={() => togglePhotoSelection(photo.id)} />
                          </label>
                        </div>
                        <div className="p-2.5 space-y-2">
                          <select
                            value={area}
                            onChange={e => updatePhoto(photo.id, { area: e.target.value })}
                            className="w-full border border-gray-300 rounded px-2 py-1 text-sm bg-gray-50 focus:outline-none focus:ring-1 focus:ring-primary-500"
                          >
                            {[...new Set([...areaOptions, area])].map(a => <option key={a} value={a}>{a}</option>)}
                          </select>
                          <textarea
                            value={photo.caption || ''}
                            onChange={e => updatePhoto(photo.id, { caption: e.target.value })}
                            placeholder="Remarks — e.g. scratch on wall, working condition..."
                            rows={2}
                            className="w-full border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary-500 resize-y"
                          />
                          <p className="text-sm text-gray-600">{new Date(photo.dateAdded).toLocaleString()}</p>
                          <div className="flex gap-2">
                            <button onClick={() => handleDownload(photo, area, photoIdx)} className="flex-1 text-sm px-2 py-1 text-gray-700 bg-gray-100 rounded hover:bg-gray-200">Download</button>
                            <button onClick={() => { if (confirm('Delete this photo?')) deletePhoto(photo.id); }} className="flex-1 text-sm px-2 py-1 text-red-600 bg-red-50 rounded hover:bg-red-100">Delete</button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  )}
                </div>
              );
            };
            return (
              <>
                {orderedRooms.map((room, ri) => renderAreaCard(room.name, { roomId: room.id, index: ri }))}
                {extraAreas.map(area => renderAreaCard(area))}
              </>
            );
          })()}
        </div>
      )}

      {/* Floating "Add Photo" button — mobile only (thumb-reachable corner FAB). On
          desktop the same action lives in the header button above, which is always
          in view without needing a floating overlay. */}
      <button
        onClick={() => setAddMenuOpen(true)}
        aria-label="Add a photo"
        className="fixed bottom-5 left-5 z-40 w-14 h-14 rounded-full bg-gray-900 text-white shadow-lg flex items-center justify-center text-2xl hover:bg-gray-800 active:scale-95 transition-transform sm:hidden"
      >
        ☰
      </button>

      {/* Add Photo dialog — bottom sheet on mobile, centered modal on desktop.
          mx-4 + items-center on sm+ keeps it fully on-screen and away from the
          viewport edge at any window width, instead of the old edge-anchored sheet. */}
      {addMenuOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setAddMenuOpen(false)} />
          <div className="relative w-full sm:max-w-md sm:mx-4 bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl p-4 pb-6 sm:pb-4 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold text-gray-900">Add a Photo</h2>
              <button onClick={() => setAddMenuOpen(false)} aria-label="Close" className="w-8 h-8 flex items-center justify-center text-gray-600 hover:text-gray-700 text-xl leading-none">✕</button>
            </div>
            <div className="mb-3">
              <label className="block text-base font-medium text-gray-800 mb-1">Current Area</label>
              <select
                value={addingCustomArea ? '__custom__' : currentArea}
                onChange={e => handleAreaSelectChange(e.target.value)}
                className="w-full border border-gray-400 rounded-md px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                {selectableAreas.map(a => <option key={a} value={a}>{a}</option>)}
                <option value="__custom__">+ Add custom area…</option>
              </select>
              {addingCustomArea && (
                <div className="flex gap-2 mt-2">
                  <input
                    autoFocus
                    type="text"
                    value={customAreaInput}
                    onChange={e => setCustomAreaInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') confirmCustomArea(); if (e.key === 'Escape') setAddingCustomArea(false); }}
                    placeholder="e.g. Main Door, Aircon Remote, Store Room"
                    className="flex-1 border border-gray-400 rounded-md px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                  <button onClick={confirmCustomArea} disabled={!customAreaInput.trim()} className="px-3 py-2 text-base font-medium text-white bg-primary-600 rounded-md hover:bg-primary-700 disabled:opacity-40">Use</button>
                </div>
              )}
              <p className="text-sm text-gray-600 mt-1">Photos you take go into this area. Switch it any time to move on to the next room — or add your own (e.g. "Others" for keys/remotes, or a custom name).</p>
            </div>
            <div className="flex flex-col sm:flex-row gap-3">
              <label className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-primary-50 text-primary-700 rounded-lg border-2 border-dashed border-primary-200 cursor-pointer hover:bg-primary-100 transition-colors">
                <span className="text-xl">🖼️</span><span className="font-medium text-base">Choose from Library</span>
                <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={e => processFiles(e.target.files)} />
              </label>
              <label className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-green-50 text-green-700 rounded-lg border-2 border-dashed border-green-200 cursor-pointer hover:bg-green-100 transition-colors">
                <span className="text-xl">📷</span><span className="font-medium text-base">Take a Photo</span>
                <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={e => processFiles(e.target.files)} />
              </label>
            </div>
            <p className="text-sm text-gray-600 mt-2">Snap, then keep tapping "Take a Photo" again to add more to the same area — close this sheet whenever you're done.</p>
          </div>
        </div>
      )}

      {/* PDF preview modal */}
      {preview && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/60">
          <div className="bg-white px-4 py-3 shadow">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-gray-900 text-base truncate">Condition Report Preview</span>
              <div className="flex items-center gap-2 shrink-0">
                <button onClick={downloadPreview} className="px-3 py-1.5 text-base font-medium text-white bg-primary-600 rounded-md hover:bg-primary-700">Download / Share</button>
                <button onClick={closePreview} aria-label="Close preview" className="w-8 h-8 flex items-center justify-center text-gray-600 hover:text-gray-700 text-xl leading-none">✕</button>
              </div>
            </div>
            <p className="text-sm text-gray-600 mt-1">If the preview doesn't display on your device, tap Download / Share to open it directly.</p>
          </div>
          <iframe title="Condition Report Preview" src={preview.url} className="flex-1 w-full bg-gray-100" />
        </div>
      )}
    </div>
  );
};
