export interface Photo {
  id: string;
  dataUrl: string;
  caption?: string;
  // Which room/area this condition-report photo belongs to. Falls back to
  // GENERAL_AREA_LABEL when not tied to a specific room (entrance, exterior, etc.).
  area?: string;
  dateAdded: string;
}

// Catch-all areas for condition-report photos that aren't tied to a specific room.
export const GENERAL_AREA_LABEL = 'General / Exterior';
export const OTHERS_AREA_LABEL = 'Others (Keys, Remotes, etc.)';

export interface InventoryItem {
  id: string;
  name: string;
  brandModel?: string;
  quantity?: number;
  remarks?: string;
  photos: Photo[];
}

export interface Room {
  id: string;
  name: string;
  items: InventoryItem[];
  order: number;
}

export type KeySection = 'keys' | 'access_cards' | 'remote_controls' | 'others' | 'meter_readings';

export interface KeyItem {
  id: string;
  section: KeySection;
  description: string;
  quantity?: number;
  reference?: string;
  remarks?: string;
  reading?: string;
  readingDate?: string;
}

export interface Person {
  id: string;
  name: string;
}

export interface AgentInfo {
  name: string;
  companyName?: string;
  resLicenseNo?: string;
  servingFor?: 'landlord' | 'tenant' | 'both';
}

export interface PropertyDetails {
  postalCode: string;
  unitNo?: string;
  address: string;
  propertyType: string;
  condoName?: string;
  handoverDate?: string;
  leaseStart?: string;
  leasePeriodMonths?: string;
  leaseEnd?: string;
  deposit?: string;
  landlords: Person[];
  tenants: Person[];
  agents: AgentInfo[];
  notes?: string;
}

export interface Signature {
  id: string;
  role: string;
  name: string;
  signatureDataUrl: string;
  date: string;
}

// ── Property Takeover (end-of-tenancy handover back to landlord) ────────────
// Same format as the SRI CRM's "Property Handover Form" (End of Tenancy).
export interface TakeoverKeyItem {
  id: string;
  description: string;
  quantity?: number;
  remarks?: string;
}

export type TakeoverDocumentStatus = '' | 'Submitted' | 'Pending' | 'N/A';

export interface TakeoverDocument {
  id: string;
  name: string;
  status: TakeoverDocumentStatus;
  remarks?: string;
}

export interface TakeoverRoomNote {
  id: string;
  area: string;
  remarks?: string;
}

export interface TakeoverDeduction {
  id: string;
  description: string;
  amount?: number;
}

export type TakeoverSignatoryRole = 'Landlord' | "Landlord's Rep" | 'Tenant' | "Tenant's Rep";

export interface TakeoverData {
  inspectionDate?: string;
  monthlyRent?: string;
  securityDeposit?: string;
  repairThreshold?: string;
  llSignatoryRole?: 'Landlord' | "Landlord's Rep";
  teSignatoryRole?: 'Tenant' | "Tenant's Rep";
  keys: TakeoverKeyItem[];
  documents: TakeoverDocument[];
  rooms: TakeoverRoomNote[];
  deductions: TakeoverDeduction[];
  refundAccountName?: string;
  refundBank?: string;
  refundAccountNo?: string;
  refundRemarks?: string;
  signatures: Signature[];
}

export const createEmptyTakeover = (): TakeoverData => ({
  keys: [],
  documents: [],
  rooms: [],
  deductions: [],
  signatures: [],
});

export const TAKEOVER_KEY_PRESETS = [
  'Main Door Key', 'Back Door Key', 'Access Card', 'Gate Remote Control',
  'Car Park Transponder', 'Mailbox Key', 'Bedroom Key', 'Others',
];

export const TAKEOVER_DOCUMENT_PRESETS = [
  'Curtain Cleaning Receipt', 'Aircon Servicing Receipt', 'Quarterly Aircon Service Chits',
  'Apartment Cleaning Receipt', 'Gas Servicing Receipt', 'Pest Control Receipt',
  'Handover Inventory List', 'Utility Final Reading',
];

