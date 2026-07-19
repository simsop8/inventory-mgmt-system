import React, { useRef, useState } from 'react';
import { useProperty } from '../store/PropertyContext';
import { SigField } from './SigField';
import { shareOrDownload } from '../utils/share';
import { useDragReorder } from '../utils/dragReorder';
import { buildInventoryReportPDF } from '../utils/reports';
import { agentLabel } from '../types';

export const ReportGenerator: React.FC = () => {
  const { profile, isLocked, addSignature, deleteSignature, reorderRoomTo, updateItem, updateKey } = useProperty();
  const roomSeqRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const { dragId: roomSeqDragId, startDrag: startRoomSeqDrag, getRowStyle: getRoomSeqRowStyle } = useDragReorder(profile.rooms.length, reorderRoomTo);
  const [generating, setGenerating] = useState(false);
  const [preview, setPreview] = useState<{ url: string; filename: string; blob: Blob } | null>(null);

  const agents = profile.details.agents || [];

  const sigRoles = [
    ...profile.details.landlords.map((l, i) => ({
      role: `landlord_${i}`,
      label: profile.details.landlords.length > 1 ? `Landlord ${i + 1}` : 'Landlord',
      defaultName: l.name,
    })),
    ...profile.details.tenants.map((t, i) => ({
      role: `tenant_${i}`,
      label: profile.details.tenants.length > 1 ? `Tenant ${i + 1}` : 'Tenant',
      defaultName: t.name,
    })),
    ...agents.map((a, i) => ({
      role: `agent_${i}`,
      label: agentLabel(a, i, agents.length),
      defaultName: a.name || '',
    })),
  ];

  // Generates the PDF into an in-app preview first — rather than immediately opening a
  // share sheet / new tab — so there's a deliberate review step before anything leaves
  // the app on iPhone/iPad (or anywhere else). The preview's own "Download / Share"
  // button is what actually hands the file off, at the user's choice.
  const generatePDF = async () => {
    setGenerating(true);
    try {
      const { blob, filename } = await buildInventoryReportPDF(profile);
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
      <div className="bg-white rounded-lg shadow p-4">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Report Summary</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { l: 'Rooms', v: profile.rooms.length },
            { l: 'Items', v: profile.rooms.reduce((s, r) => s + r.items.length, 0) },
            { l: 'Keys / Access', v: profile.keys.length },
            { l: 'Signatures', v: `${profile.signatures.length}/${sigRoles.length}` },
          ].map(s => (
            <div key={s.l} className="text-center p-3 bg-gray-50 rounded-lg">
              <div className="text-2xl font-bold text-primary-600">{s.v}</div>
              <div className="text-sm text-gray-700">{s.l}</div>
            </div>
          ))}
        </div>
      </div>

      <fieldset disabled={isLocked} className="contents m-0 p-0 border-0 min-w-0">
      {profile.rooms.length > 1 && (
        <div className="bg-white rounded-lg shadow p-4">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Room Sequence in Report</h2>
          <p className="text-base text-gray-700 mb-2">Press the grip and slide a room up or down to reorder.</p>
          <div className="space-y-2">
            {profile.rooms.map((room, idx) => (
              <div
                key={room.id}
                ref={el => { if (el) roomSeqRefs.current.set(room.id, el); else roomSeqRefs.current.delete(room.id); }}
                className="flex items-center gap-3 p-2.5 bg-gray-50 border border-gray-300 rounded-lg"
                style={getRoomSeqRowStyle(room.id, idx)}
              >
                <span className="w-6 h-6 rounded-full bg-primary-100 text-primary-700 text-sm font-bold flex items-center justify-center flex-shrink-0">{idx + 1}</span>
                <span className="flex-1 text-base font-medium text-gray-900">{room.name}</span>
                <button
                  type="button"
                  onPointerDown={e => startRoomSeqDrag(e, room.id, idx, roomSeqRefs.current.get(room.id) || null)}
                  className={`w-8 h-8 flex-shrink-0 flex items-center justify-center rounded bg-white border border-gray-400 text-gray-700 hover:bg-gray-100 touch-none ${roomSeqDragId === room.id ? 'cursor-grabbing text-primary-600' : 'cursor-grab'}`}
                  title="Press and drag to reorder"
                  aria-label="Drag to reorder room"
                >
                  <span className="text-lg leading-none select-none">⠿</span>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {profile.rooms.length > 0 && (
        <div className="bg-white rounded-lg shadow p-4">
          <h2 className="text-lg font-semibold text-gray-900 mb-2">Inventory Review</h2>
          <div className="space-y-4">
            {profile.rooms.map(room => (
              <div key={room.id}>
                <h3 className="font-semibold text-sm text-gray-700 uppercase tracking-wide mb-2">{room.name}</h3>
                {room.items.length === 0 ? <p className="text-sm text-gray-600 pl-2">No items.</p> : (
                  <div className="overflow-x-auto rounded border border-gray-300">
                    <table className="w-full text-sm">
                      <thead><tr className="bg-slate-700 text-white">
                        <th className="text-left px-3 py-2 w-8">#</th>
                        <th className="text-left px-3 py-2">Item</th>
                        <th className="text-left px-3 py-2 w-36">Brand / Model</th>
                        <th className="text-left px-3 py-2 w-16">Qty</th>
                        <th className="text-left px-3 py-2">Remarks</th>
                      </tr></thead>
                      <tbody>{room.items.map((item, ii) => (
                        <tr key={item.id} className={ii % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                          <td className="px-3 py-1.5 text-gray-600">{ii + 1}</td>
                          <td className="px-3 py-1.5 font-medium text-gray-800">{item.name}</td>
                          <td className="px-1 py-1"><input type="text" value={item.brandModel || ''} onChange={e => updateItem(room.id, item.id, { brandModel: e.target.value })} placeholder="—" className="w-full border border-transparent hover:border-gray-300 focus:border-primary-400 rounded px-2 py-0.5 text-sm focus:outline-none bg-transparent focus:bg-white" /></td>
                          <td className="px-1 py-1"><input type="text" inputMode="numeric"
                            value={item.quantity !== undefined && item.quantity !== null ? String(item.quantity) : ''}
                            onChange={e => { const v = e.target.value; if (v === '') updateItem(room.id, item.id, { quantity: undefined }); else { const n = parseInt(v); if (!isNaN(n) && n >= 0) updateItem(room.id, item.id, { quantity: n }); } }}
                            placeholder="—" className="w-full border border-transparent hover:border-gray-300 focus:border-primary-400 rounded px-2 py-0.5 text-sm text-center focus:outline-none bg-transparent focus:bg-white" /></td>
                          <td className="px-1 py-1"><input type="text" value={item.remarks || ''} onChange={e => updateItem(room.id, item.id, { remarks: e.target.value })} placeholder="—" className="w-full border border-transparent hover:border-gray-300 focus:border-primary-400 rounded px-2 py-0.5 text-sm focus:outline-none bg-transparent focus:bg-white" /></td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Keys & Access review */}
      {profile.keys.length > 0 && (
        <div className="bg-white rounded-lg shadow p-4">
          <h2 className="text-lg font-semibold text-gray-900 mb-2">Keys & Access Review</h2>
          <div className="space-y-4">
            {(['keys', 'access_cards', 'remote_controls', 'others', 'meter_readings'] as const)
              .filter(sec => profile.keys.some(k => k.section === sec))
              .map(sec => {
                const items = profile.keys.filter(k => k.section === sec);
                const sectionLabels: Record<string, string> = {
                  keys: 'Keys', access_cards: 'Access Cards',
                  remote_controls: 'Remote Controls & Fobs',
                  others: 'Others', meter_readings: 'Meter Readings',
                };
                const isMeter = sec === 'meter_readings';
                return (
                  <div key={sec}>
                    <h3 className="font-semibold text-sm text-gray-700 uppercase tracking-wide mb-2">{sectionLabels[sec]}</h3>
                    <div className="overflow-x-auto rounded border border-gray-300">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-slate-700 text-white">
                            <th className="text-left px-3 py-2">Description</th>
                            {sec === 'access_cards' && <th className="text-left px-3 py-2 w-28">Reference</th>}
                            {isMeter ? (
                              <>
                                <th className="text-left px-3 py-2 w-28">Reading</th>
                                <th className="text-left px-3 py-2 w-28">Date</th>
                              </>
                            ) : (
                              <>
                                <th className="text-left px-3 py-2 w-16">Qty</th>
                                <th className="text-left px-3 py-2">Remarks</th>
                              </>
                            )}
                          </tr>
                        </thead>
                        <tbody>
                          {items.map((item, ii) => (
                            <tr key={item.id} className={ii % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                              <td className="px-3 py-1.5 font-medium text-gray-800">{item.description}</td>
                              {sec === 'access_cards' && (
                                <td className="px-1 py-1">
                                  <input type="text" value={item.reference || ''} onChange={e => updateKey(item.id, { reference: e.target.value })} placeholder="—" className="w-full border border-transparent hover:border-gray-300 focus:border-primary-400 rounded px-2 py-0.5 text-sm focus:outline-none bg-transparent focus:bg-white" />
                                </td>
                              )}
                              {isMeter ? (
                                <>
                                  <td className="px-1 py-1">
                                    <input type="text" value={item.reading || ''} onChange={e => updateKey(item.id, { reading: e.target.value })} placeholder="—" className="w-full border border-transparent hover:border-gray-300 focus:border-primary-400 rounded px-2 py-0.5 text-sm focus:outline-none bg-transparent focus:bg-white" />
                                  </td>
                                  <td className="px-1 py-1">
                                    <input type="date" value={item.readingDate || ''} onChange={e => updateKey(item.id, { readingDate: e.target.value })} className="w-full border border-transparent hover:border-gray-300 focus:border-primary-400 rounded px-2 py-0.5 text-sm focus:outline-none bg-transparent focus:bg-white" />
                                  </td>
                                </>
                              ) : (
                                <>
                                  <td className="px-1 py-1">
                                    <input type="text" inputMode="numeric" value={item.quantity !== undefined && item.quantity !== null ? String(item.quantity) : ''} onChange={e => { const v = e.target.value; if (v === '') updateKey(item.id, { quantity: undefined }); else { const n = parseInt(v); if (!isNaN(n) && n >= 0) updateKey(item.id, { quantity: n }); } }} placeholder="—" className="w-full border border-transparent hover:border-gray-300 focus:border-primary-400 rounded px-2 py-0.5 text-sm text-center focus:outline-none bg-transparent focus:bg-white" />
                                  </td>
                                  <td className="px-1 py-1">
                                    <input type="text" value={item.remarks || ''} onChange={e => updateKey(item.id, { remarks: e.target.value })} placeholder="—" className="w-full border border-transparent hover:border-gray-300 focus:border-primary-400 rounded px-2 py-0.5 text-sm focus:outline-none bg-transparent focus:bg-white" />
                                  </td>
                                </>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}
      </fieldset>

      <div className="bg-white rounded-lg shadow p-4">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">Signatures</h2>
        <p className="text-base text-gray-700 mb-4">Each party gets their own pad. The date defaults to the handover date and can be edited. Add more parties on the Property tab.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          {sigRoles.map(({ role, label, defaultName }) => (
            <SigField
              key={role}
              role={role}
              label={label}
              defaultName={defaultName}
              defaultDate={profile.details.handoverDate || undefined}
              existing={profile.signatures.find(s => s.role === role)}
              onSave={addSignature}
              onClear={() => { const s = profile.signatures.find(sig => sig.role === role); if (s) deleteSignature(s.id); }}
            />
          ))}
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-4">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Generate Report</h2>
        <p className="text-sm text-gray-600 mb-3">To save or load this property's data, use "Save Work" / "Import File" / "Saved Files" at the top of the page. To clear everything and start over, use "Reset" at the top of the page.</p>
        <button onClick={() => { void generatePDF(); }} disabled={generating} className="flex items-center gap-3 p-4 bg-primary-50 rounded-lg hover:bg-primary-100 transition-colors text-left w-full sm:w-auto sm:min-w-[280px] disabled:opacity-50 disabled:cursor-not-allowed">
          <span className="text-2xl">📄</span>
          <div>
            <div className="font-semibold text-primary-700 text-base">{generating ? 'Generating…' : 'Preview PDF Report'}</div>
            <div className="text-sm text-primary-500">Printer-friendly A4 — signatures on every page</div>
          </div>
        </button>
      </div>

      {preview && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/60">
          <div className="bg-white px-4 py-3 shadow">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-gray-900 text-base truncate">Inventory Report Preview</span>
              <div className="flex items-center gap-2 shrink-0">
                <button onClick={() => { void downloadPreview(); }} className="px-3 py-1.5 text-base font-medium text-white bg-primary-600 rounded-md hover:bg-primary-700">Download / Share</button>
                <button onClick={closePreview} aria-label="Close preview" className="w-8 h-8 flex items-center justify-center text-gray-600 hover:text-gray-700 text-xl leading-none">✕</button>
              </div>
            </div>
            <p className="text-sm text-gray-600 mt-1">If the preview doesn't display on your device, tap Download / Share to open it directly.</p>
          </div>
          <iframe title="Inventory Report Preview" src={preview.url} className="flex-1 w-full bg-gray-100" />
        </div>
      )}
    </div>
  );
};
