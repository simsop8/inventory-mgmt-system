import React, { useRef, useState, useEffect } from 'react';
import type { Signature } from '../types';
import { fd, todayISO } from '../utils/date';
import SignaturePad from 'signature_pad';

const inputCls = 'w-full border border-gray-400 rounded-md px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-primary-500';

type Mode = 'collapsed' | 'signing' | 'signed';

// A single party's signature pad — used on both the move-in Report and the
// end-of-tenancy Takeover form.
//
// Three states:
//  - collapsed: nothing signed yet, pad hidden — just a "Sign" button so the
//    page isn't cluttered with a live drawing pad for every party up front.
//  - signing: the pad (name/date/canvas) is open for input, entered by
//    pressing "Sign".
//  - signed: locked, showing a static image of the captured signature (not
//    a live canvas) so it reads as a permanent record. "Clear" re-opens it.
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
  const [mode, setMode] = useState<Mode>(existing ? 'signed' : 'collapsed');
  const [name, setName] = useState(existing?.name || defaultName);
  const [sigDate, setSigDate] = useState(
    existing?.date ? existing.date.split('T')[0] : (defaultDate || todayISO())
  );
  const prevDefaultName = useRef(defaultName);

  // Canvas + SignaturePad are only mounted while actively signing — this is
  // what keeps the pad off-screen until the user presses "Sign".
  useEffect(() => {
    if (mode !== 'signing') return;
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

    // Re-scale on container resize (e.g. mobile orientation change)
    const ro = new ResizeObserver(() => {
      const data = padRef.current && !padRef.current.isEmpty() ? padRef.current.toDataURL() : null;
      setupCanvas();
      padRef.current?.clear();
      if (data) padRef.current?.fromDataURL(data);
    });
    ro.observe(canvas);

    return () => {
      ro.disconnect();
      padRef.current = null;
    };
  }, [mode]);

  // Sync name when defaultName changes (e.g. landlord name edited elsewhere), but only
  // while nothing has been signed/typed yet.
  useEffect(() => {
    if (mode === 'signed') return;
    if (name === prevDefaultName.current || !name) setName(defaultName);
    prevDefaultName.current = defaultName;
  }, [defaultName]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (defaultDate && !existing) setSigDate(defaultDate); }, [defaultDate]); // eslint-disable-line react-hooks/exhaustive-deps

  // If the signature was cleared from outside this pad (e.g. the "Clear All Signatures"
  // banner button), reset this pad to match — otherwise it'd stay stuck looking signed.
  const prevExisting = useRef(existing);
  useEffect(() => {
    if (prevExisting.current && !existing) {
      setMode('collapsed');
      setName(defaultName);
      setSigDate(defaultDate || todayISO());
    }
    prevExisting.current = existing;
  }, [existing]); // eslint-disable-line react-hooks/exhaustive-deps

  const startSigning = () => setMode('signing');

  const cancelSigning = () => {
    setMode('collapsed');
    setName(defaultName);
    setSigDate(defaultDate || todayISO());
  };

  const handleSave = () => {
    if (!padRef.current || padRef.current.isEmpty()) { alert('Please provide a signature.'); return; }
    if (!name.trim()) { alert('Please enter a name.'); return; }
    onSave({ role, name: name.trim(), signatureDataUrl: padRef.current.toDataURL(), date: sigDate });
    // The saved signature now renders as a static preview — the live pad is unmounted.
    setMode('signed');
  };

  const handleClear = () => {
    onClear();
    setMode('collapsed');
    setName(defaultName);
    setSigDate(defaultDate || todayISO());
  };

  // ── Collapsed: nothing signed yet, pad hidden ───────────────────────────
  if (mode === 'collapsed') {
    return (
      <div className="bg-white rounded-lg shadow p-4 flex items-center justify-between gap-3">
        <h3 className="font-semibold text-gray-900 text-base">{label}</h3>
        <button onClick={startSigning} className="px-4 py-2 text-sm font-semibold text-white bg-primary-600 rounded-md hover:bg-primary-700 flex-shrink-0">
          ✍️ Sign
        </button>
      </div>
    );
  }

  // ── Signed: static preview of the captured signature ───────────────────
  if (mode === 'signed') {
    return (
      <div className="bg-white rounded-lg shadow p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold text-gray-900 text-base">{label}</h3>
          <button onClick={handleClear} className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-400 rounded hover:bg-gray-100">
            Clear
          </button>
        </div>
        <div className="border border-gray-300 rounded bg-white p-2">
          {existing && <img src={existing.signatureDataUrl} alt={`${name}'s signature`} className="w-full h-24 object-contain" />}
        </div>
        <div className="mt-2 p-2 bg-green-50 border border-green-200 rounded text-sm text-green-800 font-medium">
          🔒 Signed by {existing?.name || name} · {fd(existing?.date || sigDate)}
        </div>
      </div>
    );
  }

  // ── Signing: pad open for input ─────────────────────────────────────────
  return (
    <div className="bg-white rounded-lg shadow p-4">
      <h3 className="font-semibold text-gray-900 mb-3 text-base">{label}</h3>
      <div className="mb-2">
        <label className="block text-sm font-semibold text-gray-700 mb-1">Name</label>
        <input type="text" value={name} onChange={e => setName(e.target.value)} className={inputCls} />
      </div>
      <div className="mb-2">
        <label className="block text-sm font-semibold text-gray-700 mb-1">Signature</label>
        <canvas
          ref={canvasRef}
          width={350}
          height={100}
          className="w-full border border-gray-400 rounded bg-white touch-none cursor-crosshair"
        />
      </div>
      <div className="mb-3">
        <label className="block text-sm font-semibold text-gray-700 mb-1">
          Date <span className="font-normal text-gray-500">(defaults to handover date)</span>
        </label>
        <input type="date" value={sigDate} onChange={e => setSigDate(e.target.value)} className={inputCls} />
      </div>
      <div className="flex gap-2">
        <button onClick={handleSave} className="flex-1 px-3 py-2 text-sm font-semibold text-white bg-primary-600 rounded hover:bg-primary-700">Save</button>
        <button onClick={() => padRef.current?.clear()} className="px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-400 rounded hover:bg-gray-100">Erase</button>
        <button onClick={cancelSigning} className="px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-400 rounded hover:bg-gray-100">Cancel</button>
      </div>
    </div>
  );
};
