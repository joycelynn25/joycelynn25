// Output contract shared by the AI generator, the offline generator and the frontend.
// Used as the structured-output JSON schema, so every object closes with
// additionalProperties:false and lists all keys as required.

const costItem = {
  type: 'object',
  properties: {
    item: { type: 'string' },
    cost: { type: 'number' },
  },
  required: ['item', 'cost'],
  additionalProperties: false,
};

const idea = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'Short, memorable business name' },
    tagline: { type: 'string' },
    problem: { type: 'string', description: 'The specific, painful problem and who has it' },
    solution: { type: 'string' },
    target_customers: { type: 'string' },
    business_model: { type: 'string', description: 'How the business makes money' },
    pricing: { type: 'string', description: 'Concrete price points in the requested currency' },
    startup_costs: { type: 'array', items: costItem },
    monthly_operating_cost: { type: 'number' },
    break_even: { type: 'string', description: 'Rough break-even estimate with the assumption it rests on' },
    competitive_edge: { type: 'string' },
    first_90_days: { type: 'array', items: { type: 'string' } },
    validation_experiment: {
      type: 'string',
      description: 'The cheapest test (under 2 weeks) that would prove or kill the idea',
    },
    risks: { type: 'array', items: { type: 'string' } },
    tools_and_channels: { type: 'array', items: { type: 'string' } },
    viability_score: { type: 'integer', description: '1-10 overall commercial viability' },
    viability_rationale: { type: 'string' },
  },
  required: [
    'name', 'tagline', 'problem', 'solution', 'target_customers', 'business_model', 'pricing',
    'startup_costs', 'monthly_operating_cost', 'break_even', 'competitive_edge', 'first_90_days',
    'validation_experiment', 'risks', 'tools_and_channels', 'viability_score', 'viability_rationale',
  ],
  additionalProperties: false,
};

export const RESULT_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'One paragraph reading of the founder profile and market' },
    ideas: { type: 'array', items: idea },
  },
  required: ['summary', 'ideas'],
  additionalProperties: false,
};

// Light post-validation: structured outputs guarantee shape, but we still
// normalise ranges and guard against an empty or oversized list.
export function normaliseResult(result, count) {
  if (!result || !Array.isArray(result.ideas) || result.ideas.length === 0) {
    throw new Error('Generator returned no ideas.');
  }
  return {
    summary: String(result.summary || ''),
    ideas: result.ideas.slice(0, count).map((i) => ({
      ...i,
      viability_score: Math.min(10, Math.max(1, Math.round(Number(i.viability_score) || 5))),
      startup_costs: (i.startup_costs || []).map((c) => ({ item: String(c.item), cost: Math.max(0, Number(c.cost) || 0) })),
      monthly_operating_cost: Math.max(0, Number(i.monthly_operating_cost) || 0),
    })),
  };
}
