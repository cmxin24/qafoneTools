import { ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface SubtitleOffsetControlsProps {
  label: string;
  upLabel: string;
  downLabel: string;
  value: number;
  onChange: (value: number) => void;
}

export function SubtitleOffsetControls({
  label,
  upLabel,
  downLabel,
  value,
  onChange,
}: SubtitleOffsetControlsProps) {
  return (
    <div className="ml-1 flex items-center gap-0.5">
      <span className="mr-1 hidden text-xs text-muted-foreground sm:inline">{label}</span>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        title={upLabel}
        onClick={() => onChange(Math.min(90, value + 5))}
      >
        <ChevronUp className="h-3.5 w-3.5" />
      </Button>
      <span className="w-7 text-center font-mono text-xs text-muted-foreground">{value}%</span>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        title={downLabel}
        onClick={() => onChange(Math.max(2, value - 5))}
      >
        <ChevronDown className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
