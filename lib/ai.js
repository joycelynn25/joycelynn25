import Anthropic from '@anthropic-ai/sdk';
import { RESULT_SCHEMA, normaliseResult } from './schema.js';

const MODEL = 'claude-opus-5-5';

// Frozen system prompt: kept byte-stable so it can be prompt-cached.
const SYSTEM_PROMPT = `You are a pragmatic startup strategist and small-business advisor with deep knowledge of emerging markets, especially Ghana and West Africa.

Generate business ideas that a specific founder can actually start with their real skills, budget and time. Rules:
- Prefer boring, cash-generating businesses over hype. An idea must have a paying customer within 90 days.
- Every startup cost must fit within the stated budget. If the budget is very small, propose service-first or pre-sale models.
- Use the requested currency for every amount, with realistic local prices.
- Account for local realities where relevant: mobile money (MTN MoMo, Telecel Cash, AirtelTigo Money), WhatsApp-first commerce, intermittent power and data, informal-sector customers, trust, and regulatory steps (e.g. business registration with the Office of the Registrar of Companies in Ghana, GRA tax ID, sector licences).
- Be honest: the viability score must reflect real competition, willingness to pay and execution risk. Do not inflate it.
- The validation experiment must be cheap, fast (under 2 weeks) and capable of killing the idea.
- Ideas must be distinct from one another (different customers or models, not variations of one idea).
- Never recommend anything illegal, deceptive or unsafe.`;

let client;
function getClient() {
  client ??= new Anthropic({ timeout: 120_000, maxRetries: 2 });
  return client;
}

export function aiAvailable() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

function buildUserPrompt(input) {
  const lines = [
    `Generate ${input.count} business idea${input.count > 1 ? 's' : ''} for this founder.`,
    '',
    `Skills: ${input.skills || '(not specified)'}`,
    `Interests: ${input.interests || '(not specified)'}`,
    `Starting budget: ${input.budget.toLocaleString('en-US')} ${input.currency}`,
    `Location: ${input.location}`,
    `Target market: ${input.targetMarket || 'open'}`,
    `Preferred business model: ${input.businessModel}`,
    `Risk appetite: ${input.risk}`,
    `Time commitment: ${input.time}`,
  ];
  if (input.extra) lines.push(`Additional context: ${input.extra}`);
  lines.push('', `All money amounts in ${input.currency}.`);
  return lines.join('\n');
}

export async function generateWithAI(input) {
  const response = await getClient().beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: buildUserPrompt(input) }],
    output_config: {
      effort: 'medium',
      format: { type: 'json_schema', schema: RESULT_SCHEMA },
    },
    // Re-runs a safety-declined request on Anthropic's recommended fallback model.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
  });

  if (response.stop_reason === 'refusal') {
    throw new GenerationError('The AI declined this request. Try rephrasing your inputs.', 422);
  }
  if (response.stop_reason === 'max_tokens') {
    throw new GenerationError('The response was too long. Try requesting fewer ideas.', 502);
  }

  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new GenerationError('The AI returned malformed output. Please try again.', 502);
  }
  return normaliseResult(parsed, input.count);
}

export class GenerationError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.status = status;
  }
}

export { buildUserPrompt };
