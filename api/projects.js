// api/projects.js — Fetch live project lists from Jira and ADO
// Jira: uses env vars for credentials, returns project list
// ADO: uses ADO_PAT from env var, but accepts org from browser (user types it)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { platform, adoOrg } = req.body;

  // ── JIRA projects ──────────────────────────────────────────
  if (platform === 'jira') {
    const jiraUrl   = process.env.JIRA_URL   || '';
    const jiraEmail = process.env.JIRA_EMAIL || '';
    const jiraToken = process.env.JIRA_TOKEN || '';

    if (!jiraUrl || !jiraEmail || !jiraToken) {
      return res.json({ projects: [], error: 'Jira credentials not set in Vercel env vars' });
    }

    const auth = 'Basic ' + Buffer.from(`${jiraEmail}:${jiraToken}`).toString('base64');
    const base = jiraUrl.replace(/\/$/, '');

    try {
      const r = await fetch(`${base}/rest/api/3/project/search?maxResults=50&orderBy=name`, {
        headers: { Authorization: auth, Accept: 'application/json' }
      });
      if (!r.ok) return res.json({ projects: [], error: `Jira ${r.status} — check credentials` });
      const d = await r.json();
      const projects = (d.values || []).map(p => ({
        key: p.key, name: p.name, type: p.projectTypeKey, id: p.id
      }));
      return res.json({ projects });
    } catch (err) {
      return res.json({ projects: [], error: err.message });
    }
  }

  // ── ADO projects ───────────────────────────────────────────
  // ADO_PAT from env var (secure), org name from browser (user types it)
  if (platform === 'azure_devops') {
    const adoPat = process.env.ADO_PAT || '';
    const org    = adoOrg || process.env.ADO_ORG || '';

    if (!adoPat) {
      return res.json({ projects: [], error: 'ADO_PAT not set in Vercel env vars' });
    }
    if (!org) {
      return res.json({ projects: [], error: 'Enter your ADO organisation name first' });
    }

    const auth = 'Basic ' + Buffer.from(`:${adoPat}`).toString('base64');

    try {
      const r = await fetch(
        `https://dev.azure.com/${org}/_apis/projects?api-version=6.0&$top=50`,
        { headers: { Authorization: auth, Accept: 'application/json' } }
      );

      const ct = r.headers.get('content-type') || '';
      if (ct.includes('text/html')) {
        return res.json({ projects: [], error: 'Invalid organisation name or PAT expired' });
      }
      if (r.status === 401) {
        return res.json({ projects: [], error: 'ADO PAT is invalid or expired — update ADO_PAT in Vercel' });
      }
      if (r.status === 404) {
        return res.json({ projects: [], error: `Organisation "${org}" not found — check spelling` });
      }
      if (!r.ok) return res.json({ projects: [], error: `ADO ${r.status}` });

      const d = await r.json();
      const projects = (d.value || []).map(p => ({
        key: p.id, name: p.name, id: p.id
      }));
      return res.json({ projects });
    } catch (err) {
      return res.json({ projects: [], error: err.message });
    }
  }

  return res.status(400).json({ error: `Unknown platform: ${platform}` });
}
