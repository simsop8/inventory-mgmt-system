import React, { useState } from 'react';
import { useProperty } from '../store/PropertyContext';
import { SigField } from './SigField';
import { fd } from '../utils/date';
import { shareOrDownload } from '../utils/share';
import type { TakeoverData, TakeoverKeyItem, TakeoverDocument, TakeoverDocumentStatus, TakeoverRoomNote, TakeoverDeduction } from '../types';
import { TAKEOVER_KEY_PRESETS, TAKEOVER_DOCUMENT_PRESETS, TAKEOVER_AREA_PRESETS } from '../types';

const inputCls = 'w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500';
// Field/section label styling echoes the SRI CRM form editor: small, bold,
// uppercase, letter-spaced captions in a muted colour with a hairline rule
// under section titles — matching its .field label / .fg-title look.
const labelCls = 'block text-[11px] font-bold uppercase tracking-wide text-gray-500 mb-1.5';
const sectionTitleTextCls = 'text-xs font-bold uppercase tracking-wider text-gray-500';
const sectionTitleCls = `${sectionTitleTextCls} pb-2 mb-4 border-b border-gray-200`;
const sectionHeaderRowCls = 'flex items-center justify-between pb-2 mb-3 border-b border-gray-200';

// Data-entry lists render as real bordered tables — a solid white cell with a
// visible border, not a borderless/transparent field — mirroring the fully-
// gridded, boxed tables in the SRI CRM's printed handover form and making it
// unambiguous that each cell is editable.
const tableWrapCls = 'overflow-x-auto rounded-md border border-gray-300';
const tableCls = 'w-full border-collapse text-sm';
const theadRowCls = 'bg-gray-100';
const thCls = 'text-left px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-gray-500 border-b border-gray-300 whitespace-nowrap';
const tdCls = 'border-b border-gray-200 last:border-b-0 p-0 align-top';
const tableInputCls = 'w-full bg-white border-0 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary-400';
const tableSelectCls = `${tableInputCls} cursor-pointer`;

const fmtAmt = (n: number) => n.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const uid = () => crypto.randomUUID();

