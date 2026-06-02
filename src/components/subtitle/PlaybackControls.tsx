import type { ReactNode } from 'react';
import { Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatTimecode, type SubtitleMode } from './subtitleWorkspace';

interface PlaybackControlsProps {
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  speedLabel: string;
  subtitleMode: SubtitleMode;
  subtitleModeLabel: string;
  onSeekBy: (delta: number) => void;
  onTogglePlay: () => void;
  onSeek: (time: number) => void;
  onCycleSpeed: () => void;
  onCycleSubtitleMode: () => void;
  children?: ReactNode;
}

export function PlaybackControls({
  currentTime,
  duration,
  isPlaying,
  speedLabel,
  subtitleMode,
  subtitleModeLabel,
  onSeekBy,
  onTogglePlay,
  onSeek,
  onCycleSpeed,
  onCycleSubtitleMode,
  children,
}: PlaybackControlsProps) {
  return (
    <div className="flex flex-shrink-0 flex-wrap items-center gap-1 border-b border-border/60 bg-card/30 px-3 py-1.5">
      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onSeekBy(-5)}>
        <SkipBack className="h-3.5 w-3.5" />
      </Button>
      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onTogglePlay}>
        {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
      </Button>
      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onSeekBy(5)}>
        <SkipForward className="h-3.5 w-3.5" />
      </Button>
      <span className="mx-1 shrink-0 font-mono text-xs text-muted-foreground">
        {formatTimecode(currentTime * 1000)} / {formatTimecode(duration * 1000)}
      </span>

      <input
        type="range"
        min={0}
        max={duration || 1}
        step={0.05}
        value={currentTime}
        onChange={(e) => onSeek(parseFloat(e.target.value))}
        className="h-1 min-w-[60px] flex-1 cursor-pointer accent-primary"
      />

      <Button variant="ghost" size="sm" className="h-7 shrink-0 px-2 font-mono text-xs" onClick={onCycleSpeed}>
        {speedLabel}
      </Button>

      <Button
        variant={subtitleMode === 'none' ? 'outline' : 'ghost'}
        size="sm"
        className="h-7 px-2 text-xs"
        onClick={onCycleSubtitleMode}
      >
        {subtitleModeLabel}
      </Button>

      {children}
    </div>
  );
}
