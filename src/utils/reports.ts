// Shared PDF builders for the Inventory Report and Condition Report — pure functions of
// `profile` (no component state needed), so they can be triggered from anywhere: each
// report's own tab, or the global header menu regardless of which tab is active.
import type { PropertyProfile } from '../types';
import { KEY_SECTION_LABELS, GENERAL_AREA_LABEL, OTHERS_AREA_LABEL, agentLabel } from '../types';
import type { KeySection } from '../types';
import { fd } from './date';
import { buildReportFilename, buildPropertyLabel } from './share';
import { recompressDataUrl } from './image';

const SECTIONS: KeySection[] = ['keys', 'access_cards', 'remote_controls', 'others', 'meter_readings'];

export interface BuiltPDF {
  blob: Blob;
  filename: string;
}

export async function buildInventoryReportPDF(profile: PropertyProfile): Promise<BuiltPDF> {
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

  const { default: jsPDF } = await import('jspdf');
  // `compress: true` is required for jsPDF to Flate-compress embedded images (signatures).
  // Without it, PNGs are stored as raw, uncompressed bitmaps — a single ~700x530 signature
  // balloons to well over 1MB apiece, which is why a 3-4 page text report was coming out
  // several megabytes in size.
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
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

  const filename = buildReportFilename(['Inventory Report', buildPropertyLabel(profile.details), tenantNames.join(', ')]);
  // The mobile "preview" flow opens the PDF straight from a blob: URL, which carries no
  // filename metadata — iOS Safari falls back to naming the saved/shared file "Unknown"
  // unless the PDF's own /Title is set, which it then uses as the suggested filename.
  doc.setProperties({ title: filename.replace(/\.pdf$/i, '') });
  return { blob: doc.output('blob') as Blob, filename };
}

// Figure out the image format jsPDF needs from a data URL (defaults to JPEG for camera shots).
const imgFormat = (dataUrl: string): string => {
  const m = /^data:image\/(\w+);/.exec(dataUrl);
  const ext = (m?.[1] || 'jpeg').toLowerCase();
  return ext === 'jpg' ? 'JPEG' : ext.toUpperCase();
};

// How photos are arranged per PDF page, keyed by the "photos per page" choice.
const GRID_LAYOUTS: Record<number, { cols: number; rows: number }> = {
  2: { cols: 2, rows: 1 },
  4: { cols: 2, rows: 2 },
  6: { cols: 2, rows: 3 },
  8: { cols: 2, rows: 4 },
};

