import React, { useEffect, useRef, useState } from 'react';
import SignaturePad from 'signature_pad';

const COLORS = [
  { name: 'Red', value: '#ef4444' },
  { name: 'Yellow', value: '#eab308' },
  { name: 'Green', value: '#22c55e' },
  { name: 'Blue', value: '#3b82f6' },
  { name: 'White', value: '#ffffff' },
];

// Two stacked canvases rather than drawing the photo directly onto SignaturePad's own
// canvas: SignaturePad.clear() (called internally on construction, and by our own "Clear
// Markup" button) repaints its whole canvas to backgroundColor, which would wipe out the
// photo pixels too if they shared one canvas. Keeping the photo on a separate, untouched
// background layer and only ever clearing the transparent strokes layer on top sidesteps
// that entirely — "Clear Markup" becomes a plain, safe SignaturePad.clear().
export const PhotoAnnotator: React.FC<{
  // Always the pristine original — never a previously-annotated result — so every
  // annotate session starts from a clean copy and there's no compounding quality loss.
  photoUrl: string;
  onSave: (annotatedDataUrl: string) => void;
  onClose: () => void;
}> = ({ photoUrl, onSave, onClose }) => {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const bgCanvasRef = useRef<HTMLCanvasElement>(null);
  const drawCanvasRef = useRef<HTMLCanvasElement>(null);
  const padRef = useRef<SignaturePad | null>(null);
  const [color, setColor] = useState(COLORS[0].value);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const bg = bgCanvasRef.current;
    const draw = drawCanvasRef.current;
    const wrapper = wrapperRef.current;
    if (!bg || !draw || !wrapper) return;

    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      const maxW = Math.min(wrapper.clientWidth || 600, 700);
      const scale = Math.min(1, maxW / img.naturalWidth);
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      const ratio = window.devicePixelRatio || 1;

      [bg, draw].forEach(c => {
        c.style.width = `${w}px`;
        c.style.height = `${h}px`;
        c.width = w * ratio;
        c.height = h * ratio;
      });

      const bgCtx = bg.getContext('2d');
      if (bgCtx) {
        bgCtx.scale(ratio, ratio);
        bgCtx.drawImage(img, 0, 0, w, h);
      }

      padRef.current = new SignaturePad(draw, {
        penColor: color,
        backgroundColor: 'rgba(0,0,0,0)',
        minWidth: 2,
        maxWidth: 5,
      });
      setReady(true);
    };
    img.src = photoUrl;

    return () => {
      cancelled = true;
      padRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoUrl]);

  const changeColor = (c: string) => {
    setColor(c);
    if (padRef.current) padRef.current.penColor = c;
  };

  const clearMarkup = () => padRef.current?.clear();

  const handleSave = () => {
    const bg = bgCanvasRef.current;
    const draw = drawCanvasRef.current;
    if (!bg || !draw) return;
    const out = document.createElement('canvas');
    out.width = bg.width;
    out.height = bg.height;
    const ctx = out.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(bg, 0, 0);
    ctx.drawImage(draw, 0, 0);
    onSave(out.toDataURL('image/jpeg', 0.85));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[92vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-300 shrink-0">
          <h3 className="font-semibold text-gray-900">Annotate Photo</h3>
          <button onClick={onClose} aria-label="Close" className="text-gray-600 hover:text-gray-700 text-xl leading-none">✕</button>
        </div>
        <div ref={wrapperRef} className="p-4 overflow-auto flex-1 flex items-center justify-center bg-gray-100 min-h-[240px]">
          <div className="relative" style={{ lineHeight: 0 }}>
            <canvas ref={bgCanvasRef} className="block" />
            <canvas ref={drawCanvasRef} className="absolute top-0 left-0 touch-none cursor-crosshair" />
          </div>
        </div>
        <div className="p-4 border-t border-gray-300 shrink-0 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-gray-700">Colour</span>
            {COLORS.map(c => (
              <button
                key={c.value}
                onClick={() => changeColor(c.value)}
                aria-label={c.name}
                title={c.name}
                className={`w-7 h-7 rounded-full border-2 ${color === c.value ? 'border-gray-900' : 'border-gray-300'}`}
                style={{ backgroundColor: c.value }}
              />
            ))}
            <button onClick={clearMarkup} className="ml-auto px-3 py-1.5 text-sm text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200">
              Clear Markup
            </button>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={!ready}
              className="flex-1 py-2 text-white bg-primary-600 rounded-lg font-medium hover:bg-primary-700 disabled:opacity-50"
            >
              Save Annotation
            </button>
            <button onClick={onClose} className="flex-1 py-2 text-gray-800 bg-white border border-gray-400 rounded-lg font-medium hover:bg-gray-50">
              Cancel
            </button>
          </div>
          <p className="text-xs text-gray-500">Draw directly on the photo to mark up damage or defects — pick a colour, then draw with your finger, stylus, or mouse.</p>
        </div>
      </div>
    </div>
  );
};
