import React, { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import type { PropertyProfile, PropertyDetails, Room, InventoryItem, KeyItem, Photo, Signature, Person, AgentInfo, TakeoverData } from '../types';
import { createEmptyProfile, createEmptyTakeover, DEFAULT_KEY_ITEM_LISTS } from '../types';

const STORAGE_KEY = 'property-inventory-profile';

function loadFromStorage(): PropertyProfile {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createEmptyProfile();
    const parsed = JSON.parse(raw) as PropertyProfile;
    if (parsed?.id && parsed?.details) {
      // Backward compat: older auto-saves predate the Takeover feature.
      if (!parsed.takeover) parsed.takeover = createEmptyTakeover();
      return parsed;
    }
  } catch { /* ignore */ }
  return createEmptyProfile();
}

function saveToStorage(profile: PropertyProfile) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  } catch (e) {
    // Storage full (likely large photos) — save without photo data as fallback
    try {
      const slim = { ...profile, photos: [] };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(slim));
      console.warn('Auto-save: photos omitted due to storage limit. Use "Save Work" to export the full profile.');
    } catch { /* ignore */ }
  }
}

interface PropertyContextType {
  profile: PropertyProfile;
  // True once at least one party has signed. While locked, editing the property's
  // data is blocked everywhere — clear every signature (on the Report tab) to unlock.
  isLocked: boolean;
  updateDetails: (d: Partial<PropertyDetails>) => void;
  addLandlord: () => void;
  updateLandlord: (id: string, u: Partial<Person>) => void;
  removeLandlord: (id: string) => void;
  addTenant: () => void;
  updateTenant: (id: string, u: Partial<Person>) => void;
  removeTenant: (id: string) => void;
  addAgent: () => void;
  updateAgent: (idx: string, u: Partial<AgentInfo>) => void;
  removeAgent: (idx: string) => void;
  addRoom: (name: string) => void;
  updateRoom: (id: string, u: Partial<Room>) => void;
  deleteRoom: (id: string) => void;
  reorderRoom: (id: string, dir: 'up' | 'down') => void;
  reorderRoomTo: (id: string, newIndex: number) => void;
  addItem: (roomId: string, item: Omit<InventoryItem, 'id'>) => void;
  updateItem: (roomId: string, itemId: string, u: Partial<InventoryItem>) => void;
  deleteItem: (roomId: string, itemId: string) => void;
  addKey: (key: Omit<KeyItem, 'id'>) => void;
  updateKey: (id: string, u: Partial<KeyItem>) => void;
  deleteKey: (id: string) => void;
  setKeyItemList: (section: string, items: string[]) => void;
  setRoomItemList: (roomType: string, items: string[]) => void;
  renameGlobalItem: (oldName: string, newName: string) => void;
  addPhoto: (photo: Omit<Photo, 'id' | 'dateAdded'>) => void;
  updatePhoto: (id: string, u: Partial<Photo>) => void;
  deletePhoto: (id: string) => void;
  addSignature: (sig: Omit<Signature, 'id'>) => void;
  deleteSignature: (id: string) => void;
  clearAllSignatures: () => void;
  // Property Takeover (end-of-tenancy) — separate record & signature set from the move-in inventory above.
  isTakeoverLocked: boolean;
  updateTakeover: (u: Partial<TakeoverData>) => void;
  addTakeoverSignature: (sig: Omit<Signature, 'id'>) => void;
  deleteTakeoverSignature: (id: string) => void;
  clearAllTakeoverSignatures: () => void;
  exportProfile: () => string;
  importProfile: (json: string) => boolean;
  resetProfile: () => void;
}

const PropertyContext = createContext<PropertyContextType | null>(null);