export async function buildConditionReportPDF(profile: PropertyProfile, photosPerPage: 2 | 4 | 6 | 8 = 4): Promise<BuiltPDF | null> {
  if (profile.photos.length === 0) return null;

  // Same area grouping as the Condition Report tab: built-in areas (rooms + Others/General)
  // in a fixed order, followed by any custom area names already in use on existing photos.
  const builtInAreas = [...profile.rooms.map(r => r.name), OTHERS_AREA_LABEL, GENERAL_AREA_LABEL];
  const usedCustomAreas = [...new Set(profile.photos.map(p => p.area || GENERAL_AREA_LABEL))].filter(a => !builtInAreas.includes(a));
  const orderedAreas = [...builtInAreas, ...usedCustomAreas];

  const { default: jsPDF } = await import('jspdf');
  // compress: true lets jsPDF Flate-compress embedded images instead of storing them raw.
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  const W = 210, H = 297, ML = 15, MR = 15, MT = 15, MB = 14, GAP = 6;
  const CW = W - ML - MR;

  let y = MT;
  const np = () => { doc.addPage(); y = MT; };
  const sf = (s: 'normal' | 'bold' | 'italic', sz: number, c = 0) => { doc.setFont('helvetica', s); doc.setFontSize(sz); doc.setTextColor(c); };
  const rule = (w = 0.3, color = 180) => { doc.setDrawColor(color); doc.setLineWidth(w); doc.line(ML, y, W - MR, y); doc.setDrawColor(0); doc.setLineWidth(0.2); };

  // Recompress every photo down to the PDF's size/quality budget before embedding —
  // covers photos added under an older, larger/higher-quality setting (or from before
  // this budget existed) so every export comes out small, not just newly-added photos.
  const groups = orderedAreas
    .map(area => ({ area, photos: profile.photos.filter(p => (p.area || GENERAL_AREA_LABEL) === area) }))
    .filter(g => g.photos.length > 0);
  const allPhotos = groups.flatMap(g => g.photos);
  const compressed = await Promise.all(allPhotos.map(p => recompressDataUrl(p.annotatedDataUrl || p.dataUrl)));
  const sizeMap = new Map(allPhotos.map((p, i) => [p.id, { w: compressed[i].w, h: compressed[i].h }]));
  const pdfImageMap = new Map(allPhotos.map((p, i) => [p.id, compressed[i].dataUrl]));

  // ── Cover header ───────────────────────────────────────────────────────
  const addrParts = [profile.details.condoName, profile.details.address, profile.details.unitNo ? `Unit ${profile.details.unitNo}` : null].filter(Boolean);
  sf('bold', 20, 0); doc.text('PROPERTY CONDITION REPORT', W / 2, y + 7, { align: 'center' }); y += 11;
  if (addrParts.length) { sf('normal', 12, 60); doc.text(addrParts.join('  ·  '), W / 2, y, { align: 'center' }); y += 6.5; }
  sf('normal', 10.5, 120); doc.text(`Generated ${fd(new Date().toISOString())}`, W / 2, y, { align: 'center' }); y += 6.5;
  rule(0.5, 0); y += 8;

  const { cols, rows } = GRID_LAYOUTS[photosPerPage];
  const perPage = cols * rows;

  groups.forEach((group, gi) => {
    if (gi > 0) np();

    for (let start = 0; start < group.photos.length; start += perPage) {
      const isCont = start > 0;
      if (isCont) np();

      sf('bold', 14.5, 0);
      doc.text(isCont ? `${group.area} (cont'd)` : group.area, ML, y + 5.5);
      if (!isCont) {
        sf('normal', 10.5, 120);
        doc.text(`${group.photos.length} photo${group.photos.length !== 1 ? 's' : ''}`, W - MR, y + 5.5, { align: 'right' });
      }
      y += 9; rule(0.4, 0); y += 6;

      const chunk = group.photos.slice(start, start + perPage);
      const slotW = (CW - (cols - 1) * GAP) / cols;
      const slotH = (H - MB - y - (rows - 1) * GAP) / rows;
      const captionH = 16;
      const maxImgH = slotH - captionH;

      chunk.forEach((p, idx) => {
        const col = idx % cols, row = Math.floor(idx / cols);
        const sx = ML + col * (slotW + GAP), sy = y + row * (slotH + GAP);
        const size = sizeMap.get(p.id) || { w: 1, h: 1 };
        const scale = Math.min(slotW / size.w, maxImgH / size.h);
        const iw = size.w * scale, ih = size.h * scale;
        const ix = sx + (slotW - iw) / 2, iy = sy + (maxImgH - ih) / 2;

        const pdfImage = pdfImageMap.get(p.id) || p.dataUrl;
        doc.setDrawColor(210); doc.setLineWidth(0.2); doc.rect(sx, sy, slotW, maxImgH, 'S');
        try { doc.addImage(pdfImage, imgFormat(pdfImage), ix, iy, iw, ih); } catch { /* skip unreadable image */ }

        sf('normal', 9.5, 60);
        const capLines = doc.splitTextToSize(p.caption || '—', slotW).slice(0, 2);
        doc.text(capLines, sx, sy + maxImgH + 4.5);
        sf('normal', 8, 140);
        doc.text(fd(p.dateAdded), sx, sy + maxImgH + (capLines.length > 1 ? 13.5 : 9.5));
      });

      y += rows * slotH + (rows - 1) * GAP + 6;
    }
  });

  // ── Footer on every page ─────────────────────────────────────────────
  const tp = (doc as InstanceType<typeof jsPDF> & { internal: { getNumberOfPages: () => number } }).internal.getNumberOfPages();
  for (let pg = 1; pg <= tp; pg++) {
    doc.setPage(pg);
    doc.setDrawColor(160); doc.setLineWidth(0.2); doc.line(ML, H - 10, W - MR, H - 10);
    sf('normal', 8.5, 120);
    doc.text(`Condition Report  ·  ${addrParts.join(' ')}`, ML, H - 5);
    doc.text(`Page ${pg} of ${tp}`, W - MR, H - 5, { align: 'right' });
  }

  const tenantNames = profile.details.tenants.map(t => t.name).filter(Boolean).join(', ');
  const filename = buildReportFilename(['Condition Report', buildPropertyLabel(profile.details), tenantNames]);
  // Same fix as the Inventory Report: set the PDF's own /Title so iOS Safari suggests
  // this filename instead of "Unknown" when saving/sharing from its blob-URL preview.
  doc.setProperties({ title: filename.replace(/\.pdf$/i, '') });
  return { blob: doc.output('blob') as Blob, filename };
}
