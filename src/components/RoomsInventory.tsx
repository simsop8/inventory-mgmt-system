import React, { useRef, useState } from 'react';
import { useProperty } from '../store/PropertyContext';
import type { InventoryItem } from '../types';
import { STANDARD_ROOMS, STANDARD_INVENTORY, detectRoomType } from '../types';
import { useDragReorder } from '../utils/dragReorder';

// ── List manager (edit the item template for a room type) ───────────────────
const ListManager: React.FC<{
  roomType: string;
  items: string[];
  onSave: (items: string[], renames: Array<{ from: string; to: string }>) => void;
  onClose: () => void;
}> = ({ roomType, items, onSave, onClose }) => {
    const [list, setList] = useState([...items]);
    const [newItem, setNewItem] = useState('');
    const [editIdx, setEditIdx] = useState<number | null>(null);
    const [editVal, setEditVal] = useState('');
    const [renames, setRenames] = useState<Array<{ from: string; to: string }>>([]);

    const addItem = () => { if (newItem.trim() && !list.includes(newItem.trim())) { setList([...list, newItem.trim()]); setNewItem(''); } };
    const startEdit = (i: number) => { setEditIdx(i); setEditVal(list[i]); };
    const commitEdit = () => {
      if (editIdx !== null && editVal.trim() && editVal.trim() !== list[editIdx]) {
        const oldName = list[editIdx];
        const newName = editVal.trim();
        const l = [...list];
        l[editIdx] = newName;
        setList(l);
        setRenames(r => [...r, { from: oldName, to: newName }]);
      }
      setEditIdx(null);
    };
    const remove = (i: number) => setList(list.filter((_, j) => j !== i));

    return (
      <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
        <div className="flex items-center justify-between mb-1">
          <span className="text-sm font-semibold text-yellow-800">Edit Item Template — {roomType}</span>
          <button onClick={onClose} className="text-gray-600 hover:text-gray-700 text-lg leading-none">×</button>
        </div>
        <p className="text-sm text-yellow-700 mb-2">Renames apply globally to all existing rooms. New items only apply when adding future rooms.</p>
        {renames.length > 0 && (
          <div className="mb-2 p-2 bg-orange-50 border border-orange-200 rounded text-sm text-orange-700">
            {renames.length} rename{renames.length > 1 ? 's' : ''} will update all existing rooms on save.
          </div>
        )}
        <div className="space-y-1 max-h-48 overflow-y-auto mb-2">
          {list.map((item, i) => (
            <div key={i} className="flex items-center gap-1">
              {editIdx === i ? (
                <input autoFocus type="text" value={editVal} onChange={e => setEditVal(e.target.value)}
                  onBlur={commitEdit} onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditIdx(null); }}
                  className="flex-1 border border-primary-400 rounded px-2 py-0.5 text-sm focus:outline-none" />
              ) : (
                <span className="flex-1 text-sm text-gray-800 truncate">{item}</span>
              )}
              <button onClick={() => startEdit(i)} className="text-gray-600 hover:text-primary-500 text-sm px-1" title="Rename (applies globally)">✎</button>
              <button onClick={() => remove(i)} className="text-gray-600 hover:text-red-500 text-sm px-1" title="Remove">×</button>
            </div>
          ))}
        </div>
        <div className="flex gap-1 mb-2">
          <input type="text" value={newItem} onChange={e => setNewItem(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addItem()}
            placeholder="Add item to template..." className="flex-1 border border-gray-400 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary-500" />
          <button onClick={addItem} disabled={!newItem.trim()} className="px-2 py-1 text-sm text-white bg-primary-600 rounded hover:bg-primary-700 disabled:opacity-40">Add</button>
        </div>
        <div className="flex gap-1">
          <button onClick={() => { onSave(list, renames); onClose(); }} className="flex-1 py-1.5 text-sm text-white bg-primary-600 rounded hover:bg-primary-700">Save Template</button>
          <button onClick={onClose} className="px-3 py-1.5 text-sm text-gray-700 bg-white border border-gray-400 rounded hover:bg-gray-50">Cancel</button>
        </div>
      </div>
    );
  };

// ── Item row ────────────────────────────────────────────────────────────────
interface ItemRowProps {
  item: InventoryItem;
  onUpdate: (u: Partial<InventoryItem>) => void;
  onDelete: () => void;
}

