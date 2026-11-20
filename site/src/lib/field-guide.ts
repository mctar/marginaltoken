export const tasks = [
  { id: 'language', label: 'Work with text', detail: 'Summarise, write and answer questions.' },
  { id: 'coding', label: 'Coding', detail: 'Explore a codebase, fix a bug or write a feature.' },
  {
    id: 'agentic-automation',
    label: 'Agentic automation',
    detail: 'Have a model use tools to complete a task in several steps.',
  },
  {
    id: 'vision',
    label: 'Read images & documents',
    detail: 'Interpret an image or extract words from a page.',
  },
  {
    id: 'generation',
    label: 'Create images & video',
    detail: 'Generate a picture or animate a speaker.',
  },
  {
    id: 'transcription',
    label: 'Transcribe speech',
    detail: 'Turn a recording into written words.',
  },
  { id: 'diarization', label: 'Separate speakers', detail: 'Mark who spoke when in a recording.' },
  {
    id: 'speech',
    label: 'Generate speech',
    detail: 'Read text aloud or hold a voice conversation.',
  },
] as const

type Task = (typeof tasks)[number]['id']
export type Profile = {
  id: string
  name: string
  tasks: Task[]
  access: 'API' | 'Download' | 'API and download'
  source: string
  summary: string
  terms: string
  checked: string
  note?: string
  ledgerKey?: string
}

