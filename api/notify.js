// api/notify.js — Teams notification only
// Webhook URL read from Vercel env var TEAMS_WEBHOOK_URL

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { payload } = req.body;
  const teamsUrl = process.env.TEAMS_WEBHOOK_URL || payload?.teamsUrl || '';

  if (!teamsUrl) {
    return res.status(400).json({ error: 'TEAMS_WEBHOOK_URL not configured' });
  }

  try {
    // Build Teams Adaptive Card message
    const card = {
      type: 'message',
      attachments: [{
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: {
          '$schema': 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.4',
          body: [
            {
              type: 'TextBlock',
              text: '🐛 BugForge AI — New Jira Ticket Created',
              weight: 'Bolder',
              size: 'Medium',
              color: 'Accent'
            },
            {
              type: 'FactSet',
              facts: [
                { title: 'Ticket ID',   value: payload?.ticketId   || '-' },
                { title: 'Summary',     value: payload?.summary    || '-' },
                { title: 'Severity',    value: payload?.severity   || '-' },
                { title: 'Priority',    value: payload?.priority   || '-' },
                { title: 'Project',     value: payload?.project    || '-' },
                { title: 'Assignee',    value: payload?.assignee   || 'Unassigned' },
              ]
            },
            ...(payload?.url ? [{
              type: 'ActionSet',
              actions: [{
                type: 'Action.OpenUrl',
                title: '🔗 View in Jira',
                url: payload.url
              }]
            }] : [])
          ]
        }
      }]
    };

    const r = await fetch(teamsUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(card)
    });

    if (!r.ok) {
      const txt = await r.text();
      return res.status(500).json({ error: `Teams webhook failed: ${txt}` });
    }

    return res.json({ ok: true, teams: 'sent' });

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
