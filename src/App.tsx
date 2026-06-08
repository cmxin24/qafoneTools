import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Layout } from '@/components/layout/Layout';
import TimelinePage from '@/pages/Timeline';
import SecondaryTimelinePage from '@/pages/SecondaryTimeline';
import EffectsPage from '@/pages/Effects';
import EncodingPage from '@/pages/Encoding';
import SubtitleExtractionPage from '@/pages/tools/SubtitleExtraction';
import HardSubtitleExtractionPage from '@/pages/tools/HardSubtitleExtraction';
import CompactVideoPage from '@/pages/tools/CompactVideo';
import AudioExtractionPage from '@/pages/tools/AudioExtraction';
import BilingualSeparatorPage from '@/pages/effects/BilingualSeparator';
import AssFormatterPage from '@/pages/effects/AssFormatter';
import CreditsFormatterPage from '@/pages/effects/CreditsFormatter';
import LogoGeneratorPage from '@/pages/effects/LogoGenerator';
import CommonFontsPage from '@/pages/effects/CommonFonts';
import FFmpegCodeGeneratorPage from '@/pages/encoding/FFmpegCodeGenerator';
import WelcomePage from '@/pages/Welcome';
import PreprocessingPage from '@/pages/Preprocessing';
import { AsrTaskProvider } from '@/contexts/AsrTaskContext';
import { UpdateProvider } from '@/contexts/UpdateContext';

export default function App() {
  return (
    <UpdateProvider>
    <AsrTaskProvider>
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          {/* Default: welcome page */}
          <Route index element={<WelcomePage />} />

          {/* Workflow routes */}
          <Route path="/preprocessing" element={<PreprocessingPage />} />
          <Route path="/translation" element={<></>} />
          <Route path="/timeline" element={<TimelinePage />} />
          <Route path="/proofreading" element={<></>} />
          <Route path="/secondary-timeline" element={<SecondaryTimelinePage />} />
          <Route path="/effects" element={<EffectsPage />} />
          <Route path="/effects/bilingual-separator" element={<BilingualSeparatorPage />} />
          <Route path="/effects/ass-formatter" element={<AssFormatterPage />} />
          <Route path="/effects/credits-formatter" element={<CreditsFormatterPage />} />
          <Route path="/effects/logo-generator" element={<LogoGeneratorPage />} />
          <Route path="/effects/common-fonts" element={<CommonFontsPage />} />
          <Route path="/encoding" element={<EncodingPage />} />
          <Route path="/encoding/ffmpeg-code-gen" element={<FFmpegCodeGeneratorPage />} />

          {/* Common Tools */}
          <Route path="/tools/subtitle-extraction" element={<SubtitleExtractionPage />} />
          <Route path="/tools/compact-video" element={<CompactVideoPage />} />
          <Route path="/tools/hard-subtitle-extraction" element={<HardSubtitleExtractionPage />} />
          <Route path="/tools/audio-extraction" element={<AudioExtractionPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
    </AsrTaskProvider>
    </UpdateProvider>
  );
}