export const TAKEOVER_AREA_PRESETS = [
  'Living Room', 'Dining Room', 'Master Bedroom', 'Bedroom 2', 'Bedroom 3', 'Bedroom 4',
  'Kitchen', 'Master Bathroom', 'Common Bathroom', 'Bathroom 3', 'Balcony', 'Store Room',
  'Utility Room', 'Common Areas / Corridor', 'Entrance / Foyer',
];

export const DEFAULT_KEY_ITEM_LISTS: Record<string, string[]> = {
  keys: ['Main Door Key', 'Gate Key', 'Bedroom Key', 'Store Room Key', 'Mailbox Key', 'Car Park Gantry Key'],
  access_cards: ['Main Entrance', 'Carpark', 'Gym', 'Swimming Pool', 'Clubhouse', 'Management Office', 'Letterbox', 'Lift', 'Side Gate'],
  remote_controls: ['Air Conditioner Remote', 'TV Remote', 'Gate Remote', 'Ceiling Fan Remote', 'Alarm Fob'],
  others: ['Manual', 'Warranty Card', 'Document'],
  meter_readings: ['Electricity Meter Reading', 'Water Meter Reading', 'Gas Meter Reading'],
};

export interface PropertyProfile {
  id: string;
  createdAt: string;
  updatedAt: string;
  details: PropertyDetails;
  rooms: Room[];
  keys: KeyItem[];
  photos: Photo[];
  signatures: Signature[];
  keyItemLists: Record<string, string[]>;
  roomItemLists: Record<string, string[]>;
  // End-of-tenancy takeover record — independent of the move-in inventory/signatures above.
  takeover: TakeoverData;
}

// Signature-block / label text for an agent — uses their company name when set
// (so multi-agent forms read "ABC Realty" / "XYZ Property" instead of the generic
// "Agent 1" / "Agent 2"), falling back to the generic label when no company name
// has been entered.
export function agentLabel(agent: AgentInfo | undefined, idx: number, total: number): string {
  const company = agent?.companyName?.trim();
  if (company) return company;
  return total > 1 ? `Agent ${idx + 1}` : 'Agent';
}

export function detectRoomType(name: string): string {
  const trimmed = name.trim();
  if (STANDARD_INVENTORY[trimmed]) return trimmed;
  const lower = trimmed.toLowerCase();
  const ci = Object.keys(STANDARD_INVENTORY).find(k => k.toLowerCase() === lower);
  if (ci) return ci;
  if (/master\s*bath|master\s*toilet/i.test(lower)) return 'Master Bathroom';
  if (/bath|toilet|wc|washroom/i.test(lower)) return 'Common Bathroom';
  if (/master\s*bed/i.test(lower)) return 'Master Bedroom';
  if (/bed/i.test(lower)) return 'Bedroom 2';
  if (/kitchen/i.test(lower)) return 'Kitchen';
  if (/living/i.test(lower)) return 'Living Room';
  if (/dining/i.test(lower)) return 'Dining Room';
  if (/study/i.test(lower)) return 'Study Room';
  if (/balcon/i.test(lower)) return 'Balcony';
  if (/store|storage/i.test(lower)) return 'Store Room';
  if (/utility/i.test(lower)) return 'Utility Room';
  if (/helper/i.test(lower)) return "Helper's Room";
  return 'Others';
}

export const createEmptyProfile = (): PropertyProfile => {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    details: {
      postalCode: '',
      address: '',
      propertyType: '',
      landlords: [{ id: crypto.randomUUID(), name: '' }],
      tenants: [{ id: crypto.randomUUID(), name: '' }],
      agents: [],
    },
    rooms: [],
    keys: [],
    photos: [],
    signatures: [],
    keyItemLists: { ...DEFAULT_KEY_ITEM_LISTS },
    roomItemLists: {},
    takeover: createEmptyTakeover(),
  };
};

export const PROPERTY_TYPES = [
  { value: 'hdb', label: 'HDB' },
  { value: 'condo', label: 'Condominium (Private)' },
  { value: 'landed', label: 'Landed' },
  { value: 'commercial', label: 'Commercial' },
  { value: 'other', label: 'Other' },
];

