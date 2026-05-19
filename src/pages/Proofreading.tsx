import { CheckSquare } from 'lucide-react';
import { WorkflowPlaceholder } from '@/components/WorkflowPlaceholder';

export default function ProofreadingPage() {
  return (
    <WorkflowPlaceholder
      titleKey="proofreading"
      Icon={CheckSquare}
      step={3}
      color="bg-yellow-500/15 text-yellow-400"
    />
  );
}
