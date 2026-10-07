// Client for the AI Business Generator. All model output is rendered with
// textContent (never innerHTML) so generated text cannot inject markup.

const HISTORY_KEY = 'vf-history-v1';
const THEME_KEY = 'vf-theme';
const MAX_HISTORY = 6;

const $ = (sel) => document.querySelector(sel);

const storage = {
  get(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode or quota: non-critical */ }
  },
};

function money(value, currency) {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);
  } catch {
    return `${Math.round(value).toLocaleString('en-US')} ${currency}`;
  }
}

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (className) node.className = className;
  return node;
}

/* ---------- Theme ---------- */
function initTheme() {
  const saved = storage.get(THEME_KEY, null);
  if (saved) document.documentElement.dataset.theme = saved;
  $('#theme-toggle').addEventListener('click', () => {
    const current = document.documentElement.dataset.theme
      || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    storage.set(THEME_KEY, next);
  });
}

/* ---------- Mode badge ---------- */
async function showMode() {
  const badge = $('#mode-badge');
  try {
    const res = await fetch('/api/health');
    const { mode } = await res.json();
    badge.textContent = mode === 'ai' ? '● AI mode' : '● Demo mode: template ideas';
    badge.classList.toggle('ai', mode === 'ai');
    badge.hidden = false;
  } catch { /* badge is informational only */ }
}

/* ---------- Rendering ---------- */
function renderIdea(idea, input) {
  const node = $('#idea-template').content.firstElementChild.cloneNode(true);
  node.querySelector('.idea-name').textContent = idea.name;
  node.querySelector('.idea-tagline').textContent = idea.tagline;

  const score = node.querySelector('.score');
  score.querySelector('.score-num').textContent = idea.viability_score;
  score.classList.add(idea.viability_score >= 7 ? 'high' : idea.viability_score >= 5 ? 'mid' : 'low');

  node.querySelectorAll('[data-field]').forEach((n) => { n.textContent = idea[n.dataset.field] ?? ''; });
  node.querySelectorAll('[data-list]').forEach((list) => {
    (idea[list.dataset.list] || []).forEach((item) => list.append(el('li', item)));
  });

  const tbody = node.querySelector('tbody');
  let total = 0;
  for (const { item, cost } of idea.startup_costs) {
    total += cost;
    const tr = document.createElement('tr');
    tr.append(el('td', item), el('td', money(cost, input.currency)));
    tbody.append(tr);
  }
  node.querySelector('.cost-total').textContent = money(total, input.currency);
  node.querySelector('.cost-monthly').textContent = money(idea.monthly_operating_cost, input.currency);

  const flag = node.querySelector('.budget-flag');
  flag.hidden = false;
  if (total > input.budget) {
    flag.textContent = `⚠ ${money(total - input.budget, input.currency)} over your budget. Start with a smaller pilot or pre-sales.`;
  } else if (input.budget - total < idea.monthly_operating_cost) {
    flag.textContent = `⚠ Fits your budget but leaves less than one month of running costs (${money(input.budget - total, input.currency)} left). Plan for pre-sales.`;
  } else {
    flag.textContent = `✓ Fits your budget with ${money(input.budget - total, input.currency)} left as runway.`;
    flag.classList.add('ok');
  }
  return node;
}

function renderResults(entry) {
  const { input, result } = entry;
  const container = $('#results');
  container.replaceChildren();

  const bar = el('div', null, 'results-bar');
  bar.append(el('h2', `${result.ideas.length} idea${result.ideas.length > 1 ? 's' : ''} for you`));
  const actions = el('div', null, 'actions');
  const copyBtn = el('button', 'Copy as Markdown', 'btn btn-ghost btn-small');
  copyBtn.type = 'button';
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(toMarkdown(entry));
      copyBtn.textContent = 'Copied ✓';
    } catch {
      copyBtn.textContent = 'Copy failed';
    }
    setTimeout(() => { copyBtn.textContent = 'Copy as Markdown'; }, 1800);
  });
  const dlBtn = el('button', 'Download', 'btn btn-ghost btn-small');
  dlBtn.type = 'button';
  dlBtn.addEventListener('click', () => {
    const blob = new Blob([toMarkdown(entry)], { type: 'text/markdown' });
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(blob),
      download: `business-ideas-${new Date(entry.at).toISOString().slice(0, 10)}.md`,
    });
    a.click();
    URL.revokeObjectURL(a.href);
  });
  const printBtn = el('button', 'Print / PDF', 'btn btn-ghost btn-small');
  printBtn.type = 'button';
  printBtn.addEventListener('click', () => window.print());
  const newBtn = el('button', 'Start over', 'btn btn-ghost btn-small');
  newBtn.type = 'button';
  newBtn.addEventListener('click', () => { showEmpty(); $('#skills').focus(); });
  actions.append(copyBtn, dlBtn, printBtn, newBtn);
  bar.append(actions);
  container.append(bar);

  if (result.summary) {
    const summary = el('div', null, 'card summary');
    summary.append(el('p', result.summary));
    container.append(summary);
  }
  result.ideas.forEach((idea) => container.append(renderIdea(idea, input)));
}

