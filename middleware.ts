import { next, ipAddress, geolocation } from '@vercel/functions';

interface RequestContext {
  waitUntil(promise: Promise<unknown>): void;
}

// Mirror of packages/types/src/agents.ts — hardcoded to avoid monorepo dependency
const KNOWN_AGENTS: Record<string, RegExp> = {
  GPTBot: /GPTBot/i,
  'ChatGPT-User': /ChatGPT-User/i,
  'OAI-SearchBot': /OAI-SearchBot/i,
  ClaudeBot: /ClaudeBot|Claude-Web/i,
  'Google-Extended': /Google-Extended/i,
  'Gemini-Deep-Research': /Gemini-Deep-Research/i,
  GoogleVertexBot: /Google-CloudVertexBot/i,
  GeminiBot: /GeminiiOS|Gemini\//i,
  PerplexityBot: /PerplexityBot/i,
  ByteSpider: /Bytespider/i,
  FacebookBot: /FacebookBot/i,
  'Meta-ExternalAgent': /Meta-ExternalAgent/i,
  Applebot: /Applebot/i,
  Amazonbot: /Amazonbot/i,
  YouBot: /YouBot/i,
  DuckAssistant: /DuckAssistant|DuckAssistBot/i,
};

const CONFIDENCE = {
  SERVER_UA: 95,
  PATTERN: 40,
  EXTRA_LAYER_BONUS: 5,
  AGENT_THRESHOLD: 50,
};

const SITE_ID = 'aa_569ea2ed4656331dd764d7d0f9a33d7d2444d29924aaec40';
const COLLECT_ENDPOINT = 'https://api-production-feb6.up.railway.app/collect';

interface DetectionResult {
  isAgent: boolean;
  agentName: string;
  confidence: number;
  layers: string[];
}

/**
 * Multi-layer agent detection:
 * Layer 1: UA string match (confidence 95)
 * Layer 3: Request pattern analysis (confidence 40)
 * Combined: max + 5 per extra layer
 */
function detectAgent(request: Request): DetectionResult {
  const ua = request.headers.get('user-agent') ?? '';
  const layers: { name: string; score: number }[] = [];
  let agentName = '';

  // Layer 1: User Agent match
  for (const [name, pattern] of Object.entries(KNOWN_AGENTS)) {
    if (pattern.test(ua)) {
      layers.push({ name: 'ua', score: CONFIDENCE.SERVER_UA });
      agentName = name;
      break;
    }
  }

  // Layer 3: Request pattern analysis
  const patternScore = analyzePatterns(request);
  if (patternScore >= CONFIDENCE.PATTERN) {
    layers.push({ name: 'pattern', score: patternScore });
  }

  if (layers.length === 0) {
    return { isAgent: false, agentName: '', confidence: 0, layers: [] };
  }

  const maxScore = Math.max(...layers.map((l) => l.score));
  const extraLayers = layers.length - 1;
  const finalConfidence = Math.min(100, maxScore + extraLayers * CONFIDENCE.EXTRA_LAYER_BONUS);

  return {
    isAgent: finalConfidence >= CONFIDENCE.AGENT_THRESHOLD,
    agentName: agentName || 'unknown-pattern',
    confidence: finalConfidence,
    layers: layers.map((l) => l.name),
  };
}

/**
 * Layer 3: Analyze request headers for bot-like patterns.
 * Bots typically: no referer, no cookies, no accept-language,
 * unusual accept header, missing sec-fetch-* headers.
 */
function analyzePatterns(request: Request): number {
  let score = 0;

  // No Referer — bots don't navigate from other pages
  if (!request.headers.get('referer')) {
    score += 10;
  }

  // No Cookie — bots don't carry session cookies
  if (!request.headers.get('cookie')) {
    score += 10;
  }

  // No Accept-Language — real browsers always send this
  if (!request.headers.get('accept-language')) {
    score += 15;
  }

  // Accept header missing text/html or is wildcard
  const accept = request.headers.get('accept') ?? '';
  if (!accept || accept === '*/*') {
    score += 10;
  } else if (!accept.includes('text/html')) {
    score += 10;
  }

  // Missing Sec-Fetch-* headers — modern browsers always send these
  if (!request.headers.get('sec-fetch-mode')) {
    score += 10;
  }
  if (!request.headers.get('sec-fetch-site')) {
    score += 5;
  }

  return score;
}

function sendEvent(
  request: Request,
  detection: DetectionResult,
): Promise<Response> {
  const url = new URL(request.url);
  const ip = ipAddress(request) ?? '';
  const geo = geolocation(request);

  const payload = {
    siteId: SITE_ID,
    url: url.toString(),
    action: 'pageview' as const,
    agent: {
      isAgent: detection.isAgent,
      agentName: detection.agentName,
      confidence: detection.confidence,
    },
    timestamp: Date.now(),
    source: 'server' as const,
    meta: {
      ip,
      country: geo?.country ?? '',
      city: geo?.city ?? '',
      userAgent: request.headers.get('user-agent') ?? '',
      layers: detection.layers,
    },
  };

  return fetch(COLLECT_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export default function middleware(request: Request, context: RequestContext) {
  const detection = detectAgent(request);

  const label = detection.isAgent
    ? `${detection.agentName} (${detection.confidence}%, ${detection.layers.join('+')})`
    : 'human';
  console.log(`[middleware] ${label} → ${new URL(request.url).pathname}`);

  // Fire-and-forget: send event without blocking the response
  context.waitUntil(sendEvent(request, detection));

  // Pass through to static files
  return next();
}

// Run on all paths except static assets and internals
export const config = {
  matcher: ['/((?!_next/|_vercel/|favicon\\.ico|.*\\.(?:css|js|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|map|json|xml|txt)).*)'],
};
