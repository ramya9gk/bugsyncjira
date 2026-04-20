// api/jira.js — Vercel Serverless Function v3.4
// ALL Jira API calls run here (server-side). Zero CORS issues.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, config, payload } = req.body;

  // Multi-tenant: load from KV if orgCode provided
  let _org = {};
  if (config?.orgCode && process.env.KV_REST_API_URL) {
    try {
      const _r = await fetch(`${process.env.KV_REST_API_URL}/get/org:${config.orgCode}`, {
        headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` }
      });
      const _d = await _r.json();
      if (_d.result) _org = JSON.parse(_d.result);
    } catch(e) {}
  }
  const jiraUrl   = _org.jiraUrl   || process.env.JIRA_URL   || config?.jiraUrl   || '';
  const jiraEmail = _org.jiraEmail || process.env.JIRA_EMAIL  || config?.jiraEmail || '';
  const jiraToken = _org.jiraToken || process.env.JIRA_TOKEN  || config?.jiraToken || '';
  const jiraProj   = process.env.JIRA_PROJECT|| config?.jiraProj   || '';
  const jiraBoard  = process.env.JIRA_BOARD  || config?.jiraBoard  || '';
  const jiraIssueType    = process.env.JIRA_ISSUE_TYPE     || config?.jiraIssueType    || '';
  const jiraAssignee     = process.env.JIRA_ASSIGNEE_EMAIL || config?.jiraAssignee     || '';
  const jiraReporterEmail= process.env.JIRA_REPORTER_EMAIL || config?.jiraReporterEmail || jiraEmail;

  if (!jiraUrl)   return res.status(400).json({ error: 'JIRA_URL not set. Add to Vercel Environment Variables.' });
  if (!jiraEmail) return res.status(400).json({ error: 'JIRA_EMAIL not set. Add to Vercel Environment Variables.' });
  if (!jiraToken) return res.status(400).json({ error: 'JIRA_TOKEN not set. Add to Vercel Environment Variables.' });
  if (!jiraProj)  return res.status(400).json({ error: 'JIRA_PROJECT not set. Add to Vercel Environment Variables.' });

  const auth = 'Basic ' + Buffer.from(`${jiraEmail}:${jiraToken}`).toString('base64');
  const base = jiraUrl.replace(/\/$/, '');
  const proj = jiraProj.trim().toUpperCase();

  // ── Auto-detect valid issue type for this project ──────────
  async function getIssueType() {
    // If user configured a specific type, use it
    if (jiraIssueType && jiraIssueType.trim()) return jiraIssueType.trim();

    try {
      // Fetch project metadata to get valid issue types
      const r = await fetch(
        `${base}/rest/api/3/project/${proj}`,
        { headers: { Authorization: auth, Accept: 'application/json' } }
      );
      if (!r.ok) return 'Task'; // safe fallback

      const d = await r.json();
      const types = (d.issueTypes || []).map(t => t.name);

      // Priority order: Bug → Story → Task → first available
      const preferred = ['Bug', 'Story', 'Task', 'Issue', 'Defect'];
      for (const t of preferred) {
        if (types.includes(t)) return t;
      }
      // Return first non-subtask type
      const nonSub = (d.issueTypes || []).find(t => !t.subtask);
      return nonSub?.name || 'Task';
    } catch {
      return 'Task';
    }
  }

  // ── Lookup any user accountId from email ─────────────────
  async function lookupAccountId(email) {
    if (!email) return null;
    try {
      const r = await fetch(
        `${base}/rest/api/3/user/search?query=${encodeURIComponent(email)}&maxResults=1`,
        { headers: { Authorization: auth, Accept: 'application/json' } }
      );
      if (!r.ok) return null;
      const users = await r.json();
      const match = users.find(u => u.emailAddress?.toLowerCase() === email.toLowerCase());
      return match?.accountId || users[0]?.accountId || null;
    } catch { return null; }
  }

  // ── Lookup reporter accountId from email ─────────────────
  async function getReporterAccountId() {
    try {
      const r = await fetch(
        `${base}/rest/api/3/user/search?query=${encodeURIComponent(jiraReporterEmail)}&maxResults=1`,
        { headers: { Authorization: auth, Accept: 'application/json' } }
      );
      if (!r.ok) return null;
      const users = await r.json();
      // Find exact email match
      const match = users.find(u =>
        u.emailAddress?.toLowerCase() === jiraReporterEmail.toLowerCase()
      );
      return match?.accountId || users[0]?.accountId || null;
    } catch {
      return null;
    }
  }

  try {
    switch (action) {

      case 'create_issue': {
        const issueType = await getIssueType();

        const issueReporterAccountId = await getReporterAccountId();

        const issueAssigneeAccountId = await lookupAccountId(jiraAssignee);

        const fields = {
          ...payload.fields,
          project:   { key: proj },       // always use configured project key
          issuetype: { name: issueType },  // auto-detected valid issue type
          ...(issueReporterAccountId ? { reporter:  { id: issueReporterAccountId } } : {}),
          ...(issueAssigneeAccountId ? { assignee:  { id: issueAssigneeAccountId } } : {}),
        };

        if (!fields.summary?.trim()) {
          return res.status(400).json({ error: 'Summary is empty — generate the ticket first.' });
        }

        console.log(`Creating Jira issue: project=${proj}, type=${issueType}, summary=${fields.summary?.slice(0,50)}`);

        const r = await fetch(`${base}/rest/api/3/issue`, {
          method: 'POST',
          headers: { Authorization: auth, 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ fields }),
        });

        const d = await r.json();
        if (!r.ok) {
          // Surface ALL error details — both top-level messages and per-field errors.
          // This is what tells us exactly which field Jira is rejecting (e.g.
          // "components: Component name 'XYZ' is not valid" or "priority: Field cannot be set").
          const topMessages = Array.isArray(d.errorMessages) ? d.errorMessages : [];
          const fieldErrors = Object.entries(d.errors || {}).map(([k, v]) => `${k}: ${v}`);
          const allDetails = [...topMessages, ...fieldErrors].filter(Boolean);
          const errMsg = allDetails.length
            ? allDetails.join(' | ')
            : (d.message || `Jira ${r.status}`);
          console.error('Jira create_issue failed:', JSON.stringify({ status: r.status, response: d, sentFields: Object.keys(fields) }));
          return res.status(r.status).json({ error: errMsg, jiraResponse: d });
        }
        return res.json({ id: d.key, url: `${base}/browse/${d.key}` });
      }

      case 'add_comment': {
        const { issueKey, comment } = payload;
        const body = {
          body: { version: 1, type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: comment }] }] }
        };
        const r = await fetch(`${base}/rest/api/3/issue/${issueKey}/comment`, {
          method: 'POST',
          headers: { Authorization: auth, 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(body),
        });
        if (!r.ok) { const e = await r.json(); return res.status(r.status).json({ error: e.errorMessages?.[0] || `Jira ${r.status}` }); }
        return res.json({ ok: true });
      }

      case 'get_issue_types': {
        // Expose available issue types to frontend for sidebar display
        const r = await fetch(`${base}/rest/api/3/project/${proj}`, {
          headers: { Authorization: auth, Accept: 'application/json' },
        });
        if (!r.ok) return res.json({ types: ['Bug', 'Task', 'Story'] });
        const d = await r.json();
        const types = (d.issueTypes || []).filter(t => !t.subtask).map(t => t.name);
        return res.json({ types });
      }

      case 'search_duplicates': {
        const { jql } = payload;
        const r = await fetch(`${base}/rest/api/3/issue/search?jql=${encodeURIComponent(jql)}&maxResults=5&fields=key,summary,status`, {
          headers: { Authorization: auth, Accept: 'application/json' },
        });
        if (!r.ok) return res.json({ issues: [] });
        const d = await r.json();
        return res.json({ issues: (d.issues || []).map(i => ({ id: i.key, title: i.fields.summary, status: i.fields.status.name, url: `${base}/browse/${i.key}` })) });
      }

      case 'get_sprint': {
        if (!jiraBoard) return res.json({ sprint: null });
        const r = await fetch(`${base}/rest/agile/1.0/board/${jiraBoard}/sprint?state=active`, {
          headers: { Authorization: auth, Accept: 'application/json' },
        });
        if (!r.ok) return res.json({ sprint: null });
        const d = await r.json();
        return res.json({ sprint: d.values?.[0] || null });
      }

      case 'assign_sprint': {
        const { sprintId, issueKey } = payload;
        await fetch(`${base}/rest/agile/1.0/sprint/${sprintId}/issue`, {
          method: 'POST',
          headers: { Authorization: auth, 'Content-Type': 'application/json' },
          body: JSON.stringify({ issues: [issueKey] }),
        });
        return res.json({ ok: true });
      }

      case 'link_issue': {
        const { inwardKey, outwardKey } = payload;
        const r = await fetch(`${base}/rest/api/3/issueLink`, {
          method: 'POST',
          headers: { Authorization: auth, 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: { name: 'is child of' }, inwardIssue: { key: inwardKey }, outwardIssue: { key: outwardKey } }),
        });
        if (!r.ok) { const e = await r.json(); return res.status(r.status).json({ error: e.message || `Jira ${r.status}` }); }
        return res.json({ ok: true });
      }

      case 'validate': {
        // Test if Jira credentials are valid
        const r = await fetch(`${base}/rest/api/3/myself`, {
          headers: { Authorization: auth, Accept: 'application/json' },
        });
        if (!r.ok) return res.json({ valid: false, error: `Invalid credentials (${r.status}). Check email and API token.` });
        const d = await r.json();
        return res.json({ valid: true, displayName: d.displayName || d.emailAddress });
      }

      case 'get_reporter': {
        // Return the resolved reporter accountId for sidebar display
        const accountId = await getReporterAccountId();
        if (!accountId) return res.json({ found: false, email: jiraReporterEmail, error: 'User not found in Jira' });
        return res.json({ found: true, accountId, email: jiraReporterEmail });
      }

      default:
        return res.status(400).json({ error: `Unknown action: ${action}` });
    }
  } catch (err) {
    console.error('Jira API error:', err);
    return res.status(500).json({ error: err.message });
  }
}
