import React, { useRef, useState } from 'react';
import { useProperty } from '../store/PropertyContext';
import type { Photo } from '../types';

export const PhotosTab: React.FC = () => {
  const { profile, isLocked, addPhoto, deletePhoto } = useProperty();
  const [caption, setCaption] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);

  const processFiles = (files: FileList | null) => {
    if (!files) return;
    Array.from(files).forEach(file => {
      const reader = new FileReader();
      reader.onload = ev => { addPhoto({ dataUrl: ev.target?.result as string, caption: caption || undefined }); setCaption(''); };
      reader.readAsDataURL(file);
    });
    if (fileRef.current) fileRef.current.value = '';
    if (camRef.current) camRef.current.value = '';
  };

  const handleDownload = (photo: Photo) => {
    const a = document.createElement('a');
    a.href = photo.dataUrl; a.download = `photo-${photo.id.slice(0, 8)}.jpg`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  };

  return (
    <div className="space-y-6">
      <fieldset disabled={isLocked} className="bg-white rounded-lg shadow p-4 m-0 min-w-0 border-0">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Add Photos</h2>
        <p className="text-base text-gray-700 mb-4">Upload photos of the property, rooms, items, or any damage documentation.</p>
        <div className="space-y-4">
          <div>
            <label className="block text-base font-medium text-gray-800 mb-1">Caption (optional)</label>
            <input type="text" value={caption} onChange={e => setCaption(e.target.value)} placeholder="e.g. Living room condition, Kitchen appliance damage"
              className="w-full border border-gray-400 rounded-md px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-primary-500" />
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <label className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg border-2 border-dashed transition-colors ${isLocked ? 'bg-gray-50 text-gray-600 border-gray-300 cursor-not-allowed' : 'bg-primary-50 text-primary-700 border-primary-200 cursor-pointer hover:bg-primary-100'}`}>
              <span className="text-xl">🖼️</span><span className="font-medium text-base">Choose from Library</span>
              <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={e => processFiles(e.target.files)} />
            </label>
            <label className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg border-2 border-dashed transition-colors ${isLocked ? 'bg-gray-50 text-gray-600 border-gray-300 cursor-not-allowed' : 'bg-green-50 text-green-700 border-green-200 cursor-pointer hover:bg-green-100'}`}>
              <span className="text-xl">📷</span><span className="font-medium text-base">Take a Photo</span>
              <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={e => processFiles(e.target.files)} />
            </label>
          </div>
          <p className="text-sm text-gray-600">On mobile, "Take a Photo" opens your camera directly.</p>
        </div>
      </fieldset>
      {profile.photos.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-8 text-center text-gray-600 text-base">No photos uploaded yet.</div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {profile.photos.map(photo => (
            <div key={photo.id} className="bg-white rounded-lg shadow overflow-hidden">
              <div className="aspect-square bg-gray-100"><img src={photo.dataUrl} alt={photo.caption || 'Property photo'} className="w-full h-full object-cover" /></div>
              <div className="p-3">
                {photo.caption && <p className="text-base text-gray-800 truncate mb-1">{photo.caption}</p>}
                <p className="text-sm text-gray-600 mb-2">{new Date(photo.dateAdded).toLocaleDateString()}</p>
                <div className="flex gap-2">
                  <button onClick={() => handleDownload(photo)} className="flex-1 text-sm px-2 py-1 text-gray-700 bg-gray-100 rounded hover:bg-gray-200">Download</button>
                  <button onClick={() => { if (confirm('Delete this photo?')) deletePhoto(photo.id); }} disabled={isLocked} className="flex-1 text-sm px-2 py-1 text-red-600 bg-red-50 rounded hover:bg-red-100 disabled:opacity-40 disabled:cursor-not-allowed">Delete</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
