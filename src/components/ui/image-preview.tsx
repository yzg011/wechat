import { useEffect, useCallback, useState } from 'react';
import { X, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';

interface ImagePreviewProps {
  /** 当前展示的图片 URL，为 null 时不显示 */
  src: string | null;
  /** 图片组（支持左右切换），不传则仅显示当前图 */
  images?: string[];
  /** 初始索引 */
  initialIndex?: number;
  onClose: () => void;
}

export function ImagePreview({ src, images, initialIndex = 0, onClose }: ImagePreviewProps) {
  const list = images && images.length > 0 ? images : src ? [src] : [];
  const [index, setIndex] = useState(initialIndex);
  const [scale, setScale] = useState(1);

  // 切换图片时重置缩放
  useEffect(() => { setScale(1); }, [index]);

  // 初始 index
  useEffect(() => {
    if (src && images) {
      const i = images.indexOf(src);
      setIndex(i >= 0 ? i : initialIndex);
    } else {
      setIndex(initialIndex);
    }
    setScale(1);
  }, [src, images, initialIndex]);

  const close = useCallback(() => { setScale(1); onClose(); }, [onClose]);

  const handleKey = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowLeft' && index > 0) setIndex(i => i - 1);
    if (e.key === 'ArrowRight' && index < list.length - 1) setIndex(i => i + 1);
  }, [close, index, list.length]);

  useEffect(() => {
    if (!src) return;
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [src, handleKey]);

  if (!src || list.length === 0) return null;

  const currentUrl = list[index] ?? src;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90"
      onClick={close}
    >
      {/* 工具栏 */}
      <div
        className="absolute top-3 right-3 flex items-center gap-2 z-10"
        onClick={e => e.stopPropagation()}
      >
        <button
          onClick={() => setScale(s => Math.min(s + 0.5, 4))}
          className="p-2 rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors"
        >
          <ZoomIn className="w-4 h-4" />
        </button>
        <button
          onClick={() => setScale(s => Math.max(s - 0.5, 0.5))}
          className="p-2 rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors"
        >
          <ZoomOut className="w-4 h-4" />
        </button>
        <button
          onClick={() => setScale(1)}
          className="p-2 rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors"
        >
          <RotateCcw className="w-4 h-4" />
        </button>
        <button
          onClick={close}
          className="p-2 rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* 左右切换 */}
      {index > 0 && (
        <button
          className="absolute left-3 top-1/2 -translate-y-1/2 p-3 rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors z-10 text-xl font-bold"
          onClick={e => { e.stopPropagation(); setIndex(i => i - 1); }}
        >
          ‹
        </button>
      )}
      {index < list.length - 1 && (
        <button
          className="absolute right-3 top-1/2 -translate-y-1/2 p-3 rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors z-10 text-xl font-bold"
          onClick={e => { e.stopPropagation(); setIndex(i => i + 1); }}
        >
          ›
        </button>
      )}

      {/* 图片 */}
      <div onClick={e => e.stopPropagation()} className="max-w-[90vw] max-h-[90vh]">
        <img
          src={currentUrl}
          alt="预览"
          style={{ transform: `scale(${scale})`, transition: 'transform 0.2s' }}
          className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg select-none"
          draggable={false}
        />
      </div>

      {/* 底部计数 */}
      {list.length > 1 && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1.5">
          {list.map((_, i) => (
            <button
              key={i}
              onClick={e => { e.stopPropagation(); setIndex(i); }}
              className={`rounded-full transition-all ${i === index ? 'w-3 h-3 bg-white' : 'w-2 h-2 bg-white/40'}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
