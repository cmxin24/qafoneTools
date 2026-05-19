import { Languages } from 'lucide-react';
import { WorkflowPlaceholder } from '@/components/WorkflowPlaceholder';

export default function TranslationPage() {
  return (
    <WorkflowPlaceholder
      titleKey="translation"
      Icon={Languages}
      step={1}
      color="bg-blue-500/15 text-blue-400"
    />
  );
}