export const STANDARD_ROOMS = [
  'Living Room', 'Dining Room', 'Master Bedroom', 'Bedroom 2', 'Bedroom 3',
  'Bedroom 4', 'Bedroom 5', 'Master Bathroom', 'Common Bathroom', 'Kitchen',
  'Utility Room', 'Store Room', 'Balcony', 'Study Room', "Helper's Room", 'Others',
];

export const STANDARD_INVENTORY: Record<string, string[]> = {
  'Living Room': ['Sofa', 'Armchair', 'Coffee Table', 'Side Table', 'TV Console', 'TV', 'Curtains', 'Blinds', 'Ceiling Fan', 'Air Conditioner', 'Carpet', 'Display Cabinet', 'Bookshelf', 'Shoe Cabinet', 'Shoe Rack'],
  'Dining Room': ['Dining Table', 'Dining Chairs', 'Display Cabinet', 'Bar Cabinet', 'Ceiling Fan', 'Chandelier', 'Curtains'],
  'Master Bedroom': ['Bed Frame', 'Mattress', 'Headboard', 'Wardrobe', 'Dressing Table', 'Dressing Mirror', 'Bedside Table', 'Air Conditioner', 'Ceiling Fan', 'Curtains', 'Blinds', 'Study Desk', 'Study Chair', 'TV', 'TV Console'],
  'Bedroom 2': ['Bed Frame', 'Mattress', 'Wardrobe', 'Bedside Table', 'Study Desk', 'Study Chair', 'Air Conditioner', 'Ceiling Fan', 'Curtains', 'Blinds'],
  'Bedroom 3': ['Bed Frame', 'Mattress', 'Wardrobe', 'Bedside Table', 'Study Desk', 'Study Chair', 'Air Conditioner', 'Ceiling Fan', 'Curtains', 'Blinds'],
  'Bedroom 4': ['Bed Frame', 'Mattress', 'Wardrobe', 'Bedside Table', 'Study Desk', 'Study Chair', 'Air Conditioner', 'Ceiling Fan', 'Curtains', 'Blinds'],
  'Bedroom 5': ['Bed Frame', 'Mattress', 'Wardrobe', 'Bedside Table', 'Study Desk', 'Study Chair', 'Air Conditioner', 'Ceiling Fan', 'Curtains', 'Blinds'],
  'Master Bathroom': ['Water Heater', 'Mirror', 'Mirror Cabinet', 'Towel Rail', 'Toilet Bowl', 'Basin', 'Basin Cabinet', 'Shower Screen', 'Bathtub', 'Exhaust Fan'],
  'Common Bathroom': ['Water Heater', 'Mirror', 'Mirror Cabinet', 'Towel Rail', 'Toilet Bowl', 'Basin', 'Basin Cabinet', 'Shower Screen', 'Exhaust Fan'],
  'Kitchen': ['Refrigerator', 'Washing Machine', 'Dryer', 'Washer-Dryer Combo', 'Oven', 'Microwave', 'Range Hood', 'Hob', 'Dishwasher', 'Water Purifier', 'Kitchen Cabinet', 'Sink', 'Dish Rack'],
  'Utility Room': ['Washing Machine', 'Dryer', 'Washer-Dryer Combo', 'Storage Cabinet', 'Shelving'],
  'Store Room': ['Storage Cabinet', 'Shelving', 'Storage Rack'],
  'Balcony': ['Ceiling Fan', 'Outdoor Table', 'Outdoor Chairs', 'Clothes Rack', 'Laundry Rack'],
  'Study Room': ['Study Desk', 'Study Chair', 'Bookshelf', 'Filing Cabinet', 'Air Conditioner', 'Ceiling Fan', 'Curtains'],
  "Helper's Room": ['Bed Frame', 'Mattress', 'Wardrobe', 'Ceiling Fan', 'Curtains'],
  'Others': ['Item', 'Washer', 'Dryer'],
};

export const KEY_SECTION_LABELS: Record<KeySection, string> = {
  keys: 'Keys',
  access_cards: 'Access Cards',
  remote_controls: 'Remote Controls & Fobs',
  others: 'Others',
  meter_readings: 'Meter Readings',
};

export const SECTIONS_WITH_DROPDOWNS: KeySection[] = ['keys', 'access_cards', 'remote_controls', 'others'];