const ItemRow: React.FC<ItemRowProps> = ({ item, onUpdate, onDelete }) => {
  const [editingName, setEditingName] = useState(false);
  const [nameVal, setNameVal] = useState(item.name);
  const commit = () => { if (nameVal.trim()) onUpdate({ name: nameVal.trim() }); else setNameVal(item.name); setEditingName(false); };
  return (
    <div className="flex items-center gap-2 p-2 bg-white border border-gray-300 rounded-lg">
      <div className="w-36 flex-shrink-0">
        {editingName ? (
          <input autoFocus type="text" value={nameVal} onChange={e => setNameVal(e.target.value)}
            onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setNameVal(item.name); setEditingName(false); } }}
            className="w-full border border-primary-400 rounded px-2 py-1 text-sm focus:outline-none" />
        ) : (
          <button onClick={() => setEditingName(true)} title="Click to rename" className="text-base font-medium text-gray-800 hover:text-primary-600 w-full text-left truncate">{item.name}</button>
        )}
      </div>
      <input type="text" value={item.brandModel || ''} onChange={e => onUpdate({ brandModel: e.target.value })} placeholder="Brand / Model"
        className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary-500 min-w-0" />
      <input type="text" inputMode="numeric"
        value={item.quantity === undefined || item.quantity === null ? '' : String(item.quantity)}
        onChange={e => { const v = e.target.value; if (v === '') onUpdate({ quantity: undefined }); else { const n = parseInt(v); if (!isNaN(n) && n >= 0) onUpdate({ quantity: n }); } }}
        placeholder="Qty" className="w-14 border border-gray-300 rounded px-2 py-1 text-sm text-center focus:outline-none focus:ring-1 focus:ring-primary-500 flex-shrink-0" />
      <input type="text" value={item.remarks || ''} onChange={e => onUpdate({ remarks: e.target.value })} placeholder="Remarks"
        className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary-500 min-w-0" />
      <button onClick={onDelete} className="text-gray-600 hover:text-red-500 text-lg leading-none flex-shrink-0">×</button>
    </div>
  );
};