export const PropertyProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [profile, setProfile] = useState<PropertyProfile>(loadFromStorage);
  const t = (p: PropertyProfile): PropertyProfile => ({ ...p, updatedAt: new Date().toISOString() });

  // Auto-save to localStorage on every change
  useEffect(() => { saveToStorage(profile); }, [profile]);

  const updateDetails = useCallback((d: Partial<PropertyDetails>) =>
    setProfile(p => t({ ...p, details: { ...p.details, ...d } })), []);

  const addLandlord = useCallback(() =>
    setProfile(p => t({ ...p, details: { ...p.details, landlords: [...p.details.landlords, { id: crypto.randomUUID(), name: '' }] } })), []);
  const updateLandlord = useCallback((id: string, u: Partial<Person>) =>
    setProfile(p => t({ ...p, details: { ...p.details, landlords: p.details.landlords.map(l => l.id === id ? { ...l, ...u } : l) } })), []);
  const removeLandlord = useCallback((id: string) =>
    setProfile(p => t({ ...p, details: { ...p.details, landlords: p.details.landlords.filter(l => l.id !== id) } })), []);

  const addTenant = useCallback(() =>
    setProfile(p => t({ ...p, details: { ...p.details, tenants: [...p.details.tenants, { id: crypto.randomUUID(), name: '' }] } })), []);
  const updateTenant = useCallback((id: string, u: Partial<Person>) =>
    setProfile(p => t({ ...p, details: { ...p.details, tenants: p.details.tenants.map(l => l.id === id ? { ...l, ...u } : l) } })), []);
  const removeTenant = useCallback((id: string) =>
    setProfile(p => t({ ...p, details: { ...p.details, tenants: p.details.tenants.filter(l => l.id !== id) } })), []);

  const addAgent = useCallback(() =>
    setProfile(p => t({ ...p, details: { ...p.details, agents: [...(p.details.agents || []), { name: '', servingFor: 'both' as const }] } })), []);
  const updateAgent = useCallback((idx: string, u: Partial<AgentInfo>) => {
    const i = parseInt(idx);
    setProfile(p => { const a = [...(p.details.agents || [])]; a[i] = { ...a[i], ...u }; return t({ ...p, details: { ...p.details, agents: a } }); });
  }, []);
  const removeAgent = useCallback((idx: string) => {
    const i = parseInt(idx);
    setProfile(p => t({ ...p, details: { ...p.details, agents: (p.details.agents || []).filter((_, j) => j !== i) } }));
  }, []);

  const addRoom = useCallback((name: string) =>
    setProfile(p => t({ ...p, rooms: [...p.rooms, { id: crypto.randomUUID(), name, items: [], order: p.rooms.length }] })), []);
  const updateRoom = useCallback((id: string, u: Partial<Room>) =>
    setProfile(p => t({ ...p, rooms: p.rooms.map(r => r.id === id ? { ...r, ...u } : r) })), []);
  const deleteRoom = useCallback((id: string) =>
    setProfile(p => t({ ...p, rooms: p.rooms.filter(r => r.id !== id).map((r, i) => ({ ...r, order: i })) })), []);
  const reorderRoom = useCallback((id: string, dir: 'up' | 'down') =>
    setProfile(p => {
      const rooms = [...p.rooms];
      const i = rooms.findIndex(r => r.id === id);
      const j = dir === 'up' ? i - 1 : i + 1;
      if (i < 0 || j < 0 || j >= rooms.length) return p;
      [rooms[i], rooms[j]] = [rooms[j], rooms[i]];
      return t({ ...p, rooms: rooms.map((r, k) => ({ ...r, order: k })) });
    }), []);
  // Moves a room directly to an arbitrary index — used by press-and-drag reordering,
  // where the drop target can be more than one slot away from the start.
  const reorderRoomTo = useCallback((id: string, newIndex: number) =>
    setProfile(p => {
      const rooms = [...p.rooms];
      const i = rooms.findIndex(r => r.id === id);
      if (i < 0) return p;
      const clamped = Math.max(0, Math.min(newIndex, rooms.length - 1));
      if (clamped === i) return p;
      const [moved] = rooms.splice(i, 1);
      rooms.splice(clamped, 0, moved);
      return t({ ...p, rooms: rooms.map((r, k) => ({ ...r, order: k })) });
    }), []);

  const addItem = useCallback((roomId: string, item: Omit<InventoryItem, 'id'>) =>
    setProfile(p => t({ ...p, rooms: p.rooms.map(r => r.id === roomId ? { ...r, items: [...r.items, { ...item, id: crypto.randomUUID() }] } : r) })), []);
  const updateItem = useCallback((roomId: string, itemId: string, u: Partial<InventoryItem>) =>
    setProfile(p => t({ ...p, rooms: p.rooms.map(r => r.id === roomId ? { ...r, items: r.items.map(i => i.id === itemId ? { ...i, ...u } : i) } : r) })), []);
  const deleteItem = useCallback((roomId: string, itemId: string) =>
    setProfile(p => t({ ...p, rooms: p.rooms.map(r => r.id === roomId ? { ...r, items: r.items.filter(i => i.id !== itemId) } : r) })), []);

  const addKey = useCallback((key: Omit<KeyItem, 'id'>) =>
    setProfile(p => t({ ...p, keys: [...p.keys, { ...key, id: crypto.randomUUID() }] })), []);
  const updateKey = useCallback((id: string, u: Partial<KeyItem>) =>
    setProfile(p => t({ ...p, keys: p.keys.map(k => k.id === id ? { ...k, ...u } : k) })), []);
  const deleteKey = useCallback((id: string) =>
    setProfile(p => t({ ...p, keys: p.keys.filter(k => k.id !== id) })), []);
  const setKeyItemList = useCallback((section: string, items: string[]) =>
    setProfile(p => t({ ...p, keyItemLists: { ...(p.keyItemLists || {}), [section]: items } })), []);
  const setRoomItemList = useCallback((roomType: string, items: string[]) =>
    setProfile(p => t({ ...p, roomItemLists: { ...(p.roomItemLists || {}), [roomType]: items } })), []);
  const renameGlobalItem = useCallback((oldName: string, newName: string) => {
    if (!oldName || !newName || oldName === newName) return;
    setProfile(p => {
      const rooms = p.rooms.map(r => ({
        ...r,
        items: r.items.map(i => i.name === oldName ? { ...i, name: newName } : i),
      }));
      const roomItemLists: Record<string, string[]> = {};
      for (const [k, v] of Object.entries(p.roomItemLists || {})) {
        roomItemLists[k] = v.map(n => n === oldName ? newName : n);
      }
      return t({ ...p, rooms, roomItemLists });
    });
  }, []);

  const addPhoto = useCallback((photo: Omit<Photo, 'id' | 'dateAdded'>) =>
    setProfile(p => t({ ...p, photos: [...p.photos, { ...photo, id: crypto.randomUUID(), dateAdded: new Date().toISOString() }] })), []);
  const updatePhoto = useCallback((id: string, u: Partial<Photo>) =>
    setProfile(p => t({ ...p, photos: p.photos.map(ph => ph.id === id ? { ...ph, ...u } : ph) })), []);
  const deletePhoto = useCallback((id: string) =>
    setProfile(p => t({ ...p, photos: p.photos.filter(ph => ph.id !== id) })), []);

  const addSignature = useCallback((sig: Omit<Signature, 'id'>) =>
    setProfile(p => t({ ...p, signatures: [...p.signatures.filter(s => s.role !== sig.role), { ...sig, id: crypto.randomUUID() }] })), []);
  const deleteSignature = useCallback((id: string) =>
    setProfile(p => t({ ...p, signatures: p.signatures.filter(s => s.id !== id) })), []);
  const clearAllSignatures = useCallback(() =>
    setProfile(p => t({ ...p, signatures: [] })), []);

  const updateTakeover = useCallback((u: Partial<TakeoverData>) =>
    setProfile(p => t({ ...p, takeover: { ...(p.takeover || createEmptyTakeover()), ...u } })), []);
  const addTakeoverSignature = useCallback((sig: Omit<Signature, 'id'>) =>
    setProfile(p => {
      const takeover = p.takeover || createEmptyTakeover();
      return t({ ...p, takeover: { ...takeover, signatures: [...takeover.signatures.filter(s => s.role !== sig.role), { ...sig, id: crypto.randomUUID() }] } });
    }), []);
  const deleteTakeoverSignature = useCallback((id: string) =>
    setProfile(p => {
      const takeover = p.takeover || createEmptyTakeover();
      return t({ ...p, takeover: { ...takeover, signatures: takeover.signatures.filter(s => s.id !== id) } });
    }), []);
  const clearAllTakeoverSignatures = useCallback(() =>
    setProfile(p => t({ ...p, takeover: { ...(p.takeover || createEmptyTakeover()), signatures: [] } })), []);

  const exportProfile = useCallback(() => JSON.stringify(profile, null, 2), [profile]);
  const importProfile = useCallback((json: string): boolean => {
    try {
      const parsed = JSON.parse(json) as PropertyProfile & { details: PropertyDetails & { agent?: AgentInfo } };
      if (!parsed || typeof parsed !== 'object') return false;
      if (!parsed.id || !parsed.details) return false;
      // Ensure all array fields exist
      if (!Array.isArray(parsed.rooms)) parsed.rooms = [];
      if (!Array.isArray(parsed.keys)) parsed.keys = [];
      if (!Array.isArray(parsed.photos)) parsed.photos = [];
      if (!Array.isArray(parsed.signatures)) parsed.signatures = [];
      // Ensure details sub-fields exist
      if (!Array.isArray(parsed.details.landlords)) parsed.details.landlords = [];
      if (!Array.isArray(parsed.details.tenants)) parsed.details.tenants = [];
      // Backward compat: single agent → agents array
      if (!parsed.details.agents) {
        parsed.details.agents = parsed.details.agent ? [parsed.details.agent] : [];
        delete parsed.details.agent;
      }
      if (!parsed.keyItemLists) parsed.keyItemLists = { ...DEFAULT_KEY_ITEM_LISTS };
      if (!parsed.roomItemLists) parsed.roomItemLists = {};
      // Backward compat: older saved files predate the Takeover feature.
      if (!parsed.takeover) parsed.takeover = createEmptyTakeover();
      if (!Array.isArray(parsed.takeover.keys)) parsed.takeover.keys = [];
      if (!Array.isArray(parsed.takeover.documents)) parsed.takeover.documents = [];
      if (!Array.isArray(parsed.takeover.rooms)) parsed.takeover.rooms = [];
      if (!Array.isArray(parsed.takeover.deductions)) parsed.takeover.deductions = [];
      if (!Array.isArray(parsed.takeover.signatures)) parsed.takeover.signatures = [];
      setProfile({ ...parsed, updatedAt: new Date().toISOString() });
      return true;
    } catch { return false; }
  }, []);
  const resetProfile = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setProfile(createEmptyProfile());
  }, []);

  return (
    <PropertyContext.Provider value={{
      profile, isLocked: profile.signatures.length > 0, updateDetails,
      addLandlord, updateLandlord, removeLandlord,
      addTenant, updateTenant, removeTenant,
      addAgent, updateAgent, removeAgent,
      addRoom, updateRoom, deleteRoom, reorderRoom, reorderRoomTo,
      addItem, updateItem, deleteItem,
      addKey, updateKey, deleteKey, setKeyItemList,
      setRoomItemList, renameGlobalItem,
      addPhoto, updatePhoto, deletePhoto,
      addSignature, deleteSignature, clearAllSignatures,
      isTakeoverLocked: (profile.takeover?.signatures.length || 0) > 0,
      updateTakeover, addTakeoverSignature, deleteTakeoverSignature, clearAllTakeoverSignatures,
      exportProfile, importProfile, resetProfile,
    }}>
      {children}
    </PropertyContext.Provider>
  );
};

export const useProperty = () => {
  const ctx = useContext(PropertyContext);
  if (!ctx) throw new Error('useProperty must be used within PropertyProvider');
  return ctx;
};