export const TakeoverForm: React.FC = () => {
  const { profile, isTakeoverLocked, updateTakeover, addTakeoverSignature, deleteTakeoverSignature, clearAllTakeoverSignatures } = useProperty();
  const takeover = profile.takeover;
  const [toast, setToast] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [preview, setPreview] = useState<{ url: string; filename: string; blob: Blob } | null>(null);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3000); };

  // ── Keys & Access ──────────────────────────────────────────────────────
  const addKeyRow = () => updateTakeover({ keys: [...takeover.keys, { id: uid(), description: '', quantity: undefined, remarks: '' }] });
  const updateKeyRow = (id: string, u: Partial<TakeoverKeyItem>) => updateTakeover({ keys: takeover.keys.map(k => k.id === id ? { ...k, ...u } : k) });
  const deleteKeyRow = (id: string) => updateTakeover({ keys: takeover.keys.filter(k => k.id !== id) });
  const prefillKeys = () => {
    if (takeover.keys.length > 0 && !confirm('This replaces the current Keys & Access list with the keys/access items from your move-in inventory. Continue?')) return;
    const fromInventory: TakeoverKeyItem[] = profile.keys
      .filter(k => k.section !== 'meter_readings')
      .map(k => ({ id: uid(), description: k.description, quantity: k.quantity, remarks: '' }));
    updateTakeover({ keys: fromInventory });
    showToast(`Loaded ${fromInventory.length} item(s) from move-in Keys & Access`);
  };

  // ── Documents Submitted ─────────────────────────────────────────────────
  const addDocRow = () => updateTakeover({ documents: [...takeover.documents, { id: uid(), name: '', status: '' as TakeoverDocumentStatus, remarks: '' }] });
  const updateDocRow = (id: string, u: Partial<TakeoverDocument>) => updateTakeover({ documents: takeover.documents.map(d => d.id === id ? { ...d, ...u } : d) });
  const deleteDocRow = (id: string) => updateTakeover({ documents: takeover.documents.filter(d => d.id !== id) });

  // ── Room / Area Inspection ──────────────────────────────────────────────
  const addRoomRow = () => updateTakeover({ rooms: [...takeover.rooms, { id: uid(), area: '', remarks: '' }] });
  const updateRoomRow = (id: string, u: Partial<TakeoverRoomNote>) => updateTakeover({ rooms: takeover.rooms.map(r => r.id === id ? { ...r, ...u } : r) });
  const deleteRoomRow = (id: string) => updateTakeover({ rooms: takeover.rooms.filter(r => r.id !== id) });
  const prefillRooms = () => {
    if (takeover.rooms.length > 0 && !confirm('This replaces the current Room / Area Inspection list with the rooms from your move-in inventory. Continue?')) return;
    const fromInventory: TakeoverRoomNote[] = profile.rooms.map(r => ({ id: uid(), area: r.name, remarks: '' }));
    updateTakeover({ rooms: fromInventory });
    showToast(`Loaded ${fromInventory.length} room(s) from move-in inventory`);
  };

  // ── Deductions ───────────────────────────────────────────────────────────
  const addDeductionRow = () => updateTakeover({ deductions: [...takeover.deductions, { id: uid(), description: '', amount: undefined }] });
  const updateDeductionRow = (id: string, u: Partial<TakeoverDeduction>) => updateTakeover({ deductions: takeover.deductions.map(x => x.id === id ? { ...x, ...u } : x) });
  const deleteDeductionRow = (id: string) => updateTakeover({ deductions: takeover.deductions.filter(x => x.id !== id) });

  const totalDeductions = takeover.deductions.reduce((s, x) => s + (x.amount || 0), 0);
  const depositAmount = parseFloat(takeover.securityDeposit || '') || 0;
  const refundAmount = depositAmount - totalDeductions;

  // ── Signatures ───────────────────────────────────────────────────────────
  const agents = profile.details.agents || [];
  const llRole = takeover.llSignatoryRole || 'Landlord';
  const teRole = takeover.teSignatoryRole || 'Tenant';
  const sigRoles = [
    ...profile.details.landlords.map((l, i) => ({
      role: `takeover_landlord_${i}`,
      label: profile.details.landlords.length > 1 ? `${llRole} ${i + 1}` : llRole,
      defaultName: l.name,
    })),
    ...profile.details.tenants.map((t, i) => ({
      role: `takeover_tenant_${i}`,
      label: profile.details.tenants.length > 1 ? `${teRole} ${i + 1}` : teRole,
      defaultName: t.name,
    })),
    ...agents.map((a, i) => ({
      role: `takeover_agent_${i}`,
      label: agents.length > 1 ? `Agent ${i + 1}` : 'Agent',
      defaultName: a.name || '',
    })),
  ];

  const signedLabels = takeover.signatures.map(s => {
    const idx = parseInt(s.role.split('_')[2], 10) || 0;
    if (s.role.startsWith('takeover_landlord_')) return profile.details.landlords.length > 1 ? `${llRole} ${idx + 1}` : llRole;
    if (s.role.startsWith('takeover_tenant_')) return profile.details.tenants.length > 1 ? `${teRole} ${idx + 1}` : teRole;
    if (s.role.startsWith('takeover_agent_')) return agents.length > 1 ? `Agent ${idx + 1}` : 'Agent';
    return s.name || 'Signature';
  });

  const handleClearAllTakeoverSignatures = () => {
    if (confirm('Clear all takeover signatures? Everyone will need to sign again afterwards.')) {
      clearAllTakeoverSignatures();
      showToast('All takeover signatures cleared — editing unlocked');
    }
  };

  // ── PDF generation ───────────────────────────────────────────────────────
  // Styled to match SRI CRM's "Property Handover Form" print output: serif
  // (Times) type, fully-bordered light-grey tables, uppercase underlined
  // section headings, and line-style (not boxed) signature blocks.
  //
  // Builds the PDF into an in-page preview (iframe modal) rather than handing
  // it straight to the browser's download/share flow — same pattern as the
  // Condition Report tab — so you can check it over before saving or sharing.
  const generateTakeoverPDF = async () => {
    setGenerating(true);
    try {
    const { default: jsPDF } = await import('jspdf');
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const W = 210, H = 297, ML = 15, MR = 15, MT = 15, MB = 14;
    const CW = W - ML - MR;

    // SRI CRM handover-form palette
    const AAA = 170;              // table border colour (#aaa)
    const GREY_BG: [number, number, number] = [247, 247, 247]; // header/label shading (#f7f7f7)
    const GREEN_BG: [number, number, number] = [232, 245, 233]; // refund highlight (#e8f5e9)

    let y = MT;
    const np = () => { doc.addPage(); y = MT; };
    const ck = (n: number) => { if (y + n > H - MB) np(); };
    const sf = (s: 'normal' | 'bold' | 'italic', sz: number, c = 0) => { doc.setFont('times', s); doc.setFontSize(sz); doc.setTextColor(c); };
    const cellRect = (x: number, y0: number, w: number, h: number, fill?: [number, number, number]) => {
      doc.setDrawColor(AAA); doc.setLineWidth(0.15);
      if (fill) { doc.setFillColor(fill[0], fill[1], fill[2]); doc.rect(x, y0, w, h, 'FD'); } else { doc.rect(x, y0, w, h, 'S'); }
    };

    const landlordNames = profile.details.landlords.map(l => l.name).filter(Boolean).join(', ') || '—';
    const tenantNames = profile.details.tenants.map(t => t.name).filter(Boolean).join(', ') || '—';
    const addrParts = [profile.details.condoName, profile.details.address, profile.details.unitNo ? `Unit ${profile.details.unitNo}` : null].filter(Boolean);

    // ── Header ─────────────────────────────────────────────────────────────
    sf('bold', 15, 0); doc.text('PROPERTY TAKEOVER FORM', W / 2, y + 7, { align: 'center' }); y += 11;
    sf('italic', 9, 90); doc.text('(End of Tenancy)', W / 2, y, { align: 'center' }); y += 5;
    doc.setDrawColor(0); doc.setLineWidth(0.5); doc.line(ML, y, W - MR, y); y += 8;

    // Info table helper: bordered, shaded-label 2-col rows (mirrors the CRM's info table)
    const infoRow = (rows: [string, string, string, string][]) => {
      rows.forEach(([l1, v1, l2, v2]) => {
        const rh = 6.5; ck(rh);
        const half = CW / 2;
        const labelW1 = 40, labelW2 = l2 ? 38 : 0;
        cellRect(ML, y, labelW1, rh, GREY_BG);
        cellRect(ML + labelW1, y, half - labelW1, rh);
        if (l2) {
          cellRect(ML + half, y, labelW2, rh, GREY_BG);
          cellRect(ML + half + labelW2, y, half - labelW2, rh);
        }
        sf('bold', 8.5, 0); doc.text(l1, ML + 2, y + 4.4);
        sf('normal', 8.5, 0); doc.text(doc.splitTextToSize(v1 || '—', half - labelW1 - 4)[0], ML + labelW1 + 2, y + 4.4);
        if (l2) {
          sf('bold', 8.5, 0); doc.text(l2, ML + half + 2, y + 4.4);
          sf('normal', 8.5, 0); doc.text(doc.splitTextToSize(v2 || '—', half - labelW2 - 4)[0], ML + half + labelW2 + 2, y + 4.4);
        }
        y += rh;
      });
    };

    infoRow([
      ['Property Address', addrParts.join(' '), '', ''],
      ['Date of Inspection', fd(takeover.inspectionDate), 'Lease End Date', fd(profile.details.leaseEnd)],
      [llRole, landlordNames, teRole, tenantNames],
      ['Monthly Rent', takeover.monthlyRent ? `S$ ${takeover.monthlyRent}` : '—', 'Security Deposit', takeover.securityDeposit ? `S$ ${takeover.securityDeposit}` : '—'],
      ['Repair Threshold', takeover.repairThreshold ? `S$ ${takeover.repairThreshold} per item per job` : '—', '', ''],
    ]);
    y += 5;

    // Section heading: uppercase, bold, underlined — mirrors the CRM's ".ho-sec" style
    const sectionTitle = (n: number, title: string) => {
      ck(11); sf('bold', 9.5, 0); doc.text(`${n}. ${title}`.toUpperCase(), ML, y); y += 1.5;
      doc.setDrawColor(0); doc.setLineWidth(0.35); doc.line(ML, y, W - MR, y); y += 5;
    };
    // Fully-bordered table header row, shaded like the CRM's th
    const tableHeader = (cols: { label: string; w: number; align?: 'left' | 'right' | 'center' }[]) => {
      const rh = 6; ck(rh);
      let cx = ML;
      sf('bold', 7.8, 0);
      cols.forEach(c => {
        cellRect(cx, y, c.w, rh, GREY_BG);
        doc.text(c.label, c.align === 'right' ? cx + c.w - 2 : cx + 2, y + 4.1, { align: c.align === 'right' ? 'right' : 'left' });
        cx += c.w;
      });
      y += rh;
    };
    // Fully-bordered data row (no zebra shading — CRM tables are plain-bordered)
    const tableRow = (cells: { text: string; w: number; align?: 'left' | 'right' | 'center'; color?: number }[]) => {
      const rh = 6.5; ck(rh);
      let cx = ML;
      cells.forEach(c => {
        cellRect(cx, y, c.w, rh);
        sf('normal', 8, c.color ?? 0);
        const tx = c.align === 'right' ? cx + c.w - 2 : cx + 2;
        doc.text(doc.splitTextToSize(c.text || '—', c.w - 4)[0], tx, y + 4.4, { align: c.align === 'right' ? 'right' : 'left' });
        cx += c.w;
      });
      y += rh;
    };

    // ── 1. Keys & Access ─────────────────────────────────────────────────
    sectionTitle(1, 'Keys & Access');
    tableHeader([{ label: 'Key / Access Item', w: CW * 0.5 }, { label: 'No.', w: CW * 0.12, align: 'center' }, { label: 'Remarks', w: CW * 0.38 }]);
    if (takeover.keys.length === 0) { tableRow([{ text: 'Nil', w: CW * 0.5, color: 150 }, { text: '', w: CW * 0.12 }, { text: '', w: CW * 0.38 }]); }
    else takeover.keys.forEach(k => tableRow([
      { text: k.description, w: CW * 0.5 },
      { text: k.quantity !== undefined ? String(k.quantity) : '—', w: CW * 0.12, align: 'center' },
      { text: k.remarks || '', w: CW * 0.38 },
    ]));
    y += 6;

    // ── 2. Documents Submitted ───────────────────────────────────────────
    sectionTitle(2, 'Documents Submitted');
    tableHeader([{ label: 'Document', w: CW * 0.45 }, { label: 'Status', w: CW * 0.2 }, { label: 'Remarks', w: CW * 0.35 }]);
    if (takeover.documents.length === 0) { tableRow([{ text: 'No documents recorded', w: CW * 0.45, color: 150 }, { text: '', w: CW * 0.2 }, { text: '', w: CW * 0.35 }]); }
    else takeover.documents.forEach(d => tableRow([
      { text: d.name, w: CW * 0.45 },
      { text: d.status || '—', w: CW * 0.2 },
      { text: d.remarks || '', w: CW * 0.35 },
    ]));
    y += 6;

    // ── 3. Room / Area Inspection ────────────────────────────────────────
    sectionTitle(3, 'Room / Area Inspection');
    tableHeader([{ label: 'Area', w: CW * 0.3 }, { label: 'Observations / Remarks', w: CW * 0.7 }]);
    if (takeover.rooms.length === 0) { tableRow([{ text: 'Nil', w: CW * 0.3, color: 150 }, { text: '', w: CW * 0.7 }]); }
    else takeover.rooms.forEach(r => tableRow([
      { text: r.area, w: CW * 0.3 },
      { text: r.remarks || '', w: CW * 0.7 },
    ]));
    y += 6;

    // ── 4. Deductions from Security Deposit ─────────────────────────────
    sectionTitle(4, 'Deductions from Security Deposit');
    tableHeader([{ label: 'No.', w: CW * 0.1, align: 'center' }, { label: 'Description', w: CW * 0.6 }, { label: 'Amount (S$)', w: CW * 0.3, align: 'right' }]);
    if (takeover.deductions.length === 0) {
      tableRow([{ text: '—', w: CW * 0.1, align: 'center', color: 150 }, { text: 'Nil', w: CW * 0.6, color: 150 }, { text: '0.00', w: CW * 0.3, align: 'right' }]);
    } else takeover.deductions.forEach((x, i) => tableRow([
      { text: String(i + 1), w: CW * 0.1, align: 'center' },
      { text: x.description, w: CW * 0.6 },
      { text: fmtAmt(x.amount || 0), w: CW * 0.3, align: 'right' },
    ]));

    ck(20);
    cellRect(ML, y, CW, 6.5, GREY_BG);
    sf('bold', 8.5, 0); doc.text('Total Deductions', ML + CW * 0.7 - 2, y + 4.4, { align: 'right' });
    doc.text(`S$ ${fmtAmt(totalDeductions)}`, ML + CW - 2, y + 4.4, { align: 'right' }); y += 6.5;
    cellRect(ML, y, CW, 6.5);
    sf('bold', 8.5, 0); doc.text('Security Deposit', ML + CW * 0.7 - 2, y + 4.4, { align: 'right' });
    sf('normal', 8.5, 0); doc.text(`S$ ${fmtAmt(depositAmount)}`, ML + CW - 2, y + 4.4, { align: 'right' }); y += 6.5;
    cellRect(ML, y, CW, 7.5, GREEN_BG);
    sf('bold', 9.5, 0); doc.text('Amount to Refund', ML + CW * 0.7 - 2, y + 5, { align: 'right' });
    doc.text(`S$ ${fmtAmt(refundAmount)}`, ML + CW - 2, y + 5, { align: 'right' }); y += 12;

    // ── 5. Deposit Refund ─────────────────────────────────────────────────
    sectionTitle(5, 'Deposit Refund');
    sf('normal', 8.5, 0);
    doc.splitTextToSize(`The security deposit refund of S$ ${fmtAmt(refundAmount)} is payable to the following account:`, CW).forEach((l: string) => { ck(5); doc.text(l, ML, y); y += 5; });
    y += 2;
    infoRow([
      ['Account Name', takeover.refundAccountName || '', '', ''],
      ['Bank', takeover.refundBank || '', 'Account No.', takeover.refundAccountNo || ''],
    ]);
    if (takeover.refundRemarks) {
      y += 2; sf('italic', 8, 90);
      doc.splitTextToSize(takeover.refundRemarks, CW).forEach((l: string) => { ck(5); doc.text(l, ML, y); y += 5; });
    }
    y += 6;

    // ── Acknowledgement + Signatures ─────────────────────────────────────
    ck(16);
    sf('normal', 9, 0);
    doc.setDrawColor(200); doc.setLineWidth(0.2); doc.line(ML, y, W - MR, y); y += 6;
    doc.splitTextToSize('The Landlord and Tenant confirm that the above reflects an accurate record of the property takeover and the terms agreed upon.', CW)
      .forEach((l: string) => { doc.text(l, ML, y); y += 5; });
    y += 8;

    const landlordAgents = agents.map((a, i) => ({ ...a, _idx: i })).filter(a => a.servingFor === 'landlord' || a.servingFor === 'both');
    const tenantAgents = agents.map((a, i) => ({ ...a, _idx: i })).filter(a => a.servingFor === 'tenant' || a.servingFor === 'both');
    const leftSigItems = sigRoles.filter(r => r.role.startsWith('takeover_landlord_') || landlordAgents.some(a => `takeover_agent_${a._idx}` === r.role));
    const rightSigItems = sigRoles.filter(r => r.role.startsWith('takeover_tenant_') || tenantAgents.some(a => `takeover_agent_${a._idx}` === r.role));

    // Line-style signature block — mirrors the CRM's sigPad: signature image sits
    // above a rule, with the role label, name and date printed beneath the line
    // (no surrounding box).
    const sigH = 27, colGap = 6;
    const sigW = (CW - colGap) / 2;
    const lxCol = ML, rxCol = ML + sigW + colGap;

    const drawSigBlock = (sx: number, sy: number, role: string, label: string, defaultName: string) => {
      const sig = takeover.signatures.find(s => s.role === role);
      if (sig) { try { doc.addImage(sig.signatureDataUrl, 'PNG', sx, sy, sigW * 0.6, 11); } catch { /* skip */ } }
      doc.setDrawColor(0); doc.setLineWidth(0.3); doc.line(sx, sy + 13, sx + sigW, sy + 13);
      sf('bold', 8, 0); doc.text(label, sx, sy + 18);
      const name = sig ? sig.name : defaultName;
      sf('normal', 8, sig ? 0 : 150); doc.text(`Name: ${name && name.trim() ? name.trim() : '_________________'}`, sx, sy + 23);
      sf('normal', 7.5, sig ? 60 : 150); doc.text(`Date: ${sig ? fd(sig.date) : '_________________'}`, sx, sy + 27.5);
    };

    const boxGap = 6;
    const leftTotalH = leftSigItems.length > 0 ? leftSigItems.length * sigH + (leftSigItems.length - 1) * boxGap : 0;
    const rightTotalH = rightSigItems.length > 0 ? rightSigItems.length * sigH + (rightSigItems.length - 1) * boxGap : 0;
    ck(Math.max(leftTotalH, rightTotalH));
    const startY = y;
    let leftY = startY, rightY = startY;
    leftSigItems.forEach(({ role, label, defaultName }) => { drawSigBlock(lxCol, leftY, role, label, defaultName); leftY += sigH + boxGap; });
    rightSigItems.forEach(({ role, label, defaultName }) => { drawSigBlock(rxCol, rightY, role, label, defaultName); rightY += sigH + boxGap; });
    y = Math.max(leftY, rightY);

    // ── Footer on every page ─────────────────────────────────────────────
    const tp = (doc as InstanceType<typeof jsPDF> & { internal: { getNumberOfPages: () => number } }).internal.getNumberOfPages();
    for (let pg = 1; pg <= tp; pg++) {
      doc.setPage(pg);
      doc.setDrawColor(160); doc.setLineWidth(0.2); doc.line(ML, H - 10, W - MR, H - 10);
      sf('normal', 7, 120);
      doc.text(`Property Takeover  ·  ${addrParts.join(' ')}`, ML, H - 5);
      doc.text(`Page ${pg} of ${tp}`, W - MR, H - 5, { align: 'right' });
    }

    const filename = `${(profile.details.address || 'property-takeover').replace(/[^a-z0-9]/gi, '_').slice(0, 50)}-takeover.pdf`;
    const blob = doc.output('blob') as Blob;
    const url = URL.createObjectURL(blob);
    setPreview(prev => { if (prev) URL.revokeObjectURL(prev.url); return { url, filename, blob }; });
    } finally {
      setGenerating(false);
    }
  };

  const closeTakeoverPreview = () => {
    setPreview(prev => { if (prev) URL.revokeObjectURL(prev.url); return null; });
  };

  const downloadTakeoverPreview = async () => {
    if (!preview) return;
    await shareOrDownload(preview.blob, preview.filename, 'application/pdf');
  };

  return (
    <div className="space-y-6">
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-gray-900 text-white text-sm px-4 py-2 rounded-lg shadow-lg pointer-events-none">
          {toast}
        </div>
      )}

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800">
        Use this at the end of the lease, when you take the property back from the tenant. It's a separate record from the move-in inventory — your original Rooms/Keys/Photos stay untouched.
      </div>

      {isTakeoverLocked && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex flex-wrap items-center justify-between gap-2 text-sm text-amber-800">
          <span>🔒 Locked for editing — signed by <strong>{signedLabels.join(', ')}</strong>. Clear these to make changes (everyone will need to sign again afterwards).</span>
          <button onClick={handleClearAllTakeoverSignatures} className="text-xs font-semibold text-amber-900 underline hover:no-underline whitespace-nowrap">
            Clear All Takeover Signatures
          </button>
        </div>
      )}

      <fieldset disabled={isTakeoverLocked} className="contents m-0 p-0 border-0 min-w-0">

        <div className="bg-white rounded-lg shadow p-6">
          <h2 className={sectionTitleCls}>Inspection Details</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Date of Inspection</label>
              <input type="date" value={takeover.inspectionDate || ''} onChange={e => updateTakeover({ inspectionDate: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Lease End Date <span className="text-gray-400 font-normal">(from Property tab)</span></label>
              <input type="text" readOnly value={fd(profile.details.leaseEnd)} className={`${inputCls} bg-gray-50 text-gray-500`} />
            </div>
            <div>
              <label className={labelCls}>Landlord(s) <span className="text-gray-400 font-normal">(from Property tab)</span></label>
              <input type="text" readOnly value={profile.details.landlords.map(l => l.name).filter(Boolean).join(', ') || '—'} className={`${inputCls} bg-gray-50 text-gray-500`} />
            </div>
            <div>
              <label className={labelCls}>Landlord Signing As</label>
              <select value={llRole} onChange={e => updateTakeover({ llSignatoryRole: e.target.value as TakeoverData['llSignatoryRole'] })} className={inputCls}>
                <option value="Landlord">Landlord</option>
                <option value="Landlord's Rep">Landlord's Rep</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Tenant(s) <span className="text-gray-400 font-normal">(from Property tab)</span></label>
              <input type="text" readOnly value={profile.details.tenants.map(t => t.name).filter(Boolean).join(', ') || '—'} className={`${inputCls} bg-gray-50 text-gray-500`} />
            </div>
            <div>
              <label className={labelCls}>Tenant Signing As</label>
              <select value={teRole} onChange={e => updateTakeover({ teSignatoryRole: e.target.value as TakeoverData['teSignatoryRole'] })} className={inputCls}>
                <option value="Tenant">Tenant</option>
                <option value="Tenant's Rep">Tenant's Rep</option>
              </select>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <h2 className={sectionTitleCls}>Lease Summary</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className={labelCls}>Monthly Rent (S$)</label>
              <input type="text" inputMode="decimal" value={takeover.monthlyRent || ''} onChange={e => updateTakeover({ monthlyRent: e.target.value })} placeholder="e.g. 5000" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Security Deposit (S$)</label>
              <input type="text" inputMode="decimal" value={takeover.securityDeposit || ''} onChange={e => updateTakeover({ securityDeposit: e.target.value })} placeholder="e.g. 10000" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Repair Threshold (S$)</label>
              <input type="text" inputMode="decimal" value={takeover.repairThreshold || ''} onChange={e => updateTakeover({ repairThreshold: e.target.value })} placeholder="e.g. 150 per item per job" className={inputCls} />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-4">
          <div className={sectionHeaderRowCls}>
            <h2 className={sectionTitleTextCls}>Keys &amp; Access</h2>
            <div className="flex gap-2">
              <button onClick={prefillKeys} className="text-xs text-gray-500 hover:text-gray-700 border border-gray-200 rounded px-2 py-1">Load from Move-in Keys</button>
              <button onClick={addKeyRow} className="text-sm text-primary-600 hover:text-primary-700 font-medium">+ Add</button>
            </div>
          </div>
          {takeover.keys.length === 0 ? <p className="text-xs text-gray-400 text-center py-2">No entries yet.</p> : (
            <div className={tableWrapCls}>
              <table className={tableCls}>
                <thead>
                  <tr className={theadRowCls}>
                    <th className={thCls} style={{ width: '48%' }}>Key / Access Item</th>
                    <th className={`${thCls} text-center`} style={{ width: '10%' }}>No.</th>
                    <th className={thCls}>Remarks</th>
                    <th className={thCls} style={{ width: '32px' }} />
                  </tr>
                </thead>
                <tbody>
                  {takeover.keys.map(k => (
                    <tr key={k.id}>
                      <td className={tdCls}>
                        <input list="takeover-key-presets" type="text" value={k.description} onChange={e => updateKeyRow(k.id, { description: e.target.value })} placeholder="e.g. Main Door Key" className={tableInputCls} />
                      </td>
                      <td className={tdCls}>
                        <input type="text" inputMode="numeric" value={k.quantity !== undefined ? String(k.quantity) : ''} onChange={e => { const v = e.target.value; updateKeyRow(k.id, { quantity: v === '' ? undefined : (parseInt(v) || 0) }); }} placeholder="—" className={`${tableInputCls} text-center`} />
                      </td>
                      <td className={tdCls}>
                        <input type="text" value={k.remarks || ''} onChange={e => updateKeyRow(k.id, { remarks: e.target.value })} placeholder="e.g. All accounted for" className={tableInputCls} />
                      </td>
                      <td className={`${tdCls} text-center`}>
                        <button onClick={() => deleteKeyRow(k.id)} className="text-gray-300 hover:text-red-500 text-lg leading-none">×</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <datalist id="takeover-key-presets">{TAKEOVER_KEY_PRESETS.map(p => <option key={p} value={p} />)}</datalist>
        </div>

        <div className="bg-white rounded-lg shadow p-4">
          <div className={sectionHeaderRowCls}>
            <h2 className={sectionTitleTextCls}>Documents Submitted</h2>
            <button onClick={addDocRow} className="text-sm text-primary-600 hover:text-primary-700 font-medium">+ Add</button>
          </div>
          {takeover.documents.length === 0 ? <p className="text-xs text-gray-400 text-center py-2">No documents recorded.</p> : (
            <div className={tableWrapCls}>
              <table className={tableCls}>
                <thead>
                  <tr className={theadRowCls}>
                    <th className={thCls} style={{ width: '42%' }}>Document</th>
                    <th className={thCls} style={{ width: '18%' }}>Status</th>
                    <th className={thCls}>Remarks</th>
                    <th className={thCls} style={{ width: '32px' }} />
                  </tr>
                </thead>
                <tbody>
                  {takeover.documents.map(d => (
                    <tr key={d.id}>
                      <td className={tdCls}>
                        <input list="takeover-doc-presets" type="text" value={d.name} onChange={e => updateDocRow(d.id, { name: e.target.value })} placeholder="— type or select —" className={tableInputCls} />
                      </td>
                      <td className={tdCls}>
                        <select value={d.status} onChange={e => updateDocRow(d.id, { status: e.target.value as TakeoverDocumentStatus })} className={tableSelectCls}>
                          <option value="">—</option>
                          <option value="Submitted">Submitted</option>
                          <option value="Pending">Pending</option>
                          <option value="N/A">N/A</option>
                        </select>
                      </td>
                      <td className={tdCls}>
                        <input type="text" value={d.remarks || ''} onChange={e => updateDocRow(d.id, { remarks: e.target.value })} placeholder="e.g. dated 15 Jun 2026" className={tableInputCls} />
                      </td>
                      <td className={`${tdCls} text-center`}>
                        <button onClick={() => deleteDocRow(d.id)} className="text-gray-300 hover:text-red-500 text-lg leading-none">×</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <datalist id="takeover-doc-presets">{TAKEOVER_DOCUMENT_PRESETS.map(p => <option key={p} value={p} />)}</datalist>
        </div>

        <div className="bg-white rounded-lg shadow p-4">
          <div className={sectionHeaderRowCls}>
            <h2 className={sectionTitleTextCls}>Room / Area Inspection</h2>
            <div className="flex gap-2">
              <button onClick={prefillRooms} className="text-xs text-gray-500 hover:text-gray-700 border border-gray-200 rounded px-2 py-1">Load from Move-in Rooms</button>
              <button onClick={addRoomRow} className="text-sm text-primary-600 hover:text-primary-700 font-medium">+ Add</button>
            </div>
          </div>
          {takeover.rooms.length === 0 ? <p className="text-xs text-gray-400 text-center py-2">No areas added yet.</p> : (
            <div className={tableWrapCls}>
              <table className={tableCls}>
                <thead>
                  <tr className={theadRowCls}>
                    <th className={thCls} style={{ width: '28%' }}>Area</th>
                    <th className={thCls}>Observations / Remarks</th>
                    <th className={thCls} style={{ width: '32px' }} />
                  </tr>
                </thead>
                <tbody>
                  {takeover.rooms.map(r => (
                    <tr key={r.id}>
                      <td className={tdCls}>
                        <input list="takeover-area-presets" type="text" value={r.area} onChange={e => updateRoomRow(r.id, { area: e.target.value })} placeholder="— area —" className={tableInputCls} />
                      </td>
                      <td className={tdCls}>
                        <textarea value={r.remarks || ''} onChange={e => updateRoomRow(r.id, { remarks: e.target.value })} placeholder="Observations / remarks" rows={1} className={`${tableInputCls} resize-y block`} />
                      </td>
                      <td className={`${tdCls} text-center`}>
                        <button onClick={() => deleteRoomRow(r.id)} className="text-gray-300 hover:text-red-500 text-lg leading-none">×</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <datalist id="takeover-area-presets">{TAKEOVER_AREA_PRESETS.map(p => <option key={p} value={p} />)}</datalist>
        </div>

        <div className="bg-white rounded-lg shadow p-4">
          <div className={sectionHeaderRowCls}>
            <h2 className={sectionTitleTextCls}>Deductions from Security Deposit</h2>
            <button onClick={addDeductionRow} className="text-sm text-primary-600 hover:text-primary-700 font-medium">+ Add</button>
          </div>
          {takeover.deductions.length > 0 && (
            <div className={`${tableWrapCls} mb-3`}>
              <table className={tableCls}>
                <thead>
                  <tr className={theadRowCls}>
                    <th className={thCls}>Description</th>
                    <th className={`${thCls} text-right`} style={{ width: '30%' }}>Amount (S$)</th>
                    <th className={thCls} style={{ width: '32px' }} />
                  </tr>
                </thead>
                <tbody>
              {takeover.deductions.map(x => (
                <tr key={x.id}>
                  <td className={tdCls}>
                    <input type="text" value={x.description} onChange={e => updateDeductionRow(x.id, { description: e.target.value })} placeholder="e.g. Touch-up painting to walls" className={tableInputCls} />
                  </td>
                  <td className={tdCls}>
                    <input type="text" inputMode="decimal" value={x.amount !== undefined ? String(x.amount) : ''} onChange={e => { const v = e.target.value; updateDeductionRow(x.id, { amount: v === '' ? undefined : (parseFloat(v) || 0) }); }} placeholder="0.00" className={`${tableInputCls} text-right`} />
                  </td>
                  <td className={`${tdCls} text-center`}>
                    <button onClick={() => deleteDeductionRow(x.id)} className="text-gray-300 hover:text-red-500 text-lg leading-none">×</button>
                  </td>
                </tr>
              ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="border-t border-gray-100 pt-3 space-y-1.5 text-sm">
            <div className="flex justify-between text-gray-600"><span>Total Deductions</span><span>S$ {fmtAmt(totalDeductions)}</span></div>
            <div className="flex justify-between text-gray-600"><span>Security Deposit</span><span>S$ {fmtAmt(depositAmount)}</span></div>
            <div className="flex justify-between font-semibold text-green-700 bg-green-50 rounded px-2 py-1.5"><span>Amount to Refund</span><span>S$ {fmtAmt(refundAmount)}</span></div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <h2 className={sectionTitleCls}>Deposit Refund</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className={labelCls}>Account Name</label>
              <input type="text" value={takeover.refundAccountName || ''} onChange={e => updateTakeover({ refundAccountName: e.target.value })} placeholder="e.g. John Tan" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Bank Name</label>
              <input type="text" value={takeover.refundBank || ''} onChange={e => updateTakeover({ refundBank: e.target.value })} placeholder="e.g. DBS" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Account No.</label>
              <input type="text" value={takeover.refundAccountNo || ''} onChange={e => updateTakeover({ refundAccountNo: e.target.value })} placeholder="e.g. 0123456789" className={inputCls} />
            </div>
            <div className="md:col-span-2">
              <label className={labelCls}>Remarks</label>
              <textarea value={takeover.refundRemarks || ''} onChange={e => updateTakeover({ refundRemarks: e.target.value })} rows={2} placeholder="e.g. Deposit to be refunded within 14 days" className={inputCls} />
            </div>
          </div>
        </div>

      </fieldset>

      <div className="bg-white rounded-lg shadow p-4">
        <h2 className={`${sectionTitleTextCls} mb-2`}>Signatures</h2>
        <p className="text-sm text-gray-500 mb-4 pb-3 border-b border-gray-200">Separate from the move-in signatures — each party signs here to acknowledge the takeover.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          {sigRoles.map(({ role, label, defaultName }) => (
            <SigField
              key={role}
              role={role}
              label={label}
              defaultName={defaultName}
              defaultDate={takeover.inspectionDate || undefined}
              existing={takeover.signatures.find(s => s.role === role)}
              onSave={addTakeoverSignature}
              onClear={() => { const s = takeover.signatures.find(sig => sig.role === role); if (s) deleteTakeoverSignature(s.id); }}
            />
          ))}
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-4">
        <h2 className={sectionTitleCls}>Generate Report</h2>
        <button
          onClick={generateTakeoverPDF}
          disabled={generating}
          className="flex items-center gap-3 p-4 bg-primary-50 rounded-lg hover:bg-primary-100 transition-colors text-left w-full sm:w-auto sm:min-w-[280px] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <span className="text-2xl">📄</span>
          <div>
            <div className="font-semibold text-primary-700 text-sm">{generating ? 'Generating…' : 'Preview Takeover PDF'}</div>
            <div className="text-xs text-primary-500">Review it before you download or share — serif, bordered A4 layout styled after the SRI CRM handover form</div>
          </div>
        </button>
      </div>

      {/* PDF preview modal */}
      {preview && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/60">
          <div className="bg-white px-4 py-3 shadow">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-gray-900 text-sm truncate">Takeover PDF Preview</span>
              <div className="flex items-center gap-2 shrink-0">
                <button onClick={downloadTakeoverPreview} className="px-3 py-1.5 text-sm font-medium text-white bg-primary-600 rounded-md hover:bg-primary-700">Download / Share</button>
                <button onClick={closeTakeoverPreview} aria-label="Close preview" className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
              </div>
            </div>
            <p className="text-xs text-gray-400 mt-1">If the preview doesn't display on your device, tap Download / Share to open it directly.</p>
          </div>
          <iframe title="Takeover PDF Preview" src={preview.url} className="flex-1 w-full bg-gray-100" />
        </div>
      )}
    </div>
  );
};
