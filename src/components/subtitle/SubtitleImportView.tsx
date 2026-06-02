import type { ChangeEvent, DragEvent, ReactNode, RefObject } from 'react';
import { FileText, Film } from 'lucide-react';
import { DropZone } from './DropZone';

interface SubtitleImportViewProps {
  title: string;
  subtitle: string;
  videoLabel: string;
  videoHint: string;
  srtLabel: string;
  srtHint: string;
  browseLabel: string;
  videoInputRef: RefObject<HTMLInputElement | null>;
  srtInputRef: RefObject<HTMLInputElement | null>;
  videoZoneRef: RefObject<HTMLDivElement | null>;
  srtZoneRef: RefObject<HTMLDivElement | null>;
  videoDragOver: boolean;
  srtDragOver: boolean;
  videoFilename: string;
  srtFilename: string;
  onVideoInputChange: (e: ChangeEvent<HTMLInputElement>) => void;
  onSrtInputChange: (e: ChangeEvent<HTMLInputElement>) => void;
  onVideoDragOver: (e: DragEvent) => void;
  onSrtDragOver: (e: DragEvent) => void;
  onVideoDragLeave: () => void;
  onSrtDragLeave: () => void;
  onVideoDrop: (e: DragEvent) => void;
  onSrtDrop: (e: DragEvent) => void;
  onBrowseVideo: () => void;
  onBrowseSrt: () => void;
  onClearVideo?: () => void;
  onClearSrt?: () => void;
  children?: ReactNode;
}

export function SubtitleImportView({
  title,
  subtitle,
  videoLabel,
  videoHint,
  srtLabel,
  srtHint,
  browseLabel,
  videoInputRef,
  srtInputRef,
  videoZoneRef,
  srtZoneRef,
  videoDragOver,
  srtDragOver,
  videoFilename,
  srtFilename,
  onVideoInputChange,
  onSrtInputChange,
  onVideoDragOver,
  onSrtDragOver,
  onVideoDragLeave,
  onSrtDragLeave,
  onVideoDrop,
  onSrtDrop,
  onBrowseVideo,
  onBrowseSrt,
  onClearVideo,
  onClearSrt,
  children,
}: SubtitleImportViewProps) {
  return (
    <div className="flex flex-col h-full p-6 gap-6">
      <div>
        <h1 className="text-xl font-bold">{title}</h1>
        <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
      </div>
      <div className="grid grid-cols-2 gap-4 flex-1 content-start">
        <input
          ref={videoInputRef}
          type="file"
          accept="video/*,.mkv,.mp4,.mov,.avi,.ts,.wmv"
          className="sr-only"
          onChange={onVideoInputChange}
        />
        <input
          ref={srtInputRef}
          type="file"
          accept=".srt,.vtt"
          className="sr-only"
          onChange={onSrtInputChange}
        />
        <DropZone
          label={videoLabel}
          hint={videoHint}
          browseLabel={browseLabel}
          isOver={videoDragOver}
          isLoaded={!!videoFilename}
          loadedName={videoFilename}
          icon={<Film className="h-6 w-6 text-muted-foreground" />}
          zoneRef={videoZoneRef}
          onDragOver={onVideoDragOver}
          onDragLeave={onVideoDragLeave}
          onDrop={onVideoDrop}
          onBrowse={onBrowseVideo}
          onClear={videoFilename ? onClearVideo : undefined}
        />
        <DropZone
          label={srtLabel}
          hint={srtHint}
          browseLabel={browseLabel}
          isOver={srtDragOver}
          isLoaded={!!srtFilename}
          loadedName={srtFilename}
          icon={<FileText className="h-6 w-6 text-muted-foreground" />}
          zoneRef={srtZoneRef}
          onDragOver={onSrtDragOver}
          onDragLeave={onSrtDragLeave}
          onDrop={onSrtDrop}
          onBrowse={onBrowseSrt}
          onClear={srtFilename ? onClearSrt : undefined}
        />
      </div>
      {children}
    </div>
  );
}
