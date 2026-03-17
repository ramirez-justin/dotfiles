# Google Calendar Tmux Status Bar

## Summary

A bash script that shows the next Google Calendar meeting in the tmux status bar with a countdown timer, using the Google Calendar API via OAuth from a personal Google account.

## Files

| File | Purpose |
|------|---------|
| `~/.config/tmux/scripts/cal.sh` | Main script, called by tmux status bar |
| `~/.config/tmux/scripts/cal-setup.sh` | One-time OAuth setup |
| `~/.config/tmux/scripts/.credentials.json` | Stored tokens (gitignored, chmod 600) |
| `~/.config/tmux/scripts/.client-secret.json` | OAuth client ID/secret (gitignored, chmod 600) |

## Dependencies

- `curl` — HTTP requests to Google APIs
- `jq` — JSON parsing

## OAuth Flow (one-time setup)

1. User creates a Google Cloud project on personal account
2. Creates OAuth 2.0 credentials (Desktop app type)
3. Enables Google Calendar API
4. Downloads client secret JSON to `.client-secret.json`
5. Runs `cal-setup.sh` which:
   - Reads client ID/secret from `.client-secret.json`
   - Opens browser to Google consent screen (scope: `calendar.events.readonly`)
   - Captures redirect on `localhost:8080`
   - Exchanges auth code for access + refresh tokens
   - Saves to `.credentials.json` with `chmod 600`

## Main Script (`cal.sh`)

### Token Management

- On each run, check if access token is expired (they last ~1 hour)
- If expired, use refresh token to get a new one via `curl`
- Update `.credentials.json` with new access token and expiry

### Calendar Query

- Query Google Calendar API `events.list` endpoint
- Parameters: `timeMin=now`, `timeMax=end of today`, `maxResults=1`, `orderBy=startTime`, `singleEvents=true`
- Queries across all visible calendars (includes shared work calendar)
- Excludes all-day events (`timeMin`/`timeMax` filtering + check for `dateTime` vs `date`)

### Status Bar Display

- **Meeting within 10 minutes:** `󰤙 14:30 Standup (3 min)`
- **No meeting soon / no meetings left:** `󱁕`

### Popup

- ~10 seconds before meeting start, trigger `tmux display-popup` with meeting details (title, time, attendees)

## Tmux Integration

Add to `status-right` after TPM loads in `tmux.conf`:

```bash
set -g status-right '#(~/.config/tmux/scripts/cal.sh)'
```

## Security

- `.credentials.json` and `.client-secret.json` are gitignored
- Both files set to `chmod 600` (owner read/write only)
- OAuth scope is read-only (`calendar.events.readonly`)
- Tokens can be revoked anytime from Google account settings
