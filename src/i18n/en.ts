export interface Translations {
  nav: {
    appName: string;
    translation: string;
    timeline: string;
    proofreading: string;
    secondaryTimeline: string;
    effects: string;
    encoding: string;
    commonTools: string;
    subtitleExtraction: string;
    compactVideo: string;
    settings: string;
  };
  settings: {
    title: string;
    language: string;
    chinese: string;
    english: string;
    theme: string;
    dark: string;
    light: string;
  };
  subtitleExtraction: {
    title: string;
    description: string;
    dropzone: string;
    dropzoneHint: string;
    fileSelected: string;
    noFileSelected: string;
    // Model management
    modelSelector: string;
    modelChecking: string;
    modelAvailable: string;
    modelNotFound: string;
    downloadModel: string;          // "Download Model"
    downloadSpeedTesting: string;   // "Selecting fastest CDN…"
    downloadingFrom: string;        // "Downloading from {cdn}"
    downloadComplete: string;
    // Segmentation
    segmentationRules: string;
    maxCharsPerLine: string;
    maxWordsPerLine: string;
    breakAtPunctuation: string;
    // Actions
    startExtraction: string;
    extracting: string;
    extractionComplete: string;
    exportSrt: string;
    sendToTranslation: string;
    resultPreview: string;
    resultPlaceholder: string;
  };
  compactVideo: {
    title: string;
    description: string;
    dropzone: string;
    dropzoneHint: string;
    fileSelected: string;
    noFileSelected: string;
    // FFmpeg manager
    ffmpegManager: string;
    ffmpegChecking: string;
    ffmpegAvailable: string;
    ffmpegNotFound: string;
    downloadFfmpeg: string;
    ffmpegDownloadSpeedTesting: string;
    ffmpegDownloadingFrom: string;
    ffmpegDownloadComplete: string;
    // Output settings
    outputSettings: string;
    resolution: string;
    autoCrop: string;
    autoCropHint: string;
    // Actions
    startCompress: string;
    compressing: string;
    compressComplete: string;
    detectingCrop: string;
    openOutput: string;
    openOutputFolder: string;
  };
  pages: {
    translation: string;
    timeline: string;
    proofreading: string;
    secondaryTimeline: string;
    effects: string;
    encoding: string;
    comingSoon: string;
    comingSoonDesc: string;
  };
}

const en: Translations = {
  nav: {
    appName: 'qafoneTools',
    translation: 'Translation',
    timeline: 'Timeline',
    proofreading: 'Proofreading',
    secondaryTimeline: 'Secondary Timeline',
    effects: 'Effects',
    encoding: 'Encoding',
    commonTools: 'Common Tools',
    subtitleExtraction: 'Subtitle Extraction',
    compactVideo: 'Compact Video',
    settings: 'Settings',
  },
  settings: {
    title: 'Settings',
    language: 'Interface Language',
    chinese: '中文',
    english: 'English',
    theme: 'Theme',
    dark: 'Dark',
    light: 'Light',
  },
  subtitleExtraction: {
    title: 'Subtitle Extraction',
    description: 'Extract subtitles from video or audio files using local Whisper AI.',
    dropzone: 'Drag & drop video / audio files here',
    dropzoneHint: 'or click to browse  ·  Supported: .mp4 .mkv .mp3 .wav .flac',
    fileSelected: 'File selected',
    noFileSelected: 'No file selected',
    modelSelector: 'Whisper Model',
    modelChecking: 'Checking local model…',
    modelAvailable: 'Model ready',
    modelNotFound: 'Model not downloaded',
    downloadModel: 'Download Model',
    downloadSpeedTesting: 'Testing CDN speeds (HuggingFace vs ModelScope)…',
    downloadingFrom: 'Downloading from',
    downloadComplete: 'Model downloaded successfully',
    segmentationRules: 'Segmentation Rules (Line Breaks)',
    maxCharsPerLine: 'Max characters per line',
    maxWordsPerLine: 'Max words per line',
    breakAtPunctuation: 'Break line at sentence-ending punctuation (. ! ?)',
    startExtraction: 'Start Extraction',
    extracting: 'Extracting…',
    extractionComplete: 'Extraction Complete',
    exportSrt: 'Export as .srt',
    sendToTranslation: 'Send to Translation Workflow',
    resultPreview: 'Result Preview',
    resultPlaceholder: '[00:00:01,000 --> 00:00:04,500]\nHello, this is an extracted subtitle line.\n\n[00:00:05,000 --> 00:00:09,200]\nAnd here is the second subtitle block.',
  },
  compactVideo: {
    title: 'Compact Video',
    description: 'Re-encode video to a smaller, share-friendly file with auto black-bar removal.',
    dropzone: 'Drag & drop a video file here',
    dropzoneHint: 'or click to browse  ·  Supported: .mp4 .mkv .mov .avi .ts',
    fileSelected: 'File selected',
    noFileSelected: 'No file selected',
    ffmpegManager: 'FFmpeg',
    ffmpegChecking: 'Checking FFmpeg…',
    ffmpegAvailable: 'FFmpeg ready',
    ffmpegNotFound: 'FFmpeg not installed',
    downloadFfmpeg: 'Download FFmpeg',
    ffmpegDownloadSpeedTesting: 'Testing CDN speeds…',
    ffmpegDownloadingFrom: 'Downloading from',
    ffmpegDownloadComplete: 'FFmpeg downloaded successfully',
    outputSettings: 'Output Settings',
    resolution: 'Target Resolution',
    autoCrop: 'Auto-remove black bars',
    autoCropHint: 'Detects and crops letterbox / pillarbox borders before scaling',
    startCompress: 'Start Compression',
    compressing: 'Compressing…',
    compressComplete: 'Compression Complete',
    detectingCrop: 'Detecting black bars…',
    openOutput: 'Open Output File',
    openOutputFolder: 'Open Output Folder',
  },
  pages: {
    translation: 'Translation',
    timeline: 'Timeline',
    proofreading: 'Proofreading',
    secondaryTimeline: 'Secondary Timeline',
    effects: 'Effects',
    encoding: 'Encoding',
    comingSoon: 'Coming Soon',
    comingSoonDesc: 'This workflow step is currently under development.',
  },
};

export default en;
