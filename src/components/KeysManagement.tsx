import React, { useState } from 'react';
import { useProperty } from '../store/PropertyContext';
import type { KeyItem, KeySection } from '../types';
import { KEY_SECTION_LABELS, SECTIONS_WITH_DROPDOWNS, DEFAULT_KEY_ITEM_LISTS } from '../types';

const inputCls = 'w-full border border-gray-400 rounded-md px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-primary-500';
const SECTIONS: KeySection[] = ['keys', 'access_cards', 'remote_controls', 'others', 'meter_readings'];

// ── Dropdown list manager ───────────────────────────────────────────────────
const ListManager: React.FC<{ items: string[]; onSave: (items: string[]) => void; onClose: () => void }> = ({ items, onSave, onClose }) => {
  const [list, setList] = useState([...items]);
  const [newItem, setNewItem] = useState('');
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [editVal, setEditVal] = useState('');

  const addItem = () => { if (newItem.trim() && !list.includes(newItem.trim())) { setList([...list, newItem.trim()]); setNewItem(''); } };
  const startEdit = (i: number) => { setEditIdx(i); setEditVal(list[i]); };
  const commitEdit = () => {
    if (editIdx !== null && editVal.trim()) { const l = [...list]; l[editIdx] = editVal.trim(); setList(l); }
    setEditIdx(null);
  };
  const remove = (i: number) => setList(list.filter((_, j) => j !== i));

  return (
    <div className="mt-2 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-semibold text-yellow-800">Edit Dropdown List</span>
        <button onClick={onClose} className="text-gray-600 hover:text-gray-700 text-lg leading-none">×</button>
      </div>
      <div className="space-y-1 max-h-40 overflow-y-auto mb-2">
        {list.map((item, i) => (
          <div key={i} className="flex items-center gap-1">
            {editIdx === i ? (
              <input autoFocus type="text" value={editVal} onChange={e => setEditVal(e.target.value)}
                onBlur={commitEdit} onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditIdx(null); }}
                className="flex-1 border border-primary-400 rounded px-2 py-0.5 text-sm focus:outline-none" />
            ) : (
              <span className="flex-1 text-sm text-gray-800 truncate">{item}</span>
            )}
            <button onClick={() => startEdit(i)} className="text-gray-600 hover:text-primary-500 text-sm px-1" title="Rename">✎</button>
            <button onClick={() => remove(i)} className="text-gray-600 hover:text-red-500 text-sm px-1" title="Delete">×</button>
          </div>
        ))}
      </div>
      <div className="flex gap-1 mb-2">
        <input type="text" value={newItem} onChange={e => setNewItem(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addItem()}
          placeholder="Add new item..." className="flex-1 border border-gray-400 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary-500" />
        <button onClick={addItem} disabled={!newItem.trim()} className="px-2 py-1 text-sm text-white bg-primary-600 rounded hover:bg-primary-700 disabled:opacity-40">Add</button>
      </div>
      <div className="flex gap-1">
        <button onClick={() => { onSave(list); onClose(); }} className="flex-1 py-1.5 text-sm text-white bg-primary-600 rounded hover:bg-primary-700">Save List</button>
        <button onClick={onClose} className="px-3 py-1.5 text-sm text-gray-700 bg-white border border-gray-400 rounded hover:bg-gray-50">Cancel</button>
      </div>
    </div>
  );
};

