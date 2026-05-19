import { Clock3 } from 'lucide-react';
import { WorkflowPlaceholder } from '@/components/WorkflowPlaceholder';

export default function SecondaryTimelinePage() {
  return (
    <WorkflowPlaceholder
      titleKey="secondaryTimeline"
      Icon={Clock3}
      step={4}
      color="bg-orange-500/15 text-orange-400"
    />
  );
}
