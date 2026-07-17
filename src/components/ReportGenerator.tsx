import React from 'react';
import { useProperty } from '../store/PropertyContext';
import { KEY_SECTION_LABELS } from '../types';
import type { KeySection } from '../types';
import { SigField } from './SigField';
import { fd } from '../utils/date';
import { shareOrDownload, isMobileDevice } from '../utils/share';

const SECTIONS: KeySection[] = ['keys', 'access_cards', 'remote_controls', 'others', 'meter_readings'];

export const ReportGenerator: React.FC = () => {
  const { profile, isLocked, addSignature, deleteSignature, reorderRoom, updateItem, updateKey } = useProperty();

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
      label: agents.length > 1 ? `Agent ${i + 1}` : 'Agent',
      defaultName: a.name || '',
    })),
  ];

  const generatePDF = async () => {
    // Must happen synchronously, before the `await import('jspdf')` below breaks the
    // user-gesture chain — otherwise iOS Safari's popup blocker silently swallows the
    // preview tab. See utils/share.ts for the full explanation.
    const previewWin = isMobileDevice() ? window.open('', '_blank') : null;
    const { default: jsPDF } = await import('jspdf');
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const W = 210, H = 297, ML = 15, MR = 15, MT = 15;

    // Footer signature strip shows Landlord & Tenant only — Agent appears solely on the final signature page.
    const footerRoles = sigRoles.filter(r => r.role.startsWith('landlord_') || r.role.startsWith('tenant_'));
    const sigStripCols = Math.min(Math.max(footerRoles.length, 1), 4);
    const sigStripRows = footerRoles.length > 0 ? Math.ceil(footerRoles.length / sigStripCols) : 0;
    const sigStripRowH = 18;
    const sigStripH = sigStripRows > 0 ? sigStripRows * sigStripRowH + 5 : 0;
    const MB = 12 + sigStripH;
    const CW = W - ML - MR;

    let y = MT;
    const np = () => { doc.addPage(); y = MT; };
    const ck = (n: number) => { if (y + n > H - MB) np(); };
    const sf = (s: 'normal' | 'bold' | 'italic', sz: number, c = 0) => {
      doc.setFont('helvetica', s); doc.setFontSize(sz); doc.setTextColor(c);
    };
    const rule = (w = 0.3, color = 180) => {
      doc.setDrawColor(color); doc.setLineWidth(w);
      doc.line(ML, y, W - MR, y);
      doc.setDrawColor(0); doc.setLineWidth(0.2);
    };

    const landlordNames = profile.details.landlords.map(l => l.name).filter(Boolean);
    const tenantNames = profile.details.tenants.map(t => t.name).filter(Boolean);
    const landlordAgents = agents.map((a, i) => ({ ...a, _idx: i })).filter(a => a.servingFor === 'landlord' || a.servingFor === 'both');
    const tenantAgents = agents.map((a, i) => ({ ...a, _idx: i })).filter(a => a.servingFor === 'tenant' || a.servingFor === 'both');

    // ── Header ─────────────────────────────────────────────────────────────
    sf('bold', 16, 0);
    doc.text('PROPERTY INVENTORY REPORT', W / 2, y + 6, { align: 'center' });
    y += 10;
    rule(0.5, 0);
    y += 4;

    const addrParts = [
      profile.details.condoName,
      profile.details.address,
      profile.details.unitNo ? `Unit ${profile.details.unitNo}` : null,
    ].filter(Boolean);
    if (addrParts.length > 0) {
      sf('normal', 10, 60);
      doc.text(addrParts.join('  ·  '), W / 2, y, { align: 'center' });
      y += 6;
    }
    if (profile.details.handoverDate) {
      sf('bold', 10, 0);
      doc.text(`Date of Handover:  ${fd(profile.details.handoverDate)}`, W / 2, y, { align: 'center' });
      y += 5;
    }
    if (profile.details.leaseStart) {
      sf('normal', 9, 60);
      doc.text(`Lease Commencement:  ${fd(profile.details.leaseStart)}`, W / 2, y, { align: 'center' });
      y += 5;
    }
    rule(0.4, 0);
    y += 8;

    // ── Parties: side-by-side ─────────────────────────────────────────────
    const halfW = (CW - 6) / 2;
    const lx = ML, rx = ML + halfW + 6;
    const partyY = y;

    sf('bold', 8.5, 0); doc.text('LANDLORD(S)', lx, y); y += 5;
    if (landlordNames.length === 0) { sf('normal', 8.5, 120); doc.text('—', lx, y); y += 5; }
    else { landlordNames.forEach(n => { sf('normal', 8.5, 0); doc.text(n, lx, y); y += 5; }); }

    const leftBottom = y;
    y = partyY;

    sf('bold', 8.5, 0); doc.text('TENANT(S)', rx, y); y += 5;
    if (tenantNames.length === 0) { sf('normal', 8.5, 120); doc.text('—', rx, y); y += 5; }
    else { tenantNames.forEach(n => { sf('normal', 8.5, 0); doc.text(n, rx, y); y += 5; }); }

    const rightBottom = y;
    y = Math.max(leftBottom, rightBottom) + 4;

    doc.setDrawColor(200); doc.setLineWidth(0.2);
    doc.line(ML + halfW + 3, partyY - 2, ML + halfW + 3, y - 2);
    doc.setDrawColor(0);

    rule(0.3, 160); y += 4;

    // Property type only (Security Deposit removed)
    if (profile.details.propertyType) {
      sf('bold', 8, 80); doc.text('Property Type: ', ML, y);
      const kw = doc.getTextWidth('Property Type: ');
      sf('normal', 8, 0); doc.text(profile.details.propertyType.toUpperCase(), ML + kw, y);
      y += 5;
    }
    rule(0.3, 160); y += 6;

    // ── Inventory ──────────────────────────────────────────────────────────
    if (profile.rooms.length > 0) {
      ck(14); sf('bold', 12, 0); doc.text('INVENTORY BY ROOM', ML, y); y += 2; rule(0.5, 0); y += 6;
      let gn = 1;
      profile.rooms.forEach(room => {
        ck(18);
        sf('bold', 9.5, 0); doc.text(room.name.toUpperCase(), ML, y); y += 2;
        rule(0.3, 140); y += 4;
        if (room.items.length === 0) { sf('italic', 8, 150); doc.text('No items recorded.', ML + 2, y); y += 7; return; }

        const c0 = 10, c1 = 54, c2 = 48, c3 = 14, c4 = CW - c0 - c1 - c2 - c3;
        doc.setFillColor(238, 238, 238); doc.rect(ML, y, CW, 6, 'F');
        doc.setDrawColor(180); doc.setLineWidth(0.2); doc.rect(ML, y, CW, 6, 'S');
        sf('bold', 7.5, 0); let cx = ML + 2;
        doc.text('#', cx, y + 4); cx += c0; doc.text('Item Description', cx, y + 4); cx += c1;
        doc.text('Brand / Model', cx, y + 4); cx += c2; doc.text('Qty', cx, y + 4); cx += c3; doc.text('Remarks', cx, y + 4); y += 6;

        room.items.forEach((item, ii) => {
          const rh = 7; ck(rh);
          if (ii % 2 === 1) { doc.setFillColor(250, 250, 250); doc.rect(ML, y, CW, rh, 'F'); }
          doc.setDrawColor(220, 220, 220); doc.setLineWidth(0.15); doc.line(ML, y + rh, W - MR, y + rh);
          cx = ML + 2;
          sf('normal', 8, 100); doc.text(String(gn++), cx, y + 4.8); cx += c0;
          sf('normal', 8, 0); doc.text(doc.splitTextToSize(item.name, c1 - 2)[0], cx, y + 4.8); cx += c1;
          sf('normal', 8, 80); doc.text(doc.splitTextToSize(item.brandModel || '—', c2 - 2)[0], cx, y + 4.8); cx += c2;
          sf('normal', 8, 0); doc.text(item.quantity !== undefined && item.quantity !== null ? String(item.quantity) : '—', cx, y + 4.8); cx += c3;
          sf('normal', 7.5, 80); doc.text(doc.splitTextToSize(item.remarks || '', c4 - 2)[0], cx, y + 4.8); y += rh;
        });
        doc.setDrawColor(180); doc.setLineWidth(0.2); doc.line(ML, y, W - MR, y); y += 10;
      });
    }

    // ── Keys & Access ──────────────────────────────────────────────────────
    if (profile.keys.length > 0) {
      ck(14); sf('bold', 12, 0); doc.text('KEYS & ACCESS ITEMS', ML, y); y += 2; rule(0.5, 0); y += 6;
      SECTIONS.filter(s => profile.keys.some(k => k.section === s)).forEach(sec => {
        const items = profile.keys.filter(k => k.section === sec); ck(14);
        sf('bold', 9.5, 0); doc.text(KEY_SECTION_LABELS[sec], ML, y); y += 2; rule(0.3, 140); y += 4;

        const isMeter = sec === 'meter_readings';
        if (isMeter) {
          const cd = 80, cr = 50;
          doc.setFillColor(238, 238, 238); doc.rect(ML, y, CW, 6, 'F');
          doc.setDrawColor(180); doc.setLineWidth(0.2); doc.rect(ML, y, CW, 6, 'S');
          sf('bold', 7.5, 0); let cx = ML + 2;
          doc.text('Description', cx, y + 4); cx += cd; doc.text('Reading', cx, y + 4); cx += cr; doc.text('Date of Reading', cx, y + 4); y += 6;
          items.forEach((item, ii) => {
            const rh = 7; ck(rh);
            if (ii % 2 === 1) { doc.setFillColor(250, 250, 250); doc.rect(ML, y, CW, rh, 'F'); }
            doc.setDrawColor(220, 220, 220); doc.setLineWidth(0.15); doc.line(ML, y + rh, W - MR, y + rh);
            cx = ML + 2;
            sf('normal', 8, 0); doc.text(doc.splitTextToSize(item.description, cd - 2)[0], cx, y + 4.8); cx += cd;
            doc.text(item.reading || '—', cx, y + 4.8); cx += cr;
            doc.text(fd(item.readingDate), cx, y + 4.8); y += rh;
          });
        } else {
          const dw = 70, rw = 35, qw = 15, rmw = CW - dw - rw - qw;
          doc.setFillColor(238, 238, 238); doc.rect(ML, y, CW, 6, 'F');
          doc.setDrawColor(180); doc.setLineWidth(0.2); doc.rect(ML, y, CW, 6, 'S');
          sf('bold', 7.5, 0); let cx = ML + 2;
          doc.text('Description', cx, y + 4); cx += dw;
          if (sec === 'access_cards') doc.text('Reference', cx, y + 4);
          cx += rw; doc.text('Qty', cx, y + 4); cx += qw; doc.text('Remarks', cx, y + 4); y += 6;
          items.forEach((item, ii) => {
            const rh = 7; ck(rh);
            if (ii % 2 === 1) { doc.setFillColor(250, 250, 250); doc.rect(ML, y, CW, rh, 'F'); }
            doc.setDrawColor(220, 220, 220); doc.setLineWidth(0.15); doc.line(ML, y + rh, W - MR, y + rh);
            cx = ML + 2;
            sf('normal', 8, 0); doc.text(doc.splitTextToSize(item.description, dw - 2)[0], cx, y + 4.8); cx += dw;
            if (sec === 'access_cards') { sf('normal', 8, 80); doc.text(item.reference || '—', cx, y + 4.8); }
            cx += rw; sf('normal', 8, 0);
            doc.text(item.quantity !== undefined && item.quantity !== null ? String(item.quantity) : '—', cx, y + 4.8); cx += qw;
            sf('normal', 7.5, 80); doc.text(doc.splitTextToSize(item.remarks || '', rmw - 2)[0], cx, y + 4.8); y += rh;
          });
        }
        doc.setDrawColor(180); doc.setLineWidth(0.2); doc.line(ML, y, W - MR, y); y += 6;
      });
    }

    // ── Notes + Acknowledgement always start on a fresh page together ──────
    np();

    if (profile.details.notes) {
      sf('bold', 12, 0); doc.text('NOTES', ML, y); y += 2; rule(0.5, 0); y += 5;
      sf('normal', 8.5, 60);
      doc.splitTextToSize(profile.details.notes, CW).forEach((l: string) => { ck(6); doc.text(l, ML, y); y += 5; });
      y += 6;
    }

    ck(20);
    sf('bold', 14, 0); doc.text('ACKNOWLEDGEMENT OF CONDITION', W / 2, y, { align: 'center' }); y += 4; rule(0.5, 0); y += 6;
    sf('normal', 9, 80);
    doc.splitTextToSize('All parties confirm that the above inventory accurately reflects the condition of the property and its contents at the time of handover.', CW)
      .forEach((l: string) => { doc.text(l, ML, y); y += 5; });
    y += 8;

    // Main signature boxes — two columns: Landlord (left), Tenant (right).
    // An agent representing the landlord is stacked under the landlord box(es);
    // an agent representing the tenant is stacked under the tenant box(es).
    // An agent representing "both" appears under both columns.
    const leftSigItems = sigRoles.filter(r =>
      r.role.startsWith('landlord_') || landlordAgents.some(a => `agent_${a._idx}` === r.role));
    const rightSigItems = sigRoles.filter(r =>
      r.role.startsWith('tenant_') || tenantAgents.some(a => `agent_${a._idx}` === r.role));

    const sigH = 30, colGap = 6;
    const sigW = (CW - colGap) / 2;
    const lxCol = ML, rxCol = ML + sigW + colGap;

    const drawSigBox = (sx: number, sy: number, role: string, label: string, defaultName: string) => {
      const sig = profile.signatures.find(s => s.role === role);
      doc.setDrawColor(160); doc.setLineWidth(0.25);
      doc.rect(sx, sy, sigW, sigH, 'S');
      sf('bold', 7.5, 0); doc.text(label, sx + sigW / 2, sy + 5, { align: 'center' });

      if (sig) {
        try { doc.addImage(sig.signatureDataUrl, 'PNG', sx + 6, sy + 6.5, sigW - 12, 11); } catch { /* skip */ }
        sf('normal', 7, 60); doc.text(sig.name, sx + sigW / 2, sy + 21, { align: 'center' });
        doc.setDrawColor(160); doc.setLineWidth(0.2); doc.line(sx + 6, sy + 23.5, sx + sigW - 6, sy + 23.5);
        sf('normal', 6.5, 80); doc.text(fd(sig.date), sx + sigW / 2, sy + 27.5, { align: 'center' });
      } else {
        // Not digitally signed — leave the top blank for a pen signature, but print the
        // known name (if any) so the printed sheet is ready for a manual signature & date.
        doc.setDrawColor(160); doc.setLineWidth(0.2);
        doc.line(sx + 6, sy + 15, sx + sigW - 6, sy + 15);
        sf('normal', 6.5, 140); doc.text('Signature', sx + sigW / 2, sy + 18.5, { align: 'center' });
        if (defaultName && defaultName.trim()) {
          sf('normal', 7, 0); doc.text(defaultName.trim(), sx + sigW / 2, sy + 22, { align: 'center' });
        } else {
          sf('normal', 6.5, 140); doc.text('Name', sx + sigW / 2, sy + 22, { align: 'center' });
        }
        doc.line(sx + 6, sy + 24, sx + sigW - 6, sy + 24);
        sf('normal', 6, 140); doc.text('Date', sx + sigW / 2, sy + 27.5, { align: 'center' });
      }
    };

    const boxGap = 5;
    const leftTotalH = leftSigItems.length > 0 ? leftSigItems.length * sigH + (leftSigItems.length - 1) * boxGap : 0;
    const rightTotalH = rightSigItems.length > 0 ? rightSigItems.length * sigH + (rightSigItems.length - 1) * boxGap : 0;
    ck(Math.max(leftTotalH, rightTotalH));

    const startY = y;
    let leftY = startY, rightY = startY;
    leftSigItems.forEach(({ role, label, defaultName }) => { drawSigBox(lxCol, leftY, role, label, defaultName); leftY += sigH + boxGap; });
    rightSigItems.forEach(({ role, label, defaultName }) => { drawSigBox(rxCol, rightY, role, label, defaultName); rightY += sigH + boxGap; });

    y = Math.max(leftY, rightY);
    if (leftSigItems.length > 0 || rightSigItems.length > 0) y -= boxGap;

    // ── Page footers with compact per-page signature strip ─────────────────
    const tp = (doc as InstanceType<typeof jsPDF> & { internal: { getNumberOfPages: () => number } }).internal.getNumberOfPages();
    const { address, condoName, unitNo, postalCode } = profile.details;
    const addrHasPostal = !!(postalCode && address && address.includes(postalCode));
    const footerAddr = [
      address, condoName,
      unitNo ? `#${unitNo}` : null,
      (!addrHasPostal && postalCode) ? `Singapore ${postalCode}` : null,
    ].filter(Boolean).join(' ');

    for (let pg = 1; pg <= tp; pg++) {
      doc.setPage(pg);

      if (footerRoles.length > 0) {
        const stripW = (CW - (sigStripCols - 1) * 3) / sigStripCols;
        const stripTop = H - 10 - 2 - sigStripH;

        doc.setDrawColor(140); doc.setLineWidth(0.2);
        doc.line(ML, stripTop, W - MR, stripTop);

        // Stacked layout per party: label → signature → name (right under it) → date.
        footerRoles.forEach(({ role, label: slabel, defaultName }, si) => {
          const sc = si % sigStripCols;
          const sr = Math.floor(si / sigStripCols);
          const sx = ML + sc * (stripW + 3);
          const sy = stripTop + 2 + sr * sigStripRowH;
          const sig = profile.signatures.find(s => s.role === role);
          const cx = sx + stripW / 2;

          sf('bold', 5.5, 80);
          doc.text(slabel.toUpperCase(), cx, sy + 2, { align: 'center' });

          if (sig) {
            const imgW = stripW * 0.55;
            try {
              doc.addImage(sig.signatureDataUrl, 'PNG', sx + (stripW - imgW) / 2, sy + 3, imgW, 5.5);
            } catch { /* skip */ }
            doc.setDrawColor(160); doc.setLineWidth(0.1);
            doc.line(sx + stripW * 0.08, sy + 9.5, sx + stripW * 0.92, sy + 9.5);
            sf('normal', 5.5, 40);
            doc.text(doc.splitTextToSize(sig.name, stripW - 2)[0], cx, sy + 12.5, { align: 'center' });
            sf('normal', 5.5, 100);
            doc.text(fd(sig.date), cx, sy + 16, { align: 'center' });
          } else {
            // Not digitally signed — print the known name (if any) so this can be signed & dated by hand.
            doc.setDrawColor(160); doc.setLineWidth(0.15);
            doc.line(sx + stripW * 0.08, sy + 8, sx + stripW * 0.92, sy + 8);
            sf('normal', 5, 160);
            doc.text('Signature', cx, sy + 10.5, { align: 'center' });
            if (defaultName && defaultName.trim()) {
              sf('normal', 5.5, 40);
              doc.text(doc.splitTextToSize(defaultName.trim(), stripW - 2)[0], cx, sy + 13, { align: 'center' });
            }
            doc.line(sx + stripW * 0.08, sy + 14, sx + stripW * 0.92, sy + 14);
            sf('normal', 5, 160);
            doc.text(defaultName && defaultName.trim() ? 'Date' : 'Name / Date', cx, sy + 16.5, { align: 'center' });
          }
        });
      }

      doc.setDrawColor(160); doc.setLineWidth(0.2); doc.line(ML, H - 10, W - MR, H - 10);
      sf('normal', 7, 120);
      doc.text(`Property Inventory  ·  ${footerAddr || ''}`, ML, H - 5);
      doc.text(`Page ${pg} of ${tp}`, W - MR, H - 5, { align: 'right' });
    }

    const filename = `${(profile.details.address || 'property-inventory').replace(/[^a-z0-9]/gi, '_').slice(0, 50)}.pdf`;
    await shareOrDownload(doc.output('blob') as Blob, filename, 'application/pdf', previewWin);
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
              <div className="text-xs text-gray-500">{s.l}</div>
            </div>
          ))}
        </div>
      </div>

      <fieldset disabled={isLocked} className="contents m-0 p-0 border-0 min-w-0">
      {profile.rooms.length > 1 && (
        <div className="bg-white rounded-lg shadow p-4">
          <h2 className="text-lg font-semibold text-gray-900 mb-2">Room Sequence in Report</h2>
          <div className="space-y-2">
            {profile.rooms.map((room, idx) => (
              <div key={room.id} className="flex items-center gap-3 p-2.5 bg-gray-50 rounded-lg">
                <span className="w-6 h-6 rounded-full bg-primary-100 text-primary-700 text-xs font-bold flex items-center justify-center flex-shrink-0">{idx + 1}</span>
                <span className="flex-1 text-sm font-medium text-gray-800">{room.name}</span>
                <div className="flex gap-1">
                  <button onClick={() => reorderRoom(room.id, 'up')} disabled={idx === 0} className="w-7 h-7 flex items-center justify-center rounded bg-white border border-gray-200 text-gray-500 hover:bg-gray-100 disabled:opacity-30 text-xs">▲</button>
                  <button onClick={() => reorderRoom(room.id, 'down')} disabled={idx === profile.rooms.length - 1} className="w-7 h-7 flex items-center justify-center rounded bg-white border border-gray-200 text-gray-500 hover:bg-gray-100 disabled:opacity-30 text-xs">▼</button>
                </div>
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
                <h3 className="font-semibold text-xs text-gray-500 uppercase tracking-wide mb-2">{room.name}</h3>
                {room.items.length === 0 ? <p className="text-xs text-gray-400 pl-2">No items.</p> : (
                  <div className="overflow-x-auto rounded border border-gray-100">
                    <table className="w-full text-xs">
                      <thead><tr className="bg-slate-700 text-white">
                        <th className="text-left px-3 py-2 w-8">#</th>
                        <th className="text-left px-3 py-2">Item</th>
                        <th className="text-left px-3 py-2 w-36">Brand / Model</th>
                        <th className="text-left px-3 py-2 w-16">Qty</th>
                        <th className="text-left px-3 py-2">Remarks</th>
                      </tr></thead>
                      <tbody>{room.items.map((item, ii) => (
                        <tr key={item.id} className={ii % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                          <td className="px-3 py-1.5 text-gray-400">{ii + 1}</td>
                          <td className="px-3 py-1.5 font-medium text-gray-800">{item.name}</td>
                          <td className="px-1 py-1"><input type="text" value={item.brandModel || ''} onChange={e => updateItem(room.id, item.id, { brandModel: e.target.value })} placeholder="—" className="w-full border border-transparent hover:border-gray-200 focus:border-primary-400 rounded px-2 py-0.5 text-xs focus:outline-none bg-transparent focus:bg-white" /></td>
                          <td className="px-1 py-1"><input type="text" inputMode="numeric"
                            value={item.quantity !== undefined && item.quantity !== null ? String(item.quantity) : ''}
                            onChange={e => { const v = e.target.value; if (v === '') updateItem(room.id, item.id, { quantity: undefined }); else { const n = parseInt(v); if (!isNaN(n) && n >= 0) updateItem(room.id, item.id, { quantity: n }); } }}
                            placeholder="—" className="w-full border border-transparent hover:border-gray-200 focus:border-primary-400 rounded px-2 py-0.5 text-xs text-center focus:outline-none bg-transparent focus:bg-white" /></td>
                          <td className="px-1 py-1"><input type="text" value={item.remarks || ''} onChange={e => updateItem(room.id, item.id, { remarks: e.target.value })} placeholder="—" className="w-full border border-transparent hover:border-gray-200 focus:border-primary-400 rounded px-2 py-0.5 text-xs focus:outline-none bg-transparent focus:bg-white" /></td>
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
                    <h3 className="font-semibold text-xs text-gray-500 uppercase tracking-wide mb-2">{sectionLabels[sec]}</h3>
                    <div className="overflow-x-auto rounded border border-gray-100">
                      <table className="w-full text-xs">
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
                                  <input type="text" value={item.reference || ''} onChange={e => updateKey(item.id, { reference: e.target.value })} placeholder="—" className="w-full border border-transparent hover:border-gray-200 focus:border-primary-400 rounded px-2 py-0.5 text-xs focus:outline-none bg-transparent focus:bg-white" />
                                </td>
                              )}
                              {isMeter ? (
                                <>
                                  <td className="px-1 py-1">
                                    <input type="text" value={item.reading || ''} onChange={e => updateKey(item.id, { reading: e.target.value })} placeholder="—" className="w-full border border-transparent hover:border-gray-200 focus:border-primary-400 rounded px-2 py-0.5 text-xs focus:outline-none bg-transparent focus:bg-white" />
                                  </td>
                                  <td className="px-1 py-1">
                                    <input type="date" value={item.readingDate || ''} onChange={e => updateKey(item.id, { readingDate: e.target.value })} className="w-full border border-transparent hover:border-gray-200 focus:border-primary-400 rounded px-2 py-0.5 text-xs focus:outline-none bg-transparent focus:bg-white" />
                                  </td>
                                </>
                              ) : (
                                <>
                                  <td className="px-1 py-1">
                                    <input type="text" inputMode="numeric" value={item.quantity !== undefined && item.quantity !== null ? String(item.quantity) : ''} onChange={e => { const v = e.target.value; if (v === '') updateKey(item.id, { quantity: undefined }); else { const n = parseInt(v); if (!isNaN(n) && n >= 0) updateKey(item.id, { quantity: n }); } }} placeholder="—" className="w-full border border-transparent hover:border-gray-200 focus:border-primary-400 rounded px-2 py-0.5 text-xs text-center focus:outline-none bg-transparent focus:bg-white" />
                                  </td>
                                  <td className="px-1 py-1">
                                    <input type="text" value={item.remarks || ''} onChange={e => updateKey(item.id, { remarks: e.target.value })} placeholder="—" className="w-full border border-transparent hover:border-gray-200 focus:border-primary-400 rounded px-2 py-0.5 text-xs focus:outline-none bg-transparent focus:bg-white" />
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
        <p className="text-sm text-gray-500 mb-4">Each party gets their own pad. The date defaults to the handover date and can be edited. Add more parties on the Property tab.</p>
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
        <p className="text-xs text-gray-400 mb-3">To save or load this property's data, use "Save Work" / "Load File" / "Saved Files" at the top of the page. To clear everything and start over, use "Reset" at the top of the page.</p>
        <button onClick={generatePDF} className="flex items-center gap-3 p-4 bg-primary-50 rounded-lg hover:bg-primary-100 transition-colors text-left w-full sm:w-auto sm:min-w-[280px]">
          <span className="text-2xl">📄</span>
          <div>
            <div className="font-semibold text-primary-700 text-sm">Generate PDF Report</div>
            <div className="text-xs text-primary-500">Printer-friendly A4 — signatures on every page</div>
          </div>
        </button>
      </div>

    </div>
  );
};
