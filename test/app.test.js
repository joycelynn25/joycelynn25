import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateRequest, ValidationError } from '../lib/validate.js';
import { generateOffline } from '../lib/offline.js';
import { RESULT_SCHEMA } from '../lib/schema.js';
import { createServer, createRateLimiter } from '../server.js';

const validBody = { skills: 'python, web development', interests: 'fintech', budget: 5000, currency: 'GHS', count: 3 };

test('validateRequest applies defaults and trims', () => {
  const v = validateRequest({ skills: '  coding\n\n ', budget: '2000' });
  assert.equal(v.skills, 'coding');
  assert.equal(v.budget, 2000);
  assert.equal(v.currency, 'GHS');
  assert.equal(v.count, 3);
  assert.equal(v.location, 'Accra, Ghana');
});

test('validateRequest rejects bad input', () => {
  assert.throws(() => validateRequest(null), ValidationError);
  assert.throws(() => validateRequest({ budget: 100 }), /skills or your interests/);
  assert.throws(() => validateRequest({ ...validBody, budget: -1 }), ValidationError);
  assert.throws(() => validateRequest({ ...validBody, currency: 'BTC' }), ValidationError);
  assert.throws(() => validateRequest({ ...validBody, count: 9 }), ValidationError);
  assert.throws(() => validateRequest({ ...validBody, skills: 'x'.repeat(401) }), /too long/);
  assert.throws(() => validateRequest({ ...validBody, skills: { $gt: 1 } }), ValidationError);
});

test('offline generator matches skills and honours count and currency', () => {
  const out = generateOffline(validateRequest({ ...validBody, count: 2, currency: 'USD' }));
  assert.equal(out.ideas.length, 2);
  assert.equal(out.ideas[0].name, 'MoMo Ledger');
  assert.match(out.ideas[0].pricing, /USD/);
  for (const idea of out.ideas) {
    assert.ok(idea.viability_score >= 1 && idea.viability_score <= 10);
    for (const key of RESULT_SCHEMA.properties.ideas.items.required) assert.ok(key in idea, `missing ${key}`);
  }
});

test('offline generator flags over-budget ideas', () => {
  const out = generateOffline(validateRequest({ ...validBody, budget: 100, count: 1 }));
  assert.match(out.ideas[0].risks[0], /exceeds your budget/);
});

test('schema objects are closed and fully required (structured-output contract)', () => {
  const walk = (node) => {
    if (node.type === 'object') {
      assert.equal(node.additionalProperties, false);
      assert.deepEqual([...node.required].sort(), Object.keys(node.properties).sort());
      Object.values(node.properties).forEach(walk);
    } else if (node.type === 'array') walk(node.items);
  };
  walk(RESULT_SCHEMA);
});

test('rate limiter allows up to the limit per window', () => {
  const allow = createRateLimiter(2, 1000);
  assert.equal(allow('a', 0), true);
  assert.equal(allow('a', 10), true);
  assert.equal(allow('a', 20), false);
  assert.equal(allow('b', 20), true);
  assert.equal(allow('a', 1001), true);
});

async function withServer(options, fn) {
  const server = createServer(options).listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await fn(base); } finally { server.close(); }
}

const demoGenerators = { aiAvailable: () => false, offline: generateOffline, ai: () => { throw new Error('unused'); } };

test('POST /api/generate returns demo ideas without an API key', async () => {
  await withServer({ generators: demoGenerators }, async (base) => {
    const res = await fetch(`${base}/api/generate`, { method: 'POST', body: JSON.stringify(validBody) });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.source, 'demo');
    assert.equal(body.ideas.length, 3);
  });
});

test('POST /api/generate uses the AI generator when available', async () => {
  const fake = { summary: 's', ideas: [{ name: 'X' }] };
  const generators = { aiAvailable: () => true, ai: async () => fake, offline: generateOffline };
  await withServer({ generators }, async (base) => {
    const res = await fetch(`${base}/api/generate`, { method: 'POST', body: JSON.stringify(validBody) });
    const body = await res.json();
    assert.equal(body.source, 'ai');
    assert.equal(body.ideas[0].name, 'X');
  });
});

test('API rejects invalid JSON, wrong method and over-limit clients', async () => {
  await withServer({ generators: demoGenerators, rateLimitPerMin: 2 }, async (base) => {
    assert.equal((await fetch(`${base}/api/generate`)).status, 405);
    assert.equal((await fetch(`${base}/api/generate`, { method: 'POST', body: '{nope' })).status, 400);
    assert.equal((await fetch(`${base}/api/generate`, { method: 'POST', body: JSON.stringify(validBody) })).status, 200);
    assert.equal((await fetch(`${base}/api/generate`, { method: 'POST', body: JSON.stringify(validBody) })).status, 429);
  });
});

test('static files are served with security headers and traversal is blocked', async () => {
  await withServer({ generators: demoGenerators }, async (base) => {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
    assert.match(await res.text(), /AI business generator/i);
    const trav = await fetch(`${base}/%2e%2e/package.json`);
    assert.notEqual(trav.status, 200);
  });
});
