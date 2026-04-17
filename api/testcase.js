// api/testcase.js — Create test cases in Jira and ADO
// Jira: issue type "Test" linked to Bug
// ADO: standalone Test Case work item linked via TestedBy

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { platform, testCases, bugId, rawBugId, config } = req.body;
  // Read from Vercel env vars first, fall back to browser config
  const jiraUrl   = process.env.JIRA_URL     || config?.jiraUrl   || '';
  const jiraEmail = process.env.JIRA_EMAIL   || config?.jiraEmail || '';
  const jiraToken = process.env.JIRA_TOKEN   || config?.jiraToken || '';
  const jiraProj  = process.env.JIRA_PROJECT || config?.jiraProj  || '';
  const adoOrg    = process.env.ADO_ORG      || config?.adoOrg    || '';
  const adoProj   = process.env.ADO_PROJECT  || config?.adoProj   || '';
  const adoPat    = process.env.ADO_PAT      || config?.adoPat    || '';

  try {
    // ══ JIRA ══════════════════════════════════════════════════
    if (platform === 'jira') {
      if (!jiraUrl || !jiraEmail || !jiraToken || !jiraProj) {
        return res.status(400).json({ error: 'Jira credentials missing' });
      }

      const auth = 'Basic ' + Buffer.from(`${jiraEmail}:${jiraToken}`).toString('base64');
      const base = jiraUrl.replace(/\/$/, '');
      const proj = jiraProj.trim().toUpperCase();

      const created = [];
      const errors = [];

      for (const tc of testCases) {
        try {
          // Step 1 — Create Test issue
          const body = {
            fields: {
              project: { key: proj },
              issuetype: { name: 'Test' },
              summary: `TC_${tc.summary}`,
              description: {
                version: 1, type: 'doc',
                content: [
                  {
                    type: 'heading', attrs: { level: 3 },
                    content: [{ type: 'text', text: `Test Type: ${tc.type}` }]
                  },
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: tc.description || '' }]
                  },
                  {
                    type: 'heading', attrs: { level: 3 },
                    content: [{ type: 'text', text: 'Gherkin Scenario' }]
                  },
                  {
                    type: 'codeBlock', attrs: { language: 'gherkin' },
                    content: [{ type: 'text', text: tc.gherkin }]
                  }
                ]
              },
              labels: ['AI-Generated', 'TestCase', tc.type.replace(' ', '-')]
            }
          };

          const r = await fetch(`${base}/rest/api/3/issue`, {
            method: 'POST',
            headers: { Authorization: auth, 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify(body)
          });

          const d = await r.json();
          if (!r.ok) {
            errors.push(`${tc.type}: ${d.errorMessages?.[0] || Object.values(d.errors||{})[0] || `Jira ${r.status}`}`);
            continue;
          }

          const testKey = d.key;

          // Step 2 — Link Test to Bug ("tested by")
          await fetch(`${base}/rest/api/3/issueLink`, {
            method: 'POST',
            headers: { Authorization: auth, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: { name: 'Test' },
              inwardIssue: { key: bugId },
              outwardIssue: { key: testKey }
            })
          }).catch(() => {
            // Try alternate link type names
            fetch(`${base}/rest/api/3/issueLink`, {
              method: 'POST',
              headers: { Authorization: auth, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                type: { name: 'tested by' },
                inwardIssue: { key: bugId },
                outwardIssue: { key: testKey }
              })
            }).catch(() => {});
          });

          created.push({ id: testKey, url: `${base}/browse/${testKey}`, type: tc.type });
        } catch (e) {
          errors.push(`${tc.type}: ${e.message}`);
        }
      }

      return res.json({ created, errors, platform: 'jira' });
    }

    // ══ ADO ═══════════════════════════════════════════════════
    if (platform === 'azure_devops') {
      if (!adoOrg || !adoPat || !adoProj) {
        return res.status(400).json({ error: 'ADO credentials missing' });
      }

      const auth = 'Basic ' + Buffer.from(`:${adoPat}`).toString('base64');
      const proj = encodeURIComponent(adoProj);
      const base = `https://dev.azure.com/${adoOrg}`;

      const created = [];
      const errors = [];

      for (const tc of testCases) {
        try {
          // Build ADO XML steps from Gherkin lines
          const lines = tc.gherkin.split('\n').filter(l => l.trim());
          const stepLines = lines.filter(l =>
            /^(Given|When|Then|And|But|Scenario|Feature)/i.test(l.trim())
          );

          const stepsXml = stepLines.map((line, i) => `
            <step id="${i + 1}" type="ActionStep">
              <parameterizedString isformatted="true">&lt;DIV&gt;&lt;P&gt;${line.trim()}&lt;/P&gt;&lt;/DIV&gt;</parameterizedString>
              <parameterizedString isformatted="true">&lt;DIV&gt;&lt;P&gt;Step passes&lt;/P&gt;&lt;/DIV&gt;</parameterizedString>
              <description/>
            </step>`).join('');

          const stepsXmlFull = `<steps id="0" last="${stepLines.length}">${stepsXml}</steps>`;

          // Step 1 — Create Test Case work item
          const patch = [
            { op: 'add', path: '/fields/System.Title', value: `TC_${tc.summary}` },
            { op: 'add', path: '/fields/System.Description', value: `<p><strong>${tc.type} Test Case</strong></p><p>${tc.description || ''}</p><pre>${tc.gherkin}</pre>` },
            { op: 'add', path: '/fields/Microsoft.VSTS.TCM.Steps', value: stepsXmlFull },
            { op: 'add', path: '/fields/Microsoft.VSTS.Common.Priority', value: tc.type === 'Regression' ? 1 : tc.type === 'Positive' ? 2 : 3 },
            { op: 'add', path: '/fields/System.Tags', value: `AI-Generated; ${tc.type}; TestCase` },
          ];

          const r = await fetch(
            `${base}/${proj}/_apis/wit/workitems/$Test%20Case?api-version=6.0`,
            {
              method: 'POST',
              headers: { Authorization: auth, 'Content-Type': 'application/json-patch+json', Accept: 'application/json' },
              body: JSON.stringify(patch)
            }
          );

          if (!r.ok) {
            const e = await r.text();
            errors.push(`${tc.type}: ADO ${r.status}: ${e.slice(0, 100)}`);
            continue;
          }

          const d = await r.json();
          const tcId = d.id;
          const tcUrl = d._links?.html?.href || `${base}/${adoProj}/_workitems/edit/${tcId}`;

          // Step 2 — Link Test Case to Bug via TestedBy
          const bugWorkItemId = String(rawBugId || bugId).replace('#', '');
          await fetch(
            `${base}/${proj}/_apis/wit/workitems/${tcId}?api-version=6.0`,
            {
              method: 'PATCH',
              headers: { Authorization: auth, 'Content-Type': 'application/json-patch+json' },
              body: JSON.stringify([{
                op: 'add',
                path: '/relations/-',
                value: {
                  rel: 'Microsoft.VSTS.Common.TestedBy-Reverse',
                  url: `${base}/_apis/wit/workItems/${bugWorkItemId}`,
                  attributes: { comment: 'Test case linked to bug by AI Defect Agent' }
                }
              }])
            }
          ).catch(() => {}); // non-blocking

          created.push({ id: `#${tcId}`, rawId: tcId, url: tcUrl, type: tc.type });
        } catch (e) {
          errors.push(`${tc.type}: ${e.message}`);
        }
      }

      return res.json({ created, errors, platform: 'azure_devops' });
    }

    return res.status(400).json({ error: `Unsupported platform: ${platform}` });

  } catch (err) {
    console.error('TestCase API error:', err);
    return res.status(500).json({ error: err.message });
  }
}
