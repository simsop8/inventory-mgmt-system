// A small, app-agnostic JSON format for moving Condition Report photos between this app
// and the sibling "Report Anything Anywhere Anytime" app, which shares the same
// photo-capture/annotate/PDF architecture but has its own (richer, annotation-capable)
// photo model. This format is the lowest common denominator both apps can produce and
// consume: a flat list of photos (composite image, area, caption, date) plus a few
// shared property fields. Keep this file's shape in sync with the copy in the other
// app's `src/utils/conditionReportExchange.ts`.
import type { PropertyProfile, Photo } from '../types';

export const CONDITION_REPORT_EXCHANGE_FORMAT = 'condition-report-exchange';
export const CONDITION_REPORT_EXCHANGE_VERSION = 1;

export interface ConditionReportExchangePhoto {
  id: string;
  area: string;
  dataUrl: string;
  caption?: string;
  dateAdded: string;
}

export interface ConditionReportExchange {
  format: typeof CONDITION_REPORT_EXCHANGE_FORMAT;
  version: typeof CONDITION_REPORT_EXCHANGE_VERSION;
  exportedFrom: 'inventory-mgmt' | 'report-anything';
  exportedAt: string;
  details: { condoName?: string; address?: string; unitNo?: string };
  photos: ConditionReportExchangePhoto[];
}

export function buildConditionReportExport(profile: PropertyProfile): ConditionReportExchange {
  return {
    format: CONDITION_REPORT_EXCHANGE_FORMAT,
    version: CONDITION_REPORT_EXCHANGE_VERSION,
    exportedFrom: 'inventory-mgmt',
    exportedAt: new Date().toISOString(),
    details: {
      condoName: profile.details.condoName || undefined,
      address: profile.details.address || undefined,
      unitNo: profile.details.unitNo || undefined,
    },
    photos: profile.photos.map(p => ({
      id: p.id,
      area: p.area || 'General',
      dataUrl: p.dataUrl,
      caption: p.caption,
      dateAdded: p.dateAdded,
    })),
  };
}

// Returns null if the text isn't a recognizable Condition Report Exchange file.
export function parseConditionReportImport(text: string): ConditionReportExchange | null {
  try {
    const data = JSON.parse(text);
    if (!data || typeof data !== 'object') return null;
    if (data.format !== CONDITION_REPORT_EXCHANGE_FORMAT) return null;
    if (!Array.isArray(data.photos)) return null;
    return data as ConditionReportExchange;
  } catch {
    return null;
  }
}

// Maps the exchange format's photos into this app's own Photo shape, ready for addPhotos().
export function exchangeToPhotos(exchange: ConditionReportExchange): Array<Omit<Photo, 'id'>> {
  return exchange.photos
    .filter(p => typeof p.dataUrl === 'string' && p.dataUrl.startsWith('data:'))
    .map(p => ({
      dataUrl: p.dataUrl,
      area: p.area || 'General',
      caption: p.caption,
      dateAdded: p.dateAdded || new Date().toISOString(),
    }));
}
