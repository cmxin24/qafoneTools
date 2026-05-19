import { Film } from 'lucide-react';
import { WorkflowPlaceholder } from '@/components/WorkflowPlaceholder';

export default function EncodingPage() {
  return (
    <WorkflowPlaceholder
      titleKey="encoding"
      Icon={Film}
      step={6}
      color="bg-red-500/15 text-red-400"
    />
  );
}
