import { Clock } from 'lucide-react';
import { WorkflowPlaceholder } from '@/components/WorkflowPlaceholder';

export default function TimelinePage() {
  return (
    <WorkflowPlaceholder
      titleKey="timeline"
      Icon={Clock}
      step={2}
      color="bg-green-500/15 text-green-400"
    />
  );
}
