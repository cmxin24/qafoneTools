import type { RefObject, SyntheticEvent } from 'react';

interface SubtitleVideoPreviewProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  videoUrl: string | null;
  overlayLines: string[];
  overlayBottomPct?: number;
  fill?: boolean;
  onTimeUpdate: (e: SyntheticEvent<HTMLVideoElement>) => void;
  onLoadedMetadata: (e: SyntheticEvent<HTMLVideoElement>) => void;
  onPlay: () => void;
  onPause: () => void;
}

export function SubtitleVideoPreview({
  videoRef,
  videoUrl,
  overlayLines,
  overlayBottomPct = 8,
  fill = false,
  onTimeUpdate,
  onLoadedMetadata,
  onPlay,
  onPause,
}: SubtitleVideoPreviewProps) {
  return (
    <div
      className={fill ? 'relative max-h-[40vh] flex-shrink-0 bg-black lg:min-h-0 lg:max-h-none lg:flex-1' : 'relative flex-shrink-0 bg-black'}
      style={fill ? undefined : { maxHeight: '40vh' }}
    >
      <video
        ref={videoRef}
        src={videoUrl ?? undefined}
        className={fill ? 'mx-auto max-h-[40vh] w-full bg-black object-contain lg:h-full lg:max-h-none' : 'mx-auto max-h-[40vh] w-full bg-black object-contain'}
        onTimeUpdate={onTimeUpdate}
        onLoadedMetadata={onLoadedMetadata}
        onPlay={onPlay}
        onPause={onPause}
      />
      {overlayLines.length > 0 && (
        <div
          className="pointer-events-none absolute left-1/2 flex max-w-[86%] -translate-x-1/2 flex-col items-center gap-0.5 text-center"
          style={{ bottom: `${overlayBottomPct}%` }}
        >
          {overlayLines.map((line, i) => (
            <span key={i} className="rounded bg-black/75 px-2 py-0.5 text-sm text-white shadow">
              {line}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
