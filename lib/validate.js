// Input validation for the /api/generate endpoint.
// Everything the user sends ends up inside an LLM prompt, so we whitelist
// enumerated fields and bound free-text length rather than trying to sanitise.

export const CURRENCIES = ['GHS', 'NGN', 'KES', 'ZAR', 'USD', 'GBP', 'EUR'];
export const BUSINESS_MODELS = ['any', 'product', 'service', 'saas', 'marketplace', 'agency', 'ecommerce'];
export const RISK_LEVELS = ['low', 'medium', 'high'];
export const TIME_COMMITMENTS = ['side', 'part-time', 'full-time'];

const LIMITS = {
  skills: 400,
  interests: 400,
  location: 80,
  targetMarket: 200,
  extra: 500,
};

function cleanText(value, max) {
  if (value == null) return '';
  if (typeof value !== 'string') throw new ValidationError('Text fields must be strings.');
  // Collapse control characters and whitespace runs; keep the text readable for the model.
  const text = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (text.length > max) throw new ValidationError(`Field too long (max ${max} characters).`);
  return text;
}

function pick(value, allowed, fallback) {
  if (value == null || value === '') return fallback;
  if (!allowed.includes(value)) throw new ValidationError(`Invalid option: ${String(value).slice(0, 30)}`);
  return value;
}

export class ValidationError extends Error {}

export function validateRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ValidationError('Request body must be a JSON object.');
  }

  const skills = cleanText(body.skills, LIMITS.skills);
  const interests = cleanText(body.interests, LIMITS.interests);
  if (!skills && !interests) {
    throw new ValidationError('Tell us at least your skills or your interests.');
  }

  const budget = Number(body.budget);
  if (!Number.isFinite(budget) || budget < 0 || budget > 1e9) {
    throw new ValidationError('Budget must be a number between 0 and 1,000,000,000.');
  }

  const count = body.count == null ? 3 : Number(body.count);
  if (!Number.isInteger(count) || count < 1 || count > 5) {
    throw new ValidationError('Number of ideas must be between 1 and 5.');
  }

  return {
    skills,
    interests,
    budget: Math.round(budget),
    currency: pick(body.currency, CURRENCIES, 'GHS'),
    location: cleanText(body.location, LIMITS.location) || 'Accra, Ghana',
    targetMarket: cleanText(body.targetMarket, LIMITS.targetMarket),
    businessModel: pick(body.businessModel, BUSINESS_MODELS, 'any'),
    risk: pick(body.risk, RISK_LEVELS, 'medium'),
    time: pick(body.time, TIME_COMMITMENTS, 'part-time'),
    extra: cleanText(body.extra, LIMITS.extra),
    count,
  };
}
