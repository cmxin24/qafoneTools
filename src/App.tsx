import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from '@/components/layout/Layout';
import TranslationPage from '@/pages/Translation';
import TimelinePage from '@/pages/Timeline';
import ProofreadingPage from '@/pages/Proofreading';
import SecondaryTimelinePage from '@/pages/SecondaryTimeline';
import EffectsPage from '@/pages/Effects';
import EncodingPage from '@/pages/Encoding';
import SubtitleExtractionPage from '@/pages/tools/SubtitleExtraction';
import CompactVideoPage from '@/pages/tools/CompactVideo';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          {/* Default: redirect to subtitle extraction tool */}
          <Route index element={<Navigate to="/tools/subtitle-extraction" replace />} />

          {/* Workflow routes */}
          <Route path="/translation" element={<TranslationPage />} />
          <Route path="/timeline" element={<TimelinePage />} />
          <Route path="/proofreading" element={<ProofreadingPage />} />
          <Route path="/secondary-timeline" element={<SecondaryTimelinePage />} />
          <Route path="/effects" element={<EffectsPage />} />
          <Route path="/encoding" element={<EncodingPage />} />

          {/* Common Tools */}
          <Route path="/tools/subtitle-extraction" element={<SubtitleExtractionPage />} />
          <Route path="/tools/compact-video" element={<CompactVideoPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