// ── Key row (display + inline edit) ────────────────────────────────────────
const KeyRow: React.FC<{ item: KeyItem; itemList: string[]; onUpdate: (u: Partial<KeyItem>) => void; onDelete: () => void }> =
  ({ item, itemList, onUpdate, onDelete }) => {
    const [editing, setEditing] = useState(false);
    const isMeter = item.section === 'meter_readings';
    const isAccessCard = item.section === 'access_cards';

    if (!editing) {
      return (
        <div className="flex items-start justify-between p-3 bg-white border border-gray-300 rounded-lg">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-base text-gray-800">{item.description}</span>
              {!isMeter && item.quantity !== undefined && item.quantity !== null && (
                <span className="text-sm text-gray-600 bg-gray-100 px-2 py-0.5 rounded-full">x{item.quantity}</span>
              )}
            </div>
            <div className="text-sm text-gray-600 mt-1 space-y-0.5">
              {isMeter && item.reading && <div>Reading: {item.reading}</div>}
              {isMeter && item.readingDate && <div>Date: {item.readingDate}</div>}
              {isAccessCard && item.reference && <div>Ref: {item.reference}</div>}
              {item.remarks && <div>{item.remarks}</div>}
            </div>
          </div>
          <div className="flex gap-1 ml-2 flex-shrink-0">
            <button onClick={() => setEditing(true)} className="text-gray-600 hover:text-primary-600 px-1.5 py-1 text-base">✏️</button>
            <button onClick={onDelete} className="text-gray-600 hover:text-red-500 px-1.5 py-1 text-base">🗑️</button>
          </div>
        </div>
      );
    }

    return (
      <div className="p-3 bg-primary-50 border border-primary-200 rounded-lg space-y-2">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            {isMeter ? (
              <select value={item.description} onChange={e => onUpdate({ description: e.target.value })} className={inputCls}>
                {itemList.map(t => <option key={t} value={t}>{t}</option>)}
                <option value="Custom">Custom...</option>
              </select>
            ) : (
              <select value={item.description} onChange={e => onUpdate({ description: e.target.value })} className={inputCls}>
                {itemList.map(t => <option key={t} value={t}>{t}</option>)}
                <option value="">— Type custom below —</option>
              </select>
            )}
          </div>
          {isMeter ? (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Meter Reading</label>
                <input type="text" value={item.reading || ''} onChange={e => onUpdate({ reading: e.target.value })} placeholder="e.g. 12345.6" className={inputCls} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Date of Reading</label>
                <input type="date" value={item.readingDate || ''} onChange={e => onUpdate({ readingDate: e.target.value })} className={inputCls} />
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Quantity <span className="text-gray-600 font-normal">(optional)</span></label>
                <input type="text" inputMode="numeric"
                  value={item.quantity === undefined || item.quantity === null ? '' : String(item.quantity)}
                  onChange={e => { const v = e.target.value; if (v === '') onUpdate({ quantity: undefined }); else { const n = parseInt(v); if (!isNaN(n) && n >= 0) onUpdate({ quantity: n }); } }}
                  placeholder="—" className={inputCls} />
              </div>
              {isAccessCard && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Reference No.</label>
                  <input type="text" value={item.reference || ''} onChange={e => onUpdate({ reference: e.target.value })} placeholder="Card number or ID" className={inputCls} />
                </div>
              )}
              <div className={isAccessCard ? '' : 'md:col-span-2'}>
                <label className="block text-sm font-medium text-gray-700 mb-1">Remarks</label>
                <input type="text" value={item.remarks || ''} onChange={e => onUpdate({ remarks: e.target.value })} placeholder="Optional..." className={inputCls} />
              </div>
            </>
          )}
        </div>
        <button onClick={() => setEditing(false)} className="text-base text-primary-600 font-medium hover:text-primary-800">Done</button>
      </div>
    );
  };

