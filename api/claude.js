// api/claude.js — Secure Anthropic API proxy
// Anthropic key stored in Vercel env vars — never exposed to browser

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Read key from Vercel environment variable — never from browser
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'ANTHROPIC_API_KEY not configured. Go to Vercel → Settings → Environment Variables and add it.'
    });
  }

  const { model, max_tokens, messages, system, tools } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages array is required' });
  }

  try {
    const body = {
      model: model || 'claude-haiku-4-5',
      max_tokens: max_tokens || 1000,
      messages,
    };
    if (system) body.system = system;
    if (tools)  body.tools  = tools;

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    const d = await r.json();
    if (!r.ok) {
      return res.status(r.status).json({
        error: d.error?.message || `Anthropic ${r.status}`
      });
    }

    return res.json(d);

  } catch (err) {
    console.error('Claude API error:', err);
    return res.status(500).json({ error: err.message });
  }
}
