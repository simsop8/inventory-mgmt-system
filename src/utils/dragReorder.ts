import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';

// A lightweight press-and-slide reorder gesture for vertical lists (touch + mouse),
// used in place of up/down buttons. Touch a row's drag handle and slide it up or
// down; neighbouring rows slide out of the way live, and the new position commits
// on release.
//
// Callers should collapse any expandable content before a drag starts so every row
// shares the same height — the shift math below assumes a uniform row height
// (measured from the row being dragged) for simplicity and reliability.
export function useDragReorder(itemCount: number, onReorder: (id: string, newIndex: number) => void) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState(0);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const dragStartIndex = useRef(0);
  const dragStartY = useRef(0);
  const rowHeight = useRef(56);
  const dragOverIndexRef = useRef<number | null>(null);

  const startDrag = useCallback((e: ReactPointerEvent, id: string, index: number, rowEl: HTMLElement | null) => {
    e.preventDefault();
    rowHeight.current = rowEl?.getBoundingClientRect().height || 56;
    dragStartY.current = e.clientY;
    dragStartIndex.current = index;
    dragOverIndexRef.current = index;
    setDragId(id);
    setDragOverIndex(index);
    setDragOffset(0);
  }, []);

  useEffect(() => {
    if (!dragId) return;
    const onMove = (e: PointerEvent) => {
      const delta = e.clientY - dragStartY.current;
      setDragOffset(delta);
      const h = rowHeight.current || 56;
      const shift = Math.round(delta / h);
      const newIndex = Math.min(itemCount - 1, Math.max(0, dragStartIndex.current + shift));
      dragOverIndexRef.current = newIndex;
      setDragOverIndex(newIndex);
    };
    const onUp = () => {
      const target = dragOverIndexRef.current;
      const id = dragId;
      setDragId(null);
      setDragOffset(0);
      setDragOverIndex(null);
      if (id !== null && target !== null && target !== dragStartIndex.current) onReorder(id, target);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [dragId, itemCount, onReorder]);

  // Style for a row at `index` — call for every row in the list, in its original order.
  const getRowStyle = useCallback((id: string, index: number): CSSProperties => {
    if (dragId === id) {
      return { transform: `translateY(${dragOffset}px)`, zIndex: 20, position: 'relative', boxShadow: '0 10px 24px rgba(0,0,0,0.18)', transition: 'none' };
    }
    if (dragId && dragOverIndex !== null) {
      const start = dragStartIndex.current;
      if (start < dragOverIndex && index > start && index <= dragOverIndex) {
        return { transform: `translateY(-${rowHeight.current}px)`, transition: 'transform 150ms ease', position: 'relative' };
      }
      if (start > dragOverIndex && index >= dragOverIndex && index < start) {
        return { transform: `translateY(${rowHeight.current}px)`, transition: 'transform 150ms ease', position: 'relative' };
      }
    }
    return {};
  }, [dragId, dragOffset, dragOverIndex]);

  return { dragId, startDrag, getRowStyle };
}