// ── Add item form ───────────────────────────────────────────────────────────
const AddItemForm: React.FC<{ itemList: string[]; existingItems: InventoryItem[]; onAdd: (item: Omit<InventoryItem, 'id'>) => void; onClose: () => void }> =
  ({ itemList, existingItems, onAdd, onClose }) => {
    const [selected, setSelected] = useState('');
    const [custom, setCustom] = useState('');
    const [isCustom, setIsCustom] = useState(false);
    const handleAdd = () => {
      const name = isCustom ? custom.trim() : selected;
      if (!name) return;
      onAdd({ name, brandModel: '', quantity: undefined, remarks: undefined, photos: [] });
      setSelected(''); setCustom(''); setIsCustom(false); onClose();
    };
    const available = itemList.filter(n => !existingItems.some(i => i.name === n));
    return (
      <div className="mt-2 p-3 bg-blue-50 border border-blue-200 rounded-lg">
        <div className="flex gap-4 mb-2">
          <label className="flex items-center gap-1 text-sm text-gray-700 cursor-pointer"><input type="radio" checked={!isCustom} onChange={() => setIsCustom(false)} /> From list</label>
          <label className="flex items-center gap-1 text-sm text-gray-700 cursor-pointer"><input type="radio" checked={isCustom} onChange={() => setIsCustom(true)} /> Custom</label>
        </div>
        <div className="flex gap-2">
          {isCustom ? (
            <input autoFocus type="text" value={custom} onChange={e => setCustom(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') onClose(); }}
              placeholder="Enter item name" className="flex-1 border border-gray-400 rounded px-2 py-1.5 text-base focus:outline-none focus:ring-2 focus:ring-primary-500" />
          ) : (
            <select value={selected} onChange={e => setSelected(e.target.value)} className="flex-1 border border-gray-400 rounded px-2 py-1.5 text-base focus:outline-none focus:ring-2 focus:ring-primary-500">
              <option value="">Select item...</option>
              {available.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          )}
          <button onClick={handleAdd} disabled={isCustom ? !custom.trim() : !selected} className="px-3 py-1.5 text-base text-white bg-primary-600 rounded hover:bg-primary-700 disabled:opacity-40">Add</button>
          <button onClick={onClose} className="px-3 py-1.5 text-base text-gray-700 bg-white border border-gray-400 rounded hover:bg-gray-50">Cancel</button>
        </div>
      </div>
    );
  };

// ── Main component ──────────────────────────────────────────────────────────
export const RoomsInventory: React.FC = () => {
  const { profile, isLocked, addRoom, deleteRoom, updateRoom, addItem, updateItem, deleteItem, reorderRoomTo, setRoomItemList, renameGlobalItem } = useProperty();
  const [selectedRoom, setSelectedRoom] = useState('');
  const [customRoomName, setCustomRoomName] = useState('');
  const [isCustomRoom, setIsCustomRoom] = useState(false);
  const [expandedRoom, setExpandedRoom] = useState<string | null>(null);
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [editingRoomId, setEditingRoomId] = useState<string | null>(null);
  const [editingRoomName, setEditingRoomName] = useState('');
  const [managingListFor, setManagingListFor] = useState<string | null>(null);
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const { dragId, startDrag, getRowStyle } = useDragReorder(profile.rooms.length, reorderRoomTo);

  const available = STANDARD_ROOMS.filter(r => !profile.rooms.some(pr => pr.name === r));

  const getRoomItemList = (roomName: string): string[] => {
    const roomType = detectRoomType(roomName);
    return (profile.roomItemLists || {})[roomType] ?? STANDARD_INVENTORY[roomType] ?? [];
  };

  const handleAddRoom = () => {
    const name = isCustomRoom ? customRoomName.trim() : selectedRoom;
    if (!name) return;
    addRoom(name);
    setExpandedRoom(name);
    setSelectedRoom(''); setCustomRoomName(''); setIsCustomRoom(false);
  };

  const startEditRoom = (id: string, name: string) => { setEditingRoomId(id); setEditingRoomName(name); };
  const commitRoomName = (id: string) => { if (editingRoomName.trim()) updateRoom(id, { name: editingRoomName.trim() }); setEditingRoomId(null); };

  return (
    <fieldset disabled={isLocked} className="space-y-4 m-0 p-0 border-0 min-w-0">
      <div className="bg-white rounded-lg shadow p-4">
        <h2 className="text-base font-semibold text-gray-900 mb-3">Add Room</h2>
        <div className="flex gap-3 mb-2">
          <label className="flex items-center gap-1 text-base text-gray-700 cursor-pointer"><input type="radio" checked={!isCustomRoom} onChange={() => setIsCustomRoom(false)} /> From list</label>
          <label className="flex items-center gap-1 text-base text-gray-700 cursor-pointer"><input type="radio" checked={isCustomRoom} onChange={() => setIsCustomRoom(true)} /> Custom name</label>
        </div>
        <div className="flex gap-2">
          {isCustomRoom ? (
            <input type="text" value={customRoomName} onChange={e => setCustomRoomName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAddRoom()}
              placeholder="Enter room name" className="flex-1 border border-gray-400 rounded-md px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-primary-500" />
          ) : (
            <select value={selectedRoom} onChange={e => setSelectedRoom(e.target.value)} className="flex-1 border border-gray-400 rounded-md px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-primary-500">
              <option value="">Select a room to add...</option>
              {available.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          )}
          <button onClick={handleAddRoom} disabled={isCustomRoom ? !customRoomName.trim() : !selectedRoom}
            className="px-4 py-2 text-base font-medium text-white bg-primary-600 rounded-md hover:bg-primary-700 disabled:opacity-40">
            Add Room
          </button>
        </div>
        <p className="text-sm text-gray-600 mt-2">Use "+ Add Item" inside each room to pick from the pre-set item list for that room type.</p>
      </div>

      {profile.rooms.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-8 text-center text-gray-600 text-base">No rooms added yet.</div>
      ) : profile.rooms.map((room, ri) => {
        const roomType = detectRoomType(room.name);
        const itemList = getRoomItemList(room.name);
        return (
          <div
            key={room.id}
            ref={el => { if (el) rowRefs.current.set(room.id, el); else rowRefs.current.delete(room.id); }}
            className="bg-white rounded-lg shadow overflow-hidden"
            style={getRowStyle(room.id, ri)}
          >
            <div className="flex items-center gap-2 px-4 py-3 bg-gray-50 border-b border-gray-400">
              <button
                type="button"
                onPointerDown={e => {
                  if (isLocked) return;
                  setExpandedRoom(null); // collapse everyone first so every row shares one height during the drag
                  startDrag(e, room.id, ri, rowRefs.current.get(room.id) || null);
                }}
                className={`w-8 h-8 flex-shrink-0 flex items-center justify-center text-gray-700 hover:text-gray-800 hover:bg-gray-200 rounded touch-none ${dragId === room.id ? 'cursor-grabbing text-primary-600' : 'cursor-grab'}`}
                title="Press and drag to reorder"
                aria-label="Drag to reorder room"
              >
                <span className="text-xl leading-none select-none">⠿</span>
              </button>

              {editingRoomId === room.id ? (
                <input autoFocus type="text" value={editingRoomName} onChange={e => setEditingRoomName(e.target.value)}
                  onBlur={() => commitRoomName(room.id)}
                  onKeyDown={e => { if (e.key === 'Enter') commitRoomName(room.id); if (e.key === 'Escape') setEditingRoomId(null); }}
                  className="flex-1 border border-primary-400 rounded px-2 py-1 text-base font-semibold focus:outline-none"
                />
              ) : (
                <div className="flex-1 flex items-center gap-2 cursor-pointer select-none" onClick={() => setExpandedRoom(expandedRoom === room.id ? null : room.id)}>
                  <span className="text-gray-600 text-sm">{expandedRoom === room.id ? '▼' : '▶'}</span>
                  <span
                    className={`font-semibold text-gray-900 ${isLocked ? '' : 'hover:text-primary-600 cursor-text'}`}
                    onDoubleClick={e => { if (isLocked) return; e.stopPropagation(); startEditRoom(room.id, room.name); }}
                    title={isLocked ? undefined : 'Double-click to rename'}
                  >{room.name}</span>
                  <span className="text-sm text-gray-600 bg-gray-200 px-2 py-0.5 rounded-full">{room.items.length} item{room.items.length !== 1 ? 's' : ''}</span>
                </div>
              )}

              <button
                onClick={e => { e.stopPropagation(); setManagingListFor(managingListFor === room.id ? null : room.id); if (expandedRoom !== room.id) setExpandedRoom(room.id); }}
                className="text-sm text-gray-600 hover:text-gray-700 border border-gray-300 rounded px-2 py-0.5"
                title={`Edit item template for ${roomType}`}
              >Edit List</button>
              <button onClick={() => startEditRoom(room.id, room.name)} className="text-gray-600 hover:text-primary-500 text-sm px-1" title="Rename room">✎</button>
              <button onClick={() => { if (confirm(`Delete "${room.name}"?`)) deleteRoom(room.id); }} className="text-gray-600 hover:text-red-500 text-xl px-1">×</button>
            </div>

            {expandedRoom === room.id && (
              <div className="p-4 bg-gray-50 space-y-2">
                {managingListFor === room.id && (
                  <ListManager
                    roomType={roomType}
                    items={itemList}
                    onSave={(newList, renames) => {
                      setRoomItemList(roomType, newList);
                      renames.forEach(({ from, to }) => renameGlobalItem(from, to));
                    }}
                    onClose={() => setManagingListFor(null)}
                  />
                )}
                {room.items.length > 0 && (
                  <div className="flex items-center gap-2 px-2 pb-1">
                    <span className="w-36 flex-shrink-0 text-sm font-medium text-gray-700">Item <span className="font-normal text-gray-600">(click to rename)</span></span>
                    <span className="flex-1 text-sm font-medium text-gray-700 min-w-0">Brand / Model</span>
                    <span className="w-14 text-sm font-medium text-gray-700 text-center flex-shrink-0">Qty</span>
                    <span className="flex-1 text-sm font-medium text-gray-700 min-w-0">Remarks</span>
                    <span className="w-5 flex-shrink-0"></span>
                  </div>
                )}
                {room.items.map(item => (
                  <ItemRow key={item.id} item={item} onUpdate={u => updateItem(room.id, item.id, u)} onDelete={() => { if (confirm(`Delete "${item.name}"?`)) deleteItem(room.id, item.id); }} />
                ))}
                {addingTo === room.id ? (
                  <AddItemForm itemList={itemList} existingItems={room.items} onAdd={item => addItem(room.id, item)} onClose={() => setAddingTo(null)} />
                ) : (
                  <button onClick={() => setAddingTo(room.id)} className="w-full mt-1 py-2 text-base text-primary-600 border-2 border-dashed border-primary-200 rounded-lg hover:bg-primary-50 transition-colors">+ Add Item</button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </fieldset>
  );
};