function showLoading(count) {
  const container = $('#results');
  container.replaceChildren();
  const wrap = el('div', null, 'loading');
  wrap.append(el('p', 'Researching costs, customers and risks… this can take up to a minute.', 'muted'));
  for (let i = 0; i < count; i++) wrap.append(el('div', null, 'skeleton'));
  container.append(wrap);
}

let emptyStateNode;
function showEmpty() {
  $('#results').replaceChildren(emptyStateNode);
  renderHistory();
}

/* ---------- History ---------- */
function renderHistory() {
  const history = storage.get(HISTORY_KEY, []);
  const wrap = emptyStateNode.querySelector('#history');
  const list = emptyStateNode.querySelector('#history-list');
  list.replaceChildren();
  wrap.hidden = history.length === 0;
  history.forEach((entry) => {
    const btn = el('button', `${new Date(entry.at).toLocaleString()} · ${entry.result.ideas.map((i) => i.name).join(', ')}`);
    btn.type = 'button';
    btn.addEventListener('click', () => renderResults(entry));
    const li = document.createElement('li');
    li.append(btn);
    list.append(li);
  });
  if (history.length) {
    const clear = el('button', 'Clear history');
    clear.type = 'button';
    clear.addEventListener('click', () => { storage.set(HISTORY_KEY, []); renderHistory(); });
    const li = document.createElement('li');
    li.append(clear);
    list.append(li);
  }
}

function saveHistory(entry) {
  const history = storage.get(HISTORY_KEY, []);
  history.unshift(entry);
  storage.set(HISTORY_KEY, history.slice(0, MAX_HISTORY));
}

/* ---------- Export ---------- */
function toMarkdown({ input, result }) {
  const lines = ['# Business ideas', '', `_Profile: ${input.skills || '-'} | ${input.interests || '-'} | budget ${money(input.budget, input.currency)} | ${input.location}_`, ''];
  if (result.summary) lines.push(result.summary, '');
  result.ideas.forEach((idea, n) => {
    const total = idea.startup_costs.reduce((a, c) => a + c.cost, 0);
    lines.push(
      `## ${n + 1}. ${idea.name} (${idea.viability_score}/10)`, `*${idea.tagline}*`, '',
      `**Problem:** ${idea.problem}`, '', `**Solution:** ${idea.solution}`, '',
      `**Customers:** ${idea.target_customers}`, '', `**Business model:** ${idea.business_model}`, '',
      `**Pricing:** ${idea.pricing}`, '', `**Break-even:** ${idea.break_even}`, '',
      '### Startup costs', '| Item | Cost |', '|---|---|',
      ...idea.startup_costs.map((c) => `| ${c.item} | ${money(c.cost, input.currency)} |`),
      `| **Total** | **${money(total, input.currency)}** |`, '',
      `Monthly running cost: ${money(idea.monthly_operating_cost, input.currency)}`, '',
      '### Validation experiment', idea.validation_experiment, '',
      '### First 90 days', ...idea.first_90_days.map((s, i) => `${i + 1}. ${s}`), '',
      `**Competitive edge:** ${idea.competitive_edge}`, '',
      '### Risks', ...idea.risks.map((r) => `- ${r}`), '',
      `**Tools & channels:** ${idea.tools_and_channels.join(', ')}`, '',
      `**Why this score:** ${idea.viability_rationale}`, '',
    );
  });
  return lines.join('\n');
}

/* ---------- Form ---------- */
function readForm(form) {
  const data = Object.fromEntries(new FormData(form));
  return { ...data, budget: Number(data.budget), count: Number(data.count) };
}

function showError(message) {
  const box = $('#form-error');
  box.textContent = message;
  box.hidden = !message;
}

async function onSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const input = readForm(form);
  showError('');

  if (!input.skills.trim() && !input.interests.trim()) {
    showError('Add at least your skills or your interests.');
    $('#skills').focus();
    return;
  }
  if (!Number.isFinite(input.budget) || input.budget < 0) {
    showError('Enter a valid budget.');
    $('#budget').focus();
    return;
  }

  const btn = $('#submit-btn');
  btn.disabled = true;
  btn.textContent = 'Generating…';
  showLoading(input.count);
  if (matchMedia('(max-width: 860px)').matches) $('#results').scrollIntoView({ block: 'start' });

  try {
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(payload.error || `Request failed (${res.status}).`);
    const entry = { at: Date.now(), source: payload.source, input, result: { summary: payload.summary, ideas: payload.ideas } };
    saveHistory(entry);
    renderResults(entry);
  } catch (err) {
    showEmpty();
    showError(err.message === 'Failed to fetch' ? 'Network error. Check your connection and try again.' : err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Generate ideas';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  emptyStateNode = $('#empty-state');
  initTheme();
  showMode();
  renderHistory();
  $('#gen-form').addEventListener('submit', onSubmit);
  // Expand collapsed sections so printed / PDF output is complete.
  window.addEventListener('beforeprint', () => document.querySelectorAll('.idea details').forEach((d) => { d.open = true; }));
});
