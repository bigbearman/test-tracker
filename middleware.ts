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

const SITE_ID = 'aa_569ea2ed4656331dd764d7d0f9a33d7d2444d29924aaec40';
const COLLECT_ENDPOINT = 'https://api-production-feb6.up.railway.app/collect';

/** Layer 1: Server UA match — confidence 95 */
function detectAgent(ua: string): { isAgent: boolean; agentName: string; confidence: number } {
  for (const [name, pattern] of Object.entries(KNOWN_AGENTS)) {
    if (pattern.test(ua)) {
      return { isAgent: true, agentName: name, confidence: 95 };
    }
  }
  return { isAgent: false, agentName: '', confidence: 0 };
}

function sendEvent(
  request: Request,
  agent: { isAgent: boolean; agentName: string; confidence: number },
): Promise<Response> {
  const url = new URL(request.url);
  const ip = ipAddress(request) ?? '';
  const geo = geolocation(request);

  const payload = {
    siteId: SITE_ID,
    url: url.toString(),
    action: 'pageview' as const,
    agent,
    timestamp: Date.now(),
    source: 'server' as const,
    meta: {
      ip,
      country: geo?.country ?? '',
      city: geo?.city ?? '',
      userAgent: request.headers.get('user-agent') ?? '',
    },
  };

  return fetch(COLLECT_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export default function middleware(request: Request, context: RequestContext) {
  const ua = request.headers.get('user-agent') ?? '';
  const agent = detectAgent(ua);

  console.log(`[middleware] ${agent.isAgent ? agent.agentName : 'human'} → ${new URL(request.url).pathname}`);

  // Fire-and-forget: send event without blocking the response
  context.waitUntil(sendEvent(request, agent));

  // Pass through to static files
  return next();
}

// Run on all paths except static assets and internals
export const config = {
  matcher: ['/((?!_next/|_vercel/|favicon\\.ico|.*\\.(?:css|js|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|map|json|xml|txt)).*)'],
};
