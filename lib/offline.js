// Deterministic, template-based generator used when no API key is configured.
// It lets the site run end-to-end (demo, local dev, tests) without spending tokens.
// Output follows the same schema as the AI generator but is clearly labelled as demo data.

import { normaliseResult } from './schema.js';

// Costs are expressed in GHS and converted to the requested currency with
// rough, static rates. Good enough for a demo; the AI path prices natively.
const GHS_PER = { GHS: 1, NGN: 0.0095, KES: 0.12, ZAR: 0.85, USD: 15.5, GBP: 20, EUR: 17 };

const TEMPLATES = [
  {
    keywords: ['code', 'program', 'software', 'web', 'developer', 'tech', 'ai', 'automation', 'computer'],
    models: ['saas', 'service', 'agency'],
    name: 'MoMo Ledger',
    tagline: 'WhatsApp bookkeeping for market traders',
    problem: 'Small traders take mobile-money payments all day but cannot see daily profit, which blocks them from loans.',
    solution: 'A WhatsApp bot that reads MoMo SMS confirmations forwarded by the trader and sends a daily profit summary and monthly statement usable for microfinance applications.',
    target_customers: 'Market traders and kiosk owners already using mobile money',
    business_model: 'Monthly subscription plus a referral fee from partner microfinance institutions',
    pricing: [30, 'per month per trader'],
    costs: [['WhatsApp Business API + hosting (3 months)', 1500], ['Laptop/phone data bundles', 400], ['Flyers and market activation', 600], ['Business registration', 500]],
    monthly: 900,
    tools: ['WhatsApp Business Platform', 'Node.js or Python', 'Market-association partnerships'],
  },
  {
    keywords: ['food', 'cook', 'catering', 'bake', 'restaurant', 'farm', 'agri'],
    models: ['product', 'ecommerce'],
    name: 'Desk Lunch Co.',
    tagline: 'Pre-ordered, healthy lunches for offices',
    problem: 'Office workers lose time and money queuing for inconsistent lunch, and companies have no simple meal-benefit option.',
    solution: 'A weekly pre-order menu on WhatsApp, cooked in batches and delivered to office clusters at fixed times, with company-paid plans.',
    target_customers: 'Office staff and HR managers in business districts',
    business_model: 'Per-meal margin plus monthly corporate meal plans',
    pricing: [45, 'per meal; corporate plans at 20 meals/month'],
    costs: [['Kitchen equipment and cooler boxes', 2500], ['Food health permit and registration', 800], ['Packaging (first month)', 700], ['Starter ingredients', 1000]],
    monthly: 6000,
    tools: ['WhatsApp catalogue', 'Mobile money', 'Delivery riders on commission'],
  },
  {
    keywords: ['teach', 'tutor', 'education', 'train', 'coach', 'write', 'english', 'math'],
    models: ['service', 'saas', 'product'],
    name: 'ExamPrep Circles',
    tagline: 'Small-group WASSCE/BECE revision that parents can track',
    problem: 'Parents pay for extra classes but cannot see whether their child is improving.',
    solution: 'Small online and in-person revision groups with weekly mock quizzes and a progress report sent to parents on WhatsApp.',
    target_customers: 'Parents of JHS/SHS final-year students',
    business_model: 'Termly subscription per student',
    pricing: [250, 'per student per term'],
    costs: [['Past-question materials and printing', 600], ['Venue rental (first month)', 800], ['Google Workspace / quiz tools', 300], ['Promotion in churches and schools', 500]],
    monthly: 1500,
    tools: ['Google Forms quizzes', 'WhatsApp groups', 'Church and PTA networks'],
  },
  {
    keywords: ['design', 'video', 'photo', 'content', 'market', 'social', 'media', 'creative', 'brand'],
    models: ['agency', 'service'],
    name: 'ShopFront Studio',
    tagline: 'Product photos and catalogues that sell on WhatsApp and Instagram',
    problem: 'Small online sellers lose sales because their product photos and listings look untrustworthy.',
    solution: 'A fixed-price package: product photoshoot, background clean-up, WhatsApp catalogue setup and 30 social posts.',
    target_customers: 'Instagram and WhatsApp sellers, boutiques, cosmetic brands',
    business_model: 'Fixed-price packages plus a monthly content retainer',
    pricing: [800, 'per starter package; retainer from 1,200/month'],
    costs: [['Lightbox, backdrop and lighting kit', 1800], ['Editing software subscription', 400], ['Portfolio shoots (free for first 5 clients)', 300]],
    monthly: 700,
    tools: ['Canva/Photoshop', 'Instagram', 'WhatsApp Business catalogue'],
  },
  {
    keywords: ['fashion', 'cloth', 'beauty', 'hair', 'sew', 'tailor', 'cosmetic'],
    models: ['product', 'ecommerce', 'service'],
    name: 'Kente Basics',
    tagline: 'Everyday wear with modern African prints, made to order',
    problem: 'Young professionals want affordable African-print workwear but tailors are slow and sizes are inconsistent.',
    solution: 'A small standard-size collection sold online, produced in short batches with partner tailors and delivered within 5 days.',
    target_customers: 'Young professionals and diaspora gift buyers',
    business_model: 'Product margin on made-to-order pieces',
    pricing: [280, 'per piece'],
    costs: [['Fabric for sample collection', 1500], ['Partner tailor samples', 1000], ['Photoshoot', 500], ['Packaging and labels', 400]],
    monthly: 1200,
    tools: ['Instagram/TikTok', 'Paystack or MoMo checkout', 'Partner tailors'],
  },
  {
    keywords: [],
    models: ['service', 'marketplace', 'any'],
    name: 'FixIt Connect',
    tagline: 'Vetted artisans booked through WhatsApp',
    problem: 'Households struggle to find reliable plumbers, electricians and AC technicians, and artisans struggle to find steady work.',
    solution: 'A curated roster of vetted artisans in one neighbourhood, booked via WhatsApp with a fixed call-out fee and a satisfaction guarantee.',
    target_customers: 'Middle-income households and small offices in one estate or district',
    business_model: '15% commission on each job',
    pricing: [50, 'call-out fee plus 15% commission on the job'],
    costs: [['Artisan vetting and ID checks', 600], ['Branded T-shirts for artisans', 500], ['Estate flyers and WhatsApp ads', 700]],
    monthly: 600,
    tools: ['WhatsApp Business', 'Google Sheets job log', 'Estate WhatsApp groups'],
  },
];

