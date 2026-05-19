import { Sparkles } from 'lucide-react';
import { WorkflowPlaceholder } from '@/components/WorkflowPlaceholder';

export default function EffectsPage() {
  return (
    <WorkflowPlaceholder
      titleKey="effects"
      Icon={Sparkles}
      step={5}
      color="bg-purple-500/15 text-purple-400"
    />
  );
}
