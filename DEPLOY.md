# Bug Sync — Vercel Deploy Bundle

4 files to drop into your Vercel repo root, replacing existing ones where applicable.

## Files

| File | Action | Purpose |
|------|--------|---------|
| `index.html` | **Replace** existing file | Redesigned two-pane UI + Teams SDK integration already baked in |
| `vercel.json` | **New file** (or merge if you have one) | CSP headers so Teams can iframe the app + rewrites for /privacy and /terms |
| `privacy.html` | **New file** | Privacy policy — required by Teams manifest |
| `terms.html` | **New file** | Terms of use — required by Teams manifest |

## Deploy in 5 steps

```bash
# 1. Drop all 4 files into your local repo root
# 2. Commit
git add index.html vercel.json privacy.html terms.html
git commit -m "Redesigned UI + Teams app support (CSP, privacy, terms)"
git push

# 3. Wait ~90 seconds for Vercel to build + deploy

# 4. Verify the live site picked up the changes:
curl -I https://bugsyncjira.vercel.app | grep -i content-security
#    Expected: content-security-policy: frame-ancestors 'self' teams.microsoft.com ...

curl -o /dev/null -s -w "%{http_code}\n" https://bugsyncjira.vercel.app/privacy
#    Expected: 200

curl -o /dev/null -s -w "%{http_code}\n" https://bugsyncjira.vercel.app/terms
#    Expected: 200

# 5. Hard-refresh your browser on the live site (Ctrl+Shift+R)
#    to bust the cached old index.html
```

## What to check in the browser after deploy

1. **Visual:** Is the two-pane redesign still there? (Screenshot on left, generated ticket on right)
2. **Theme:** Does your light/dark toggle still work?
3. **Settings drawer:** Click the cog icon top-right — does the drawer slide in?
4. **Project list:** Does the Jira project dropdown still populate?
5. **Console:** Open DevTools (F12) → Console → no red errors
   - You'll see a warning like `[BugSync] Teams SDK init failed, running standalone` — **this is expected** when not running inside Teams. It's just the SDK gracefully backing off.

## If something breaks

- **UI looks different than before** → clear cache, hard-refresh, try Incognito
- **Jira project dropdown empty** → your Vercel env vars (`JIRA_URL`, `JIRA_EMAIL`, `JIRA_TOKEN`) still need to be set in Vercel dashboard; nothing changed there
- **Privacy/terms still 404** → check `vercel.json` is at the repo root (not inside a subfolder); Vercel needs 1-2 minutes to propagate
- **"Content Security Policy blocked..."** console errors → the CSP is too strict for some external script. Tell me which domain is blocked and I'll widen the allowlist.

## After this is done

You're ready for **Priority 3** — upload `bugsync-teams.zip` (from the earlier `bugsync-teams-app/` output) to Teams. The manifest already has your real Vercel URL baked in.
