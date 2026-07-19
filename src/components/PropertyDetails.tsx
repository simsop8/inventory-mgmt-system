import React, { useState } from 'react';
import { useProperty } from '../store/PropertyContext';
import { PROPERTY_TYPES } from '../types';
import type { AgentInfo } from '../types';
import { calcLeaseEndDate } from '../utils/date';

const inputCls = 'w-full border border-gray-400 rounded-md px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500';
const labelCls = 'block text-base font-medium text-gray-800 mb-1';

export const PropertyDetails: React.FC = () => {
  const { profile, isLocked, updateDetails, addLandlord, updateLandlord, removeLandlord, addTenant, updateTenant, removeTenant, addAgent, updateAgent, removeAgent } = useProperty();
  const { details } = profile;
  const [postalLoading, setPostalLoading] = useState(false);
  const [postalError, setPostalError] = useState('');

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    updateDetails({ [e.target.name]: e.target.value });
  };

  const handlePostalChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.replace(/\D/g, '').slice(0, 6);
    updateDetails({ postalCode: val });
    setPostalError('');
    if (val.length === 6) {
      setPostalLoading(true);
      try {
        const res = await fetch(`https://www.onemap.gov.sg/api/common/elastic/search?searchVal=${val}&returnGeom=N&getAddrDetails=Y&pageNum=1`);
        const data = await res.json();
        if (data.results?.length > 0) {
          const r = data.results[0];
          updateDetails({ address: [r.BLK_NO, r.ROAD_NAME, r.BUILDING, `Singapore ${r.POSTAL}`].filter(Boolean).filter(p => p !== 'NIL').join(', ') });
        } else setPostalError('Postal code not found.');
      } catch { setPostalError('Could not fetch address. Please enter manually.'); }
      finally { setPostalLoading(false); }
    }
  };

  const agents = details.agents || [];

  // Lease Start + Period (months) auto-calculates Lease End (start + N months - 1 day).
  // Editing whichever of Start/Period was last touched recalculates End automatically;
  // editing End directly is treated as a manual override and clears Period so it stops
  // silently recalculating out from under the typed-in date.
  const handleLeaseStartChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    const months = parseInt(details.leasePeriodMonths || '', 10);
    if (val && months > 0) updateDetails({ leaseStart: val, leaseEnd: calcLeaseEndDate(val, months) });
    else updateDetails({ leaseStart: val });
  };
  const handleLeasePeriodChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    const months = parseInt(raw, 10);
    if (details.leaseStart && months > 0) updateDetails({ leasePeriodMonths: raw, leaseEnd: calcLeaseEndDate(details.leaseStart, months) });
    else updateDetails({ leasePeriodMonths: raw });
  };
  const handleLeaseEndChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    updateDetails({ leaseEnd: e.target.value, leasePeriodMonths: '' });
  };

  return (
    <fieldset disabled={isLocked} className="space-y-6 m-0 p-0 border-0 min-w-0">
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Property Information</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Postal Code</label>
            <div className="relative">
              <input type="text" name="postalCode" value={details.postalCode} onChange={handlePostalChange} maxLength={6} placeholder="e.g. 123456" className={inputCls} />
              {postalLoading && <span className="absolute right-3 top-2.5 text-sm text-gray-600 animate-pulse">Looking up...</span>}
            </div>
            {postalError && <p className="text-sm text-red-500 mt-1">{postalError}</p>}
          </div>
          <div>
            <label className={labelCls}>Property Type</label>
            <select name="propertyType" value={details.propertyType} onChange={handleChange} className={inputCls}>
              <option value="">Select type</option>
              {PROPERTY_TYPES.map(pt => <option key={pt.value} value={pt.value}>{pt.label}</option>)}
            </select>
          </div>
          <div className="md:col-span-2">
            <label className={labelCls}>Address</label>
            <input type="text" name="address" value={details.address} onChange={handleChange} placeholder="Auto-filled from postal code, or enter manually" className={inputCls} />
          </div>
          {details.propertyType === 'condo' && (
            <div>
              <label className={labelCls}>Condominium Name</label>
              <input type="text" name="condoName" value={details.condoName || ''} onChange={handleChange} placeholder="e.g. The Sail @ Marina Bay" className={inputCls} />
            </div>
          )}
          <div>
            <label className={labelCls}>Unit No.</label>
            <input type="text" name="unitNo" value={details.unitNo || ''} onChange={handleChange} placeholder="e.g. #12-34" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Handover Date</label>
            <input type="date" name="handoverDate" value={details.handoverDate || ''} onChange={handleChange} className={inputCls} />
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Lease Information</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div><label className={labelCls}>Lease Start Date</label><input type="date" name="leaseStart" value={details.leaseStart || ''} onChange={handleLeaseStartChange} className={inputCls} /></div>
          <div>
            <label className={labelCls}>Lease Period (months)</label>
            <input type="number" min={1} step={1} inputMode="numeric" value={details.leasePeriodMonths || ''} onChange={handleLeasePeriodChange} placeholder="e.g. 24" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>
              Lease End Date{details.leasePeriodMonths ? <span className="text-sm text-gray-600 font-normal"> (auto-calculated)</span> : null}
            </label>
            <input type="date" name="leaseEnd" value={details.leaseEnd || ''} onChange={handleLeaseEndChange} className={inputCls} />
          </div>
          <div><label className={labelCls}>Security Deposit</label><input type="text" name="deposit" value={details.deposit || ''} onChange={handleChange} placeholder="e.g. $7,000" className={inputCls} /></div>
        </div>
        <p className="text-sm text-gray-600 mt-3">Enter a lease period (e.g. 24 months) with a start date to auto-fill the end date — or leave period blank and set the end date yourself.</p>
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Landlord(s)</h2>
          <button onClick={addLandlord} className="text-base text-primary-600 hover:text-primary-700 font-medium">+ Add Landlord</button>
        </div>
        <div className="space-y-3">
          {details.landlords.map((l, idx) => (
            <div key={l.id} className="flex items-center gap-3">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center text-base font-semibold">{idx + 1}</div>
              <input type="text" value={l.name} onChange={e => updateLandlord(l.id, { name: e.target.value })} placeholder="Full name" className={`flex-1 ${inputCls}`} />
              {details.landlords.length > 1 && <button onClick={() => removeLandlord(l.id)} className="text-gray-600 hover:text-red-500 text-xl">×</button>}
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Tenant(s)</h2>
          <button onClick={addTenant} className="text-base text-primary-600 hover:text-primary-700 font-medium">+ Add Tenant</button>
        </div>
        <div className="space-y-3">
          {details.tenants.map((l, idx) => (
            <div key={l.id} className="flex items-center gap-3">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-base font-semibold">{idx + 1}</div>
              <input type="text" value={l.name} onChange={e => updateTenant(l.id, { name: e.target.value })} placeholder="Full name" className={`flex-1 ${inputCls}`} />
              {details.tenants.length > 1 && <button onClick={() => removeTenant(l.id)} className="text-gray-600 hover:text-red-500 text-xl">×</button>}
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Agent(s)</h2>
          <button onClick={addAgent} className="text-base text-primary-600 hover:text-primary-700 font-medium">+ Add Agent</button>
        </div>
        {agents.length === 0 ? (
          <p className="text-base text-gray-600 text-center py-2">No agent added. Click "+ Add Agent" if applicable.</p>
        ) : (
          <div className="space-y-4">
            {agents.map((agent: AgentInfo, idx: number) => (
              <div key={idx} className="border border-gray-300 rounded-lg p-4 relative">
                <button onClick={() => removeAgent(String(idx))} className="absolute top-3 right-3 text-gray-600 hover:text-red-500 text-xl">×</button>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>Agent Name</label>
                    <input type="text" value={agent.name} onChange={e => updateAgent(String(idx), { name: e.target.value })} placeholder="Full name" className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Company Name</label>
                    <input type="text" value={agent.companyName || ''} onChange={e => updateAgent(String(idx), { companyName: e.target.value })} placeholder="e.g. ABC Realty Pte Ltd" className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>RES Licence No.</label>
                    <input type="text" value={agent.resLicenseNo || ''} onChange={e => updateAgent(String(idx), { resLicenseNo: e.target.value })} placeholder="e.g. R012345A" className={inputCls} />
                  </div>
                  <div className="md:col-span-2">
                    <label className={labelCls}>Acting For</label>
                    <div className="flex gap-4 mt-1">
                      {(['landlord', 'tenant', 'both'] as const).map(v => (
                        <label key={v} className="flex items-center gap-1.5 cursor-pointer">
                          <input type="radio" name={`sf-${idx}`} value={v} checked={(agent.servingFor || 'both') === v} onChange={() => updateAgent(String(idx), { servingFor: v })} />
                          <span className="text-base text-gray-800 capitalize">{v === 'both' ? 'Both Parties' : v.charAt(0).toUpperCase() + v.slice(1)}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Additional Notes</h2>
        <textarea name="notes" value={details.notes || ''} onChange={handleChange} rows={4} placeholder="Any additional notes..." className={inputCls} />
      </div>
    </fieldset>
  );
};
