export interface Translations {
  nav: {
    appName: string;
    preprocessing: string;
    translation: string;
    timeline: string;
    proofreading: string;
    secondaryTimeline: string;
    effects: string;
    encoding: string;
    commonTools: string;
    subtitleExtraction: string;
    compactVideo: string;
    hardSubtitleExtraction: string;
    audioExtraction: string;
    settings: string;
  };
  preprocessingPage: {
    title: string;
    description: string;
    subtitleExtractionDesc: string;
    audioExtractionDesc: string;
    compactVideoDesc: string;
    hardSubtitleExtractionDesc: string;
  };
  settings: {
    title: string;
    language: string;
    chinese: string;
    english: string;
    theme: string;
    dark: string;
    light: string;
    system: string;
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
    // Model management actions
    deleteModel: string;
    openModelDir: string;
    // ASR progress
    asrExtractingAudio: string;
    asrTranscribing: string;
    asrDone: string;
    asrError: string;
    // Preview
    previewNoSegments: string;
    exportSrtFile: string;
    // History
    history: string;
    historyEmpty: string;
    historyLoad: string;
  };
  audioExtraction: {
    title: string;
    description: string;
    dropzone: string;
    dropzoneHint: string;
    fileSelected: string;
    noFileSelected: string;
    // FFmpeg
    ffmpegManager: string;
    ffmpegChecking: string;
    ffmpegAvailable: string;
    ffmpegNotFound: string;
    downloadFfmpeg: string;
    ffmpegDownloadSpeedTesting: string;
    ffmpegDownloadingFrom: string;
    ffmpegDownloadComplete: string;
    // Track list
    audioTracks: string;
    noTracksFound: string;
    previewTrack: string;
    selectTrack: string;
    channels: string;
    // Output settings
    outputSettings: string;
    outputFormat: string;
    bitRate: string;
    outputPath: string;
    selectOutputPath: string;
    outputPathHint: string;
    // Actions
    startExtract: string;
    extracting: string;
    extractComplete: string;
    openOutput: string;
    openOutputFolder: string;
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
  translationPage: {
    title: string;
    subtitle: string;
    dropVideoHere: string;
    dropVideoHint: string;
    dropSrtHere: string;
    dropSrtHint: string;
    videoLoaded: string;
    srtLoaded: string;
    play: string;
    pause: string;
    seekBack: string;
    seekForward: string;
    speed: string;
    subtitleDisplay: string;
    subOriginal: string;
    subTranslated: string;
    subBoth: string;
    subNone: string;
    timecode: string;
    original: string;
    translation: string;
    translationNote: string;
    exportOriginal: string;
    exportTranslation: string;
    exportBilingual: string;
    exportTranslationNotes: string;
    translationNotesTitle: string;
    translationNotesEmpty: string;
    autosaveSaving: string;
    autosaveSaved: string;
    autosaveError: string;
    autosaveBrowser: string;
    layoutSideBySide: string;
    layoutStacked: string;
    placeholder: string;
    subtitleUp: string;
    subtitleDown: string;
    subtitleOffset: string;
    ffmpegNotFound: string;
    downloadFfmpeg: string;
    extractingWaveform: string;
    waveformError: string;
    insertSubtitle: string;
    insertBlankBefore: string;
    insertBlankAfter: string;
    insertBlankFailed: string;
    splitSubtitle: string;
    deleteSubtitle: string;
    mergePrev: string;
    mergeNext: string;
    duration: string;
    zoom: string;
    zoomIn: string;
    zoomOut: string;
    browseFile: string;
    glossaryTitle: string;
    glossaryImport: string;
    glossaryExport: string;
    glossaryAddRow: string;
    glossaryColOriginal: string;
    glossaryColTranslation: string;
    glossaryColNotes: string;
    glossaryEmpty: string;
    glossaryCount: string;
    glossaryPlaceholderOriginal: string;
    glossaryPlaceholderTranslation: string;
    glossaryPlaceholderNotes: string;
    glossaryDeleteRow: string;
    glossaryButton: string;
    exitDialogTitle: string;
    exitDialogMessage: string;
    exitDialogGlossaryMessage: string;
    exitDialogBothMessage: string;
    exitDialogExport: string;
    exitDialogExportGlossary: string;
    exitDialogExportBoth: string;
    exitDialogDiscard: string;
    exitDialogCancel: string;
  };
  proofreadingPage: {
    title: string;
    subtitle: string;
    dropTranslation: string;
    dropTranslationHint: string;
    proofreadingFileTitle: string;
    proofreadingFileHint: string;
    createProofreadFile: string;
    importProofreadFile: string;
    proofreadFileReady: string;
    autosaveSaving: string;
    autosaveSaved: string;
    autosaveError: string;
    autosaveBrowser: string;
    exportFinal: string;
    exportNotes: string;
    notesExportTitle: string;
    notesExportEmpty: string;
    subBoth: string;
    subTranslated: string;
    subNone: string;
    time: string;
    original: string;
    previousTranslation: string;
    finalTranslation: string;
    proofreadNote: string;
    translationPlaceholder: string;
    changed: string;
    exitDialogMessage: string;
    exitDialogBothMessage: string;
    exitDialogExport: string;
    exitDialogExportBoth: string;
  };
  effectsPage: {
    title: string;
    bilingualSeparatorTitle: string;
    bilingualSeparatorDesc: string;
    assFormatterTitle: string;
    assFormatterDesc: string;
    creditsFormatterTitle: string;
    creditsFormatterDesc: string;
    logoGeneratorTitle: string;
    logoGeneratorDesc: string;
    commonFontsTitle: string;
    commonFontsDesc: string;
  };
  commonFonts: {
    title: string;
    description: string;
    statusChecking: string;
    statusInstalled: string;
    statusNotInstalled: string;
    download: string;
    downloading: string;
    installSuccess: string;
    installError: string;
    openFontsDir: string;
    openFontsDirHint: string;
    refreshStatus: string;
    visitWebsite: string;
    fzZhunYuanNote: string;
  };
  bilingualSeparator: {
    dropzone: string;
    dropzoneHint: string;
    fileSelected: string;
    noFileSelected: string;
    separate: string;
    chineseSubtitle: string;
    foreignSubtitle: string;
    exportChinese: string;
    exportForeign: string;
    noContent: string;
    editHint: string;
  };
  assFormatter: {
    subtitleFiles: string;
    subtitleDropzone: string;
    subtitleDropzoneHint: string;
    addMore: string;
    removeFile: string;
    videoFile: string;
    videoDropzone: string;
    videoDropzoneHint: string;
    resolution: string;
    detectResolution: string;
    detecting: string;
    manualInput: string;
    width: string;
    height: string;
    preset480p: string;
    preset720p: string;
    preset1080p: string;
    presetCustom: string;
    convert: string;
    preview: string;
    export: string;
    bilingualDetected: string;
    noSubtitleFile: string;
    noResolution: string;
    ffmpegRequired: string;
    preserveAssTemplate: string;
    preserveAssTemplateDesc: string;
    layoutMode: string;
    layoutGrouped: string;
    layoutGroupedDesc: string;
    layoutInterleaved: string;
    layoutInterleavedDesc: string;
  };
  creditsFormatter: {
    inputLabel: string;
    inputHint: string;
    generate: string;
    output: string;
    copy: string;
    copied: string;
  };
  logoGenerator: {
    videoDropzone: string;
    videoDropzoneHint: string;
    resolution: string;
    detectResolution: string;
    detecting: string;
    width: string;
    height: string;
    preset480p: string;
    preset720p: string;
    preset1080p: string;
    presetCustom: string;
    ffmpegRequired: string;
    noResolution: string;
    timeRange: string;
    startTime: string;
    endTime: string;
    generate: string;
    output: string;
    copy: string;
    copied: string;
  };
  welcome: {
    title: string;
    subtitle: string;
    quickWorkflow: string;
    quickWorkflowDesc: string;
    quickTools: string;
    quickToolsDesc: string;
    githubTitle: string;
    githubDesc: string;
    contactTitle: string;
    contactDesc: string;
    openSource: string;
  };
  encodingPage: {
    title: string;
    ffmpegCodeGenTitle: string;
    ffmpegCodeGenDesc: string;
  };
  ffmpegCodeGen: {
    videoFile: string;
    videoDropzone: string;
    videoDropzoneHint: string;
    assFile: string;
    assDropzone: string;
    assDropzoneHint: string;
    encodeSettings: string;
    codec: string;
    preset: string;
    crf: string;
    testSegment: string;
    testStart: string;
    testDuration: string;
    seconds: string;
    testOutputPath: string;
    fullEncode: string;
    fullOutputPath: string;
    generate: string;
    testCommand: string;
    fullCommand: string;
    copy: string;
    copied: string;
    noVideo: string;
    noAss: string;
    noTestOutput: string;
    noFullOutput: string;
  };
}

const en: Translations = {
  nav: {
    appName: 'qafoneTools',
    preprocessing: 'Preprocessing',
    translation: 'Translation',
    timeline: 'Timeline',
    proofreading: 'Proofreading',
    secondaryTimeline: 'Secondary Timeline',
    effects: 'Effects',
    encoding: 'Encoding',
    commonTools: 'Common Tools',
    subtitleExtraction: 'Video Subtitle Extraction',
    compactVideo: 'Compact Video',
    hardSubtitleExtraction: 'Hard Subtitle Extraction',
    audioExtraction: 'Audio Extraction',
    settings: 'Settings',
  },
  preprocessingPage: {
    title: 'Preprocessing Tools',
    description: 'Subtitle extraction, audio extraction, video compressing and other preparation tools.',
    subtitleExtractionDesc: 'Extract subtitles from video or audio using local AI models.',
    audioExtractionDesc: 'Extract audio tracks from video files. Preview tracks and choose output format.',
    compactVideoDesc: 'Output compact MP4 for file sharing.',
    hardSubtitleExtractionDesc: 'Extract text subtitles burned into video frames.',
  },
  settings: {
    title: 'Settings',
    language: 'Interface Language',
    chinese: '中文',
    english: 'English',
    theme: 'Theme',
    dark: 'Dark',
    light: 'Light',
    system: 'System',
  },
  subtitleExtraction: {
    title: 'Video Subtitle Extraction',
    description: 'Extract subtitles from video or audio files using local LLM AI.',
    dropzone: 'Drag & drop video / audio files here',
    dropzoneHint: 'or click to browse  ·  Supported: .mp4 .mkv .mp3 .wav .flac',
    fileSelected: 'File selected',
    noFileSelected: 'No file selected',
    modelSelector: 'LLM Model',
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
    resultPreview: 'Subtitle Preview',
    resultPlaceholder: '',
    // Model management actions
    deleteModel: 'Delete Model',
    openModelDir: 'Open Folder',
    // ASR progress
    asrExtractingAudio: 'Extracting audio…',
    asrTranscribing: 'Transcribing…',
    asrDone: 'Transcription complete',
    asrError: 'Transcription failed',
    // Preview
    previewNoSegments: 'No subtitle data',
    exportSrtFile: 'Export .srt file',
    // History
    history: 'History',
    historyEmpty: 'No history yet',
    historyLoad: 'Load',
  },
  audioExtraction: {
    title: 'Audio Extraction',
    description: 'Extract audio tracks from video files. Preview each track and choose your output format.',
    dropzone: 'Drag & drop a video file here',
    dropzoneHint: 'or click to browse  ·  Supported: .mp4 .mkv .mov .avi .ts .webm',
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
    audioTracks: 'Audio Tracks',
    noTracksFound: 'No audio tracks found',
    previewTrack: 'Preview',
    selectTrack: 'Select',
    channels: 'ch',
    outputSettings: 'Output Settings',
    outputFormat: 'Format',
    bitRate: 'Bitrate',
    outputPath: 'Output Path',
    selectOutputPath: 'Select output path',
    outputPathHint: 'Defaults to the same folder as the source file',
    startExtract: 'Start Extraction',
    extracting: 'Extracting…',
    extractComplete: 'Extraction Complete',
    openOutput: 'Open Output File',
    openOutputFolder: 'Open Output Folder',
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
  translationPage: {
    title: 'Translation',
    subtitle: 'Watch video and translate subtitles.',
    dropVideoHere: 'Drop video file here',
    dropVideoHint: 'Supported: .mp4 .mkv .mov .avi .webm',
    dropSrtHere: 'Drop SRT file here',
    dropSrtHint: 'Subtitle file in .srt format',
    videoLoaded: 'Video loaded',
    srtLoaded: 'SRT loaded',
    play: 'Play',
    pause: 'Pause',
    seekBack: '−5s',
    seekForward: '+5s',
    speed: 'Speed',
    subtitleDisplay: 'Subtitle',
    subOriginal: 'Original',
    subTranslated: 'Translated',
    subBoth: 'Both',
    subNone: 'None',
    timecode: 'Timecode',
    original: 'Original',
    translation: 'Translation',
    translationNote: 'Translation Note',
    exportOriginal: 'Export Original',
    exportTranslation: 'Export Translation',
    exportBilingual: 'Export Bilingual',
    exportTranslationNotes: 'Export Notes',
    translationNotesTitle: 'Translation Notes',
    translationNotesEmpty: 'No translations or translation notes yet.',
    autosaveSaving: 'Saving...',
    autosaveSaved: 'Saved',
    autosaveError: 'Save failed',
    autosaveBrowser: 'Browser session',
    layoutSideBySide: 'Wide Layout',
    layoutStacked: 'Stacked Layout',
    placeholder: 'Enter translation…',
    subtitleUp: 'Move subtitle up',
    subtitleDown: 'Move subtitle down',
    subtitleOffset: 'Subtitle position',
    ffmpegNotFound: 'FFmpeg not found — waveform unavailable',
    downloadFfmpeg: 'Download FFmpeg',
    extractingWaveform: 'Extracting waveform…',
    waveformError: 'Waveform extraction failed',
    insertSubtitle: 'Insert subtitle here',
    insertBlankBefore: 'Insert blank before',
    insertBlankAfter: 'Insert blank after',
    insertBlankFailed: 'Insert failed: there is no available space.',
    splitSubtitle: 'Split current subtitle',
    deleteSubtitle: 'Delete subtitle',
    mergePrev: 'Merge with previous',
    mergeNext: 'Merge with next',
    duration: 'Duration',
    zoom: 'Zoom',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    browseFile: 'or Browse File',
    glossaryTitle: 'Glossary',
    glossaryImport: 'Import .txt',
    glossaryExport: 'Export .txt',
    glossaryAddRow: 'Add Term',
    glossaryColOriginal: 'Original',
    glossaryColTranslation: 'Translation',
    glossaryColNotes: 'Notes',
    glossaryEmpty: 'No terms yet. Click “Add Term” or import a .txt file.',
    glossaryCount: '{count} terms',
    glossaryPlaceholderOriginal: 'Original term',
    glossaryPlaceholderTranslation: 'Translation',
    glossaryPlaceholderNotes: 'Notes (optional)',
    glossaryDeleteRow: 'Delete',
    glossaryButton: 'Glossary',
    exitDialogTitle: 'Unsaved Changes',
    exitDialogMessage: 'You have unsaved subtitle entries. Export before closing?',
    exitDialogGlossaryMessage: 'You have unsaved glossary changes. Export the glossary before closing?',
    exitDialogBothMessage: 'You have unsaved subtitle entries and glossary changes. Export both files before closing?',
    exitDialogExport: 'Export Translation & Close',
    exitDialogExportGlossary: 'Export Glossary & Close',
    exitDialogExportBoth: 'Export Both & Close',
    exitDialogDiscard: 'Close Without Saving',
    exitDialogCancel: 'Cancel',
  },
  proofreadingPage: {
    title: 'Proofreading',
    subtitle: 'Review translated subtitles, refine wording, and record revision notes.',
    dropTranslation: 'Drop translated SRT here',
    dropTranslationHint: 'Use the translated subtitle as the unchanged reference.',
    proofreadingFileTitle: 'Proofreading file',
    proofreadingFileHint: 'Create a new proofreading copy or continue from an existing one.',
    createProofreadFile: 'Create New Proofreading File',
    importProofreadFile: 'Import Proofreading File',
    proofreadFileReady: 'Proofreading file ready',
    autosaveSaving: 'Saving...',
    autosaveSaved: 'Saved',
    autosaveError: 'Save failed',
    autosaveBrowser: 'Browser session',
    exportFinal: 'Save a Copy',
    exportNotes: 'Export Notes',
    notesExportTitle: 'Proofreading Notes',
    notesExportEmpty: 'No changed translations or proofreading notes yet.',
    subBoth: 'Both',
    subTranslated: 'Final',
    subNone: 'None',
    time: 'Time',
    original: 'Original',
    previousTranslation: 'Previous translation',
    finalTranslation: 'Final translation',
    proofreadNote: 'Proofreading Note',
    translationPlaceholder: 'Edit final translation...',
    changed: 'Changed from previous translation',
    exitDialogMessage: 'You have unsaved proofreading changes. Export before closing?',
    exitDialogBothMessage: 'You have unsaved proofreading changes and glossary changes. Export both files before closing?',
    exitDialogExport: 'Export Proofreading File & Close',
    exitDialogExportBoth: 'Export Both & Close',
  },
  effectsPage: {
    title: 'Effects Tools',
    bilingualSeparatorTitle: 'Bilingual Subtitle Separator',
    bilingualSeparatorDesc: 'Split a bilingual SRT into separate Chinese and foreign subtitle files.',
    assFormatterTitle: 'ASS Style Formatter',
    assFormatterDesc: 'Convert SRT/ASS subtitles to a styled ASS file with font, size and margin presets scaled to the video resolution.',
    creditsFormatterTitle: 'Credits Formatter',
    creditsFormatterDesc: 'Generate ASS-ready credits text with fade effects from a simple role–name list.',    logoGeneratorTitle: 'Logo Generator',
    logoGeneratorDesc: 'Generate scaled QAFONE logo ASS dialogue lines for any video resolution.',
    commonFontsTitle: 'Common Fonts',
    commonFontsDesc: 'Download and install the fonts commonly used by this subtitle group.',
  },
  commonFonts: {
    title: 'Common Fonts',
    description: 'Download and install the fonts commonly used by QAFONE subtitle group.',
    statusChecking: 'Checking…',
    statusInstalled: 'Installed',
    statusNotInstalled: 'Not installed',
    download: 'Download & Install',
    downloading: 'Downloading…',
    installSuccess: 'Installed successfully. Restart apps to use the font.',
    installError: 'Installation failed',
    openFontsDir: 'Open Fonts Directory',
    openFontsDirHint: 'Opens the system fonts folder — drag font files here to install manually.',
    refreshStatus: 'Refresh',
    visitWebsite: 'Get from Official Website',
    fzZhunYuanNote: 'Free personal use licenses are available on FounderType official website. Select "Traditional Chinese" to get a font file that covers both Traditional and Simplified Chinese (GBK).',
  },
  bilingualSeparator: {
    dropzone: 'Drag & drop an SRT file here',
    dropzoneHint: 'or click to browse  ·  Supported: .srt',
    fileSelected: 'File selected',
    noFileSelected: 'No file selected',
    separate: 'Separate',
    chineseSubtitle: 'Chinese Subtitles',
    foreignSubtitle: 'Foreign Subtitles',
    exportChinese: 'Export Chinese SRT',
    exportForeign: 'Export Foreign SRT',
    noContent: 'No subtitle content detected.',
    editHint: 'Click to edit…',
  },
  assFormatter: {
    subtitleFiles: 'Subtitle Files (1–2)',
    subtitleDropzone: 'Drag & drop SRT or ASS files here',
    subtitleDropzoneHint: 'or click to browse  ·  Supported: .srt .ass',
    addMore: 'Add another file',
    removeFile: 'Remove',
    videoFile: 'Video File (for resolution)',
    videoDropzone: 'Drag & drop video file here',
    videoDropzoneHint: 'or click to browse  ·  Supported: .mp4 .mkv .mov .avi .ts',
    resolution: 'Target Resolution',
    detectResolution: 'Detect from video',
    detecting: 'Detecting…',
    manualInput: 'Enter manually',
    width: 'Width',
    height: 'Height',
    preset480p: '480p (854×480)',
    preset720p: '720p (1280×720)',
    preset1080p: '1080p (1920×1080)',
    presetCustom: 'Custom',
    convert: 'Convert to ASS',
    preview: 'ASS Preview',
    export: 'Export .ass',
    bilingualDetected: 'Bilingual — auto-split',
    noSubtitleFile: 'Please import at least one subtitle file.',
    noResolution: 'Please specify a video resolution.',
    ffmpegRequired: 'FFmpeg is required to detect resolution. Install FFmpeg or enter manually.',
    preserveAssTemplate: 'Keep existing ASS effects template',
    preserveAssTemplateDesc: 'Use the imported ASS styles as the template and only scale the Fontsize column from the original PlayResY to the target height.',
    layoutMode: 'Event Arrangement',
    layoutGrouped: 'Grouped',
    layoutGroupedDesc: 'All events of one language listed together, then the other',
    layoutInterleaved: 'Interleaved',
    layoutInterleavedDesc: 'All events mixed in chronological order',
  },
  creditsFormatter: {
    inputLabel: 'Credits List',
    inputHint: 'One entry per line — lines without a name are skipped. Separate role and name with spaces.',
    generate: 'Generate',
    output: 'ASS Output',
    copy: 'Copy',
    copied: 'Copied!',
  },  logoGenerator: {
    videoDropzone: 'Drag & drop video file here',
    videoDropzoneHint: 'or click to browse  \u00b7  Supported: .mp4 .mkv .mov .avi .ts',
    resolution: 'Target Resolution',
    detectResolution: 'Detect from video',
    detecting: 'Detecting\u2026',
    width: 'Width',
    height: 'Height',
    preset480p: '480p (854\u00d7480)',
    preset720p: '720p (1280\u00d7720)',
    preset1080p: '1080p (1920\u00d71080)',
    presetCustom: 'Custom',
    ffmpegRequired: 'FFmpeg is required to detect resolution. Install FFmpeg or enter manually.',
    noResolution: 'Please specify a video resolution.',
    timeRange: 'Time Range',
    startTime: 'Start',
    endTime: 'End',
    generate: 'Generate Logo',
    output: 'ASS Output',
    copy: 'Copy',
    copied: 'Copied!',
  },  welcome: {
    title: 'Welcome to qafoneTools',
    subtitle: 'Created by the QAFONE',
    quickWorkflow: 'Effects & Tools',
    quickWorkflowDesc: 'ASS formatting, credits generator and more',
    quickTools: 'Common Tools',
    quickToolsDesc: 'Subtitle extraction, audio tools and more',
    githubTitle: 'GitHub',
    githubDesc: 'Open an issue or start a discussion on the GitHub repo',
    contactTitle: 'Internal Members',
    contactDesc: 'QAFONE team members please reach out to 小新 directly.',
    openSource: 'Open Source',
  },
  encodingPage: {
    title: 'Encoding Tools',
    ffmpegCodeGenTitle: 'FFmpeg Code Generator',
    ffmpegCodeGenDesc: 'Generate FFmpeg commands to hard-burn ASS subtitles into a video, with a quick test-segment command and a full-encode command.',
  },
  ffmpegCodeGen: {
    videoFile: 'Video File',
    videoDropzone: 'Drag & drop video file here',
    videoDropzoneHint: 'or click to browse  \u00b7  Supported: .mp4 .mkv .mov .avi .ts',
    assFile: 'ASS Subtitle File',
    assDropzone: 'Drag & drop ASS file here',
    assDropzoneHint: 'or click to browse  \u00b7  Supported: .ass',
    encodeSettings: 'Encode Settings',
    codec: 'Codec',
    preset: 'Preset',
    crf: 'CRF',
    testSegment: 'Test Segment',
    testStart: 'Start Time',
    testDuration: 'Duration',
    seconds: 's',
    testOutputPath: 'Output Path',
    fullEncode: 'Full Encode',
    fullOutputPath: 'Output Path',
    generate: 'Generate Commands',
    testCommand: 'Test Command',
    fullCommand: 'Full Encode Command',
    copy: 'Copy',
    copied: 'Copied!',
    noVideo: 'Please import a video file.',
    noAss: 'Please import an ASS subtitle file.',
    noTestOutput: 'Please specify an output path for the test segment.',
    noFullOutput: 'Please specify an output path for the full encode.',
  },
};

export default en;
