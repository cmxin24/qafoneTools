import type { DragEvent, ReactNode, RefObject } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface DropZoneProps {
  label: string;
  hint: string;
  isOver: boolean;
  isLoaded: boolean;
  loadedName: string;
  icon: ReactNode;
  onDragOver: (e: DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: DragEvent) => void;
  onBrowse: () => void;
  browseLabel?: string;
  zoneRef?: RefObject<HTMLDivElement | null>;
  onClear?: () => void;
}

export function DropZone({
  label,
  hint,
  isOver,
  isLoaded,
  loadedName,
  icon,
  zoneRef,
  onDragOver,
  onDragLeave,
  onDrop,
  onBrowse,
  browseLabel,
  onClear,
}: DropZoneProps) {
  return (
    <div
      ref={zoneRef}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={[
        'relative min-h-[220px] border border-dashed rounded-md flex flex-col items-center justify-center gap-3 bg-card transition-colors',
        isOver ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50',
        isLoaded ? 'border-solid' : '',
      ].join(' ')}
    >
      {isLoaded && onClear && (
        <button
          type="button"
          onClick={onClear}
          className="absolute right-3 top-3 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      )}
      <div className="flex h-12 w-12 items-center justify-center rounded-md bg-muted">{icon}</div>
      <div className="px-4 text-center">
        <div className="max-w-[260px] truncate font-medium">{isLoaded ? loadedName : label}</div>
        <div className="mt-1 text-sm text-muted-foreground">{hint}</div>
      </div>
      <Button variant="outline" size="sm" onClick={onBrowse}>
        {browseLabel ?? label}
      </Button>
    </div>
  );
}