function score(template, input) {
  const text = `${input.skills} ${input.interests} ${input.extra}`.toLowerCase();
  let s = template.keywords.reduce((acc, k) => acc + (text.includes(k) ? 3 : 0), 0);
  if (input.businessModel !== 'any' && template.models.includes(input.businessModel)) s += 2;
  return s;
}

function convert(ghs, currency) {
  const rate = GHS_PER[currency] ?? 1;
  const value = ghs / rate;
  // Round to a sensible precision for the currency's magnitude.
  const step = value >= 10000 ? 500 : value >= 1000 ? 50 : value >= 100 ? 5 : 1;
  return Math.max(step, Math.round(value / step) * step);
}

export function generateOffline(input) {
  const ranked = TEMPLATES
    .map((t, idx) => ({ t, s: score(t, input), idx }))
    .sort((a, b) => b.s - a.s || a.idx - b.idx)
    .slice(0, input.count);

  const ideas = ranked.map(({ t, s }) => {
    const costs = t.costs.map(([item, ghs]) => ({ item, cost: convert(ghs, input.currency) }));
    const total = costs.reduce((a, c) => a + c.cost, 0);
    const overBudget = total > input.budget;
    const price = convert(t.pricing[0], input.currency);
    const monthly = convert(t.monthly, input.currency);
    const breakEvenUnits = Math.ceil(monthly / Math.max(1, price * 0.4));

    return {
      name: t.name,
      tagline: t.tagline,
      problem: t.problem,
      solution: t.solution,
      target_customers: `${t.target_customers} in ${input.location}`,
      business_model: t.business_model,
      pricing: `${price.toLocaleString('en-US')} ${input.currency} ${t.pricing[1]}`,
      startup_costs: costs,
      monthly_operating_cost: monthly,
      break_even: `About ${breakEvenUnits} paid sales per month at an assumed 40% gross margin.`,
      competitive_edge: 'Narrow focus on one customer segment and one neighbourhood, with WhatsApp-first service and mobile-money payments.',
      first_90_days: [
        'Weeks 1-2: run the validation experiment below before spending most of the budget.',
        'Weeks 3-4: register the business name and set up a mobile-money merchant account.',
        'Month 2: serve the first 10 paying customers by hand and record every objection.',
        'Month 3: standardise the offer, set prices from real data, and ask for referrals.',
      ],
      validation_experiment: `Message 30 potential customers in ${input.location} with a one-paragraph offer and price; count how many pay a deposit within 7 days. Fewer than 3 deposits means rework or drop the idea.`,
      risks: [
        overBudget
          ? `Estimated startup cost (${total.toLocaleString('en-US')} ${input.currency}) exceeds your budget; start with a smaller pilot or pre-sales.`
          : 'Low barriers to entry mean competitors can copy the offer quickly.',
        'Customer acquisition may be slower than expected without referrals.',
        'Payment delays and informal pricing pressure can squeeze cash flow.',
      ],
      tools_and_channels: t.tools,
      viability_score: Math.max(3, Math.min(8, 5 + Math.floor(s / 3) - (overBudget ? 2 : 0))),
      viability_rationale: 'Demo-mode estimate from keyword matching, not market analysis. Connect the AI for a reasoned score.',
    };
  });

  return normaliseResult({
    summary: `Demo mode: these ideas come from built-in templates matched to your skills and interests, priced in ${input.currency}. Add an Anthropic API key on the server for tailored, AI-generated plans.`,
    ideas,
  }, input.count);
}
