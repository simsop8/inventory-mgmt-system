import React, { useRef, useState, useEffect } from 'react';
import type { Signature } from '../types';
import { fd, todayISO } from '../utils/date';
import SignaturePad from 'signature_pad';

const inputCls = 'w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500';

// A single party's signature pad — used on both the move-in Report and the
// end-of-tenancy Takeover form. Locks itself once saved; Clear unlocks it again.
export const SigField: React.FC<{
  role: string;
  label: string;
  defaultName: string;
  defaultDate?: string;
  existing?: Signature;
  onSave: (s: Omit<Signature, 'id'>) => void;
  onClear: () => void;
}> = ({ role, label, defaultName, defaultDate, existing, onSave, onClear }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const padRef = useRef<SignaturePad | null>(null);
  const [name, setName] = useState(existing?.name || defaultName);
  const [sigDate, setSigDate] = useState(
    existing?.date ? existing.date.split('T')[0] : (defaultDate || todayISO())
  );
  const [locked, setLocked] = useState(!!existing);
  const lockedRef = useRef(!!existing); // mirrors `locked` for use inside stable callbacks (ResizeObserver)
  const prevDefaultName = useRef(defaultName);

  // Fix 1: proper canvas DPI scaling + ResizeObserver + cleanup on unmount
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const setupCanvas = () => {
      const ratio = window.devicePixelRatio || 1;
      const w = canvas.offsetWidth || 350;
      const h = canvas.offsetHeight || 100;
      canvas.width = w * ratio;
      canvas.height = h * ratio;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.scale(ratio, ratio);
        ctx.fillStyle = 'rgb(255,255,255)';
        ctx.fillRect(0, 0, w, h);
      }
    };

    setupCanvas();
    padRef.current = new SignaturePad(canvas, { backgroundColor: 'rgb(255,255,255)' });
    if (existing?.signatureDataUrl) {
      padRef.current.fromDataURL(existing.signatureDataUrl);
      padRef.current.off(); // already signed — start locked
    }

    // Re-scale on container resize (e.g. mobile orientation change)
    const ro = new ResizeObserver(() => {
      const data = padRef.current && !padRef.current.isEmpty() ? padRef.current.toDataURL() : null;
      setupCanvas();
      padRef.current?.clear();
      if (data) padRef.current?.fromDataURL(data);
      if (lockedRef.current) padRef.current?.off();
    });
    ro.observe(canvas);

    return () => {
      ro.disconnect();
      padRef.current?.off();
      padRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Fix 2: sync name when defaultName changes (e.g. landlord name edited after SigField mounts)
  useEffect(() => {
    if (locked) return;
    if (name === prevDefaultName.current || !name) setName(defaultName);
    prevDefaultName.current = defaultName;
  }, [defaultName]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (defaultDate && !existing) setSigDate(defaultDate); }, [defaultDate]); // eslint-disable-line react-hooks/exhaustive-deps

  // If the signature was cleared from outside this pad (e.g. the "Clear All Signatures"
  // banner button), reset this pad to match — otherwise it'd stay stuck looking locked.
  const prevExisting = useRef(existing);
  useEffect(() => {
    if (prevExisting.current && !existing) {
      padRef.current?.clear();
      padRef.current?.on();
      lockedRef.current = false;
      setLocked(false);
      setName(defaultName);
      setSigDate(defaultDate || todayISO());
    }
    prevExisting.current = existing;
  }, [existing]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = () => {
    if (!padRef.current || padRef.current.isEmpty()) { alert('Please provide a signature.'); return; }
    if (!name.trim()) { alert('Please enter a name.'); return; }
    onSave({ role, name: name.trim(), signatureDataUrl: padRef.current.toDataURL(), date: sigDate });
    // Keep the drawn signature visible, but lock the pad so it can't be signed over accidentally.
    padRef.current.off();
    lockedRef.current = true;
    setLocked(true);
  };

  const handleClear = () => {
    padRef.current?.clear();
    padRef.current?.on();
    lockedRef.current = false;
    setLocked(false);
    onClear();
    setName(defaultName);
    setSigDate(defaultDate || todayISO());
  };

  return (
    <div className="bg-white rounded-lg shadow p-4">
      <h3 className="font-medium text-gray-900 mb-3 text-sm">{label}</h3>
      <div className="mb-2">
        <label className="block text-xs font-medium text-gray-600 mb-1">Name</label>
        <input type="text" value={name} onChange={e => setName(e.target.value)} disabled={locked} className={`${inputCls} disabled:bg-gray-100 disabled:text-gray-500`} />
      </div>
      <div className="mb-2">
        <label className="block text-xs font-medium text-gray-600 mb-1">
          Signature {locked && <span className="font-normal text-gray-400">(locked — press Clear to re-sign)</span>}
        </label>
        <canvas
          ref={canvasRef}
          width={350}
          height={100}
          className={`w-full border rounded bg-white touch-none ${locked ? 'border-gray-200 cursor-not-allowed bg-gray-50' : 'border-gray-300 cursor-crosshair'}`}
        />
      </div>
      <div className="mb-3">
        <label className="block text-xs font-medium text-gray-600 mb-1">
          Date <span className="font-normal text-gray-400">(defaults to handover date)</span>
        </label>
        <input type="date" value={sigDate} onChange={e => setSigDate(e.target.value)} disabled={locked} className={`${inputCls} disabled:bg-gray-100 disabled:text-gray-500`} />
      </div>
      <div className="flex gap-2">
        {!locked && (
          <button onClick={handleSave} className="flex-1 px-3 py-1.5 text-xs font-medium text-white bg-primary-600 rounded hover:bg-primary-700">Save</button>
        )}
        <button onClick={handleClear} className={locked ? 'flex-1 px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50' : 'px-3 py-1.5 text-xs text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50'}>
          Clear
        </button>
      </div>
      {existing && (
        <div className="mt-2 p-2 bg-green-50 rounded text-xs text-green-700">
          🔒 Signed by {existing.name} · {fd(existing.date)}
        </div>
      )}
    </div>
  );
};
