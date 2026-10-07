import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { validateRequest, ValidationError } from './lib/validate.js';
import { aiAvailable, generateWithAI, GenerationError } from './lib/ai.js';
import { generateOffline } from './lib/offline.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(here, 'public');
const MAX_BODY_BYTES = 10_000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
};

const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

// Fixed-window per-IP limiter. In-memory is fine for a single instance;
// move to Redis or the platform's limiter when running more than one.
export function createRateLimiter(limit, windowMs = 60_000) {
  const hits = new Map();
  return (key, now = Date.now()) => {
    const entry = hits.get(key);
    if (!entry || now - entry.start >= windowMs) {
      hits.set(key, { start: now, count: 1 });
      if (hits.size > 10_000) {
        for (const [k, v] of hits) if (now - v.start >= windowMs) hits.delete(k);
      }
      return true;
    }
    entry.count += 1;
    return entry.count <= limit;
  };
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SECURITY_HEADERS });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new ValidationError('Request body too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const filePath = path.normalize(path.join(PUBLIC_DIR, urlPath === '/' ? 'index.html' : urlPath));
  // Path traversal guard: resolved path must stay inside PUBLIC_DIR.
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error('not a file');
    const data = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath)] ?? 'application/octet-stream',
      'Cache-Control': 'public, max-age=300',
      ...SECURITY_HEADERS,
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
  }
}

export function createServer({
  rateLimitPerMin = Number(process.env.RATE_LIMIT_PER_MIN) || 6,
  generators = { ai: generateWithAI, offline: generateOffline, aiAvailable },
} = {}) {
  const allow = createRateLimiter(rateLimitPerMin);

  async function handleGenerate(req, res) {
    const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
    if (!allow(ip)) {
      sendJson(res, 429, { error: 'Too many requests. Please wait a minute and try again.' });
      return;
    }
    let input;
    try {
      const raw = await readBody(req);
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        throw new ValidationError('Invalid JSON.');
      }
      input = validateRequest(body);
    } catch (err) {
      if (err instanceof ValidationError) return sendJson(res, 400, { error: err.message });
      throw err;
    }

    if (!generators.aiAvailable()) {
      return sendJson(res, 200, { source: 'demo', ...generators.offline(input) });
    }

    try {
      const result = await generators.ai(input);
      sendJson(res, 200, { source: 'ai', ...result });
    } catch (err) {
      if (err instanceof GenerationError) return sendJson(res, err.status, { error: err.message });
      if (err instanceof Anthropic.RateLimitError) {
        return sendJson(res, 503, { error: 'The AI service is busy. Please try again shortly.' });
      }
      if (err instanceof Anthropic.AuthenticationError) {
        console.error('Anthropic authentication failed: check ANTHROPIC_API_KEY.');
        return sendJson(res, 500, { error: 'Server is misconfigured.' });
      }
      if (err instanceof Anthropic.APIError) {
        console.error('Anthropic API error:', err.status, err.message);
        return sendJson(res, 502, { error: 'The AI service returned an error. Please try again.' });
      }
      throw err;
    }
  }

  return http.createServer(async (req, res) => {
    try {
      const { pathname } = new URL(req.url, 'http://localhost');
      if (pathname === '/api/generate') {
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed.' });
        return await handleGenerate(req, res);
      }
      if (pathname === '/api/health') {
        return sendJson(res, 200, { ok: true, mode: generators.aiAvailable() ? 'ai' : 'demo' });
      }
      if (req.method === 'GET' || req.method === 'HEAD') return await serveStatic(req, res);
      res.writeHead(405).end();
    } catch (err) {
      console.error(err);
      if (!res.headersSent) sendJson(res, 500, { error: 'Unexpected server error.' });
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  createServer().listen(port, () => {
    console.log(`AI Business Generator running at http://localhost:${port} (${aiAvailable() ? 'AI' : 'demo'} mode)`);
  });
}