// ── Add form ────────────────────────────────────────────────────────────────
const AddKeyForm: React.FC<{ section: KeySection; itemList: string[]; onAdd: (item: Omit<KeyItem, 'id'>) => void; onClose: () => void }> =
  ({ section, itemList, onAdd, onClose }) => {
    const isMeter = section === 'meter_readings';
    const isAccessCard = section === 'access_cards';

    const [description, setDescription] = useState(isMeter ? (itemList[0] || '') : '');
    const [quantity, setQuantity] = useState<number | undefined>(undefined);
    const [reference, setReference] = useState('');
    const [remarks, setRemarks] = useState('');
    const [reading, setReading] = useState('');
    const [readingDate, setReadingDate] = useState('');
    const [customDesc, setCustomDesc] = useState('');

    const finalDesc = description || customDesc;

    const handleAdd = () => {
      if (!finalDesc) return;
      onAdd({
        section,
        description: finalDesc,
        quantity: isMeter ? undefined : quantity,
        reference: isAccessCard ? reference || undefined : undefined,
        remarks: remarks || undefined,
        reading: isMeter ? reading || undefined : undefined,
        readingDate: isMeter ? readingDate || undefined : undefined,
      });
      onClose();
    };

    return (
      <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg space-y-3">
        <div className="flex justify-between items-center">
          <span className="text-base font-medium text-blue-800">New Entry</span>
          <button onClick={onClose} className="text-gray-600 hover:text-gray-700 text-lg leading-none">×</button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Description *</label>
            <select value={description} onChange={e => setDescription(e.target.value)} className={inputCls}>
              <option value="">Select...</option>
              {itemList.map(t => <option key={t} value={t}>{t}</option>)}
              <option value="__custom__">— Custom —</option>
            </select>
            {description === '__custom__' && (
              <input type="text" value={customDesc} onChange={e => setCustomDesc(e.target.value)} placeholder="Enter custom description" className={`${inputCls} mt-1`} />
            )}
          </div>
          {isMeter ? (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Meter Reading</label>
                <input type="text" value={reading} onChange={e => setReading(e.target.value)} placeholder="e.g. 12345.6" className={inputCls} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Date of Reading</label>
                <input type="date" value={readingDate} onChange={e => setReadingDate(e.target.value)} className={inputCls} />
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Quantity <span className="text-gray-600 font-normal">(optional)</span></label>
                <input type="text" inputMode="numeric"
                  value={quantity === undefined ? '' : String(quantity)}
                  onChange={e => { const v = e.target.value; if (v === '') setQuantity(undefined); else { const n = parseInt(v); if (!isNaN(n) && n >= 0) setQuantity(n); } }}
                  placeholder="—" className={inputCls} />
              </div>
              {isAccessCard && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Reference No.</label>
                  <input type="text" value={reference} onChange={e => setReference(e.target.value)} placeholder="Card number or ID" className={inputCls} />
                </div>
              )}
              <div className={isAccessCard ? '' : 'md:col-span-2'}>
                <label className="block text-sm font-medium text-gray-700 mb-1">Remarks</label>
                <input type="text" value={remarks} onChange={e => setRemarks(e.target.value)} placeholder="Optional..." className={inputCls} />
              </div>
            </>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-base text-gray-700 bg-white border border-gray-400 rounded-md hover:bg-gray-50">Cancel</button>
          <button onClick={handleAdd} disabled={!finalDesc && !customDesc}
            className="px-3 py-1.5 text-base text-white bg-primary-600 rounded-md hover:bg-primary-700 disabled:opacity-50">Add</button>
        </div>
      </div>
    );
  };

// ── Main component ──────────────────────────────────────────────────────────
export const KeysManagement: React.FC = () => {
  const { profile, isLocked, addKey, updateKey, deleteKey, setKeyItemList } = useProperty();
  const [addingTo, setAddingTo] = useState<KeySection | null>(null);
  const [managingList, setManagingList] = useState<KeySection | null>(null);

  const lists = { ...DEFAULT_KEY_ITEM_LISTS, ...(profile.keyItemLists || {}) };

  return (
    <fieldset disabled={isLocked} className="space-y-4 m-0 p-0 border-0 min-w-0">
      {SECTIONS.map(section => {
        const items = profile.keys.filter(k => k.section === section);
        const itemList = lists[section] || [];
        const hasDropdown = SECTIONS_WITH_DROPDOWNS.includes(section);
        return (
          <div key={section} className="bg-white rounded-lg shadow overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-300 bg-gray-50">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-gray-900 text-base">{KEY_SECTION_LABELS[section]}</h3>
                {items.length > 0 && <span className="text-sm text-gray-600 bg-gray-200 px-2 py-0.5 rounded-full">{items.length}</span>}
              </div>
              <div className="flex items-center gap-2">
                {hasDropdown && (
                  <button onClick={() => setManagingList(managingList === section ? null : section)} className="text-sm text-gray-600 hover:text-gray-700 border border-gray-300 rounded px-2 py-0.5" title="Edit dropdown list">Edit List</button>
                )}
                <button onClick={() => setAddingTo(addingTo === section ? null : section)} className="text-base text-primary-600 hover:text-primary-700 font-medium">+ Add</button>
              </div>
            </div>
            <div className="p-4">
              {items.length === 0 && addingTo !== section && managingList !== section && (
                <p className="text-sm text-gray-600 text-center py-2">No entries yet.</p>
              )}
              <div className="space-y-2">
                {items.map(item => (
                  <KeyRow key={item.id} item={item} itemList={itemList}
                    onUpdate={u => updateKey(item.id, u)}
                    onDelete={() => { if (confirm('Delete this entry?')) deleteKey(item.id); }}
                  />
                ))}
              </div>
              {managingList === section && (
                <ListManager
                  items={itemList}
                  onSave={newList => setKeyItemList(section, newList)}
                  onClose={() => setManagingList(null)}
                />
              )}
              {addingTo === section && (
                <AddKeyForm section={section} itemList={itemList} onAdd={item => { addKey(item); setAddingTo(null); }} onClose={() => setAddingTo(null)} />
              )}
            </div>
          </div>
        );
      })}
    </fieldset>
  );
};