// The editorial catalog describes an identity even when the price tape has no row.
export const profiles: Profile[] = [
  {
    id: 'gpt-62-sol',
    name: 'GPT-6.2 Sol',
    tasks: ['language'],
    access: 'API',
    summary: 'A general-purpose model for writing and reasoning over supplied material.',
    terms:
      'Input and output tokens have separate prices. The serving plan and prompt length affect the bill.',
    checked: '2026-11-18',
    ledgerKey: 'openai/gpt-6.2-sol',
    note: 'gpt-62-sol-astra-api-pricing-ultrafast',
    source: 'https://developers.openai.com/api/docs/models/gpt-6.2-sol',
  },
  {
    id: 'flint',
    name: 'Flint',
    tasks: ['coding'],
    access: 'Download',
    summary: 'Run a coding model locally to investigate a codebase, fix bugs and implement features.',
    terms: 'Apache-2.0 weights. The optimized Mac runtime needs a supported chip and at least 48 GB of unified memory.',
    checked: '2026-10-22',
    note: 'flint-local-coding-hardware-running-costs',
    source: 'https://huggingface.co/RecursiveSI/flint',
  },
  {
    id: 'deepseek-v41-flash',
    name: 'DeepSeek V4.1 Flash',
    tasks: ['agentic-automation'],
    access: 'API',
    summary: 'Give the model a research task that requires searching the web, reading sources and summarising what it finds.',
    terms: 'On the direct API, billable searches, page fetches and document processing add to the token bill.',
    checked: '2026-11-16',
    ledgerKey: 'deepseek/deepseek-v4.1-flash',
    note: 'deepseek-v41-flash-hosted-tool-fees',
    source: 'https://api-docs.deepseek.com/guides/search/',
  },
  {
    id: 'aion',
    name: 'Aion Instruct',
    tasks: ['language'],
    access: 'Download',
    summary: 'Run a language model on an eligible device, including in Microsoft Edge.',
    terms: 'MIT weights. Edge API access depends on the feature and browser channel.',
    checked: '2026-11-20',
    note: 'aion-instruct-edge-access-local-fallback-costs',
    source: 'https://huggingface.co/microsoft/Aion-1.0-Instruct-2.3B',
  },
  {
    id: 'mistral-large-4',
    name: 'Mistral Large 4',
    tasks: ['language', 'vision'],
    access: 'API and download',
    summary: 'Ask questions about documents, images and text.',
    terms: 'The API meters tokens. Downloads come under the Mistral Ecosystem Open Weight License.',
    checked: '2026-11-20',
    ledgerKey: 'mistralai/mistral-large-4',
    note: 'mistral-large-4-weights-api-license',
    source: 'https://docs.mistral.ai/models/mistral-large-4',
  },
  {
    id: 'surya-25',
    name: 'Surya 2.5',
    tasks: ['vision'],
    access: 'Download',
    summary: 'Extract text from scanned pages using optical character recognition (OCR).',
    terms:
      'The weights have commercial restrictions. Compare local cost per correctly processed page.',
    checked: '2026-11-01',
    note: 'surya-25-local-ocr-license-costs',
    source: 'https://huggingface.co/datalab-to/surya-ocr-2.5',
  },
  {
    id: 'h3-image',
    name: 'MiniMax H3-Image',
    tasks: ['generation'],
    access: 'API and download',
    summary: 'Create images from prompts and edit existing images.',
    terms:
      'The API meters text input, image input and image output separately. The weight license limits where the model can be used.',
    checked: '2026-11-11',
    note: 'minimax-h3-image-api-pricing-weights-license',
    source: 'https://huggingface.co/MiniMaxAI/MiniMax-H3-Image',
  },
  {
    id: 'longcat-avatar',
    name: 'LongCat-Video-Avatar 1.6',
    tasks: ['generation'],
    access: 'Download',
    summary: 'Animate an on-screen speaker from supplied audio.',
    terms:
      'MIT weights. Measure rendering time and memory at the resolution and clip length you intend to use.',
    checked: '2026-11-17',
    note: 'longcat-video-avatar-16-local-rendering-costs',
    source: 'https://huggingface.co/meituan-longcat/LongCat-Video-Avatar-1.6',
  },
  {
    id: 'nemotron-transcribe',
    name: 'Nemotron 3.5 Transcribe',
    tasks: ['transcription', 'diarization'],
    access: 'Download',
    summary: 'Transcribe speech, attribute words to speakers or translate a recording.',
    terms:
      'The BF16 weights use OpenMDW-1.1. NVIDIA reported throughput for a specific serving configuration.',
    checked: '2026-10-30',
    note: 'nemotron-35-transcribe-deployment-costs',
    source: 'https://huggingface.co/nvidia/NVIDIA-Nemotron-3.5-Transcribe-30B-A4B',
  },
  {
    id: 'community-1',
    name: 'pyannote Community-1',
    tasks: ['diarization'],
    access: 'Download',
    summary: 'Find the stretches of a recording that belong to each speaker.',
    terms: 'Gated download under CC BY 4.0. Accept the access conditions before deploying locally.',
    checked: '2026-11-20',
    source: 'https://huggingface.co/pyannote/speaker-diarization-community-1',
  },
  {
    id: 'kokoro',
    name: 'Kokoro-82M',
    tasks: ['speech'],
    access: 'Download',
    summary: 'Turn written text into synthesised speech.',
    terms:
      'Apache 2.0 weights. For local running costs, measure how much audio your device can produce in an hour.',
    checked: '2026-11-20',
    source: 'https://huggingface.co/hexgrad/Kokoro-82M',
  },
  {
    id: 'haru',
    name: 'Haru-4B',
    tasks: ['speech'],
    access: 'Download',
    summary: 'Listen and speak at the same time in a local voice conversation.',
    terms:
      'Apache 2.0 research release. The published latency example used an M1 Max, INT8 weights and wired audio.',
    checked: '2026-11-17',
    note: 'haru-4b-local-speech-latency-costs',
    source: 'https://huggingface.co/higurashi-ai/Haru-4B',
  },
  {
    id: 'gpt-live',
    name: 'GPT-Live 1.1',
    tasks: ['speech'],
    access: 'API',
    summary: 'Host a live conversation and delegate work to a backend model.',
    terms:
      'Active and standby session time have different rates. Backend models and tools add their own charges.',
    checked: '2026-11-20',
    note: 'gpt-live-11-active-standby-backend-costs',
    source: 'https://developers.openai.com/api/docs/models/gpt-live-1.1',
  },
]

export function findProfiles(task: string, query: string) {
  const term = query.trim().toLowerCase()
  return profiles.filter(
    (profile) =>
      (!task || profile.tasks.some((t) => t === task)) &&
      [profile.name, profile.summary, profile.access, profile.terms, ...profile.tasks,
        ...tasks.filter((task) => profile.tasks.includes(task.id)).map((task) => task.label),
      ]
        .join(' ')
        .toLowerCase()
        .includes(term),
  )
}
