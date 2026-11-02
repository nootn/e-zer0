# Calendar access, token recovery and diagnostics

## Separate permission layers

Email and calendar grants are independent. Use `list_connected_accounts` for email
and `list_calendar_accounts` for calendar access; use their current numeric account
IDs rather than remembered personal/work labels. An agent's calendar grant covers
all calendars readable through that provider account, subject to provider sharing
and OAuth scopes. There is no separate e-zer0 grant for each secondary calendar.

A client-side approval block can prevent a call from reaching e-zer0. Describe it
as client-blocked, not as an e-zer0 denial unless the server returned one. An
unattempted or budget-deferred account is not checked, not denied. Do not override
a genuine prior user restriction solely because a server grant exists.

## Bounded recovery using existing consent

Calendar reads check the active client and calendar grant before fetching provider
credentials. A token expiring within 60 seconds is refreshed before the read.
Otherwise a provider 401 permits one refresh and one retry. Each call attempts at
most one refresh, including any proactive refresh. A persistent 401 is returned
to the caller; it does not start an unbounded loop. A 403 does not trigger token
refresh, and token refresh never asks for additional OAuth scopes.

Concurrent refreshes are coalesced within one Worker isolate, not across isolates.
Refresh success and failure writes compare the stored status, access token and
refresh token against their original snapshot so an older response cannot undo
a reconnect, reactivate a revoked account or replace newer credentials. Grants
and account state are rechecked before the post-refresh read. A failed stale
refresh can use newer valid credentials instead of asking for another reconnect.
The existing background refresh remains in place; email tools retain their existing
behaviour. Calendar errors do not mark the shared mailbox account as errored.

Toggling an agent's calendar checkbox changes e-zer0 authorization only. It does
not renew Google/Microsoft consent. Reconnect a provider account only when needed,
with the user's approval, using Add Gmail/Add Outlook without disconnecting first
to retain account IDs and agent mappings. Primary-success/secondary-failure is not
proof of different calendar scopes: an access token can expire between calls.

## Responses and audit records

Successful `list_calendars` and `get_calendar_events` results retain their existing
fields and add `access` with account ID, token expiry, whether scopes were recorded,
and whether refresh/recovery was used. These metadata are also audited, not event
content. `refreshed` means the call attempted or joined refresh and reloaded state;
another concurrent refresh may have already updated the account.

Failed calendar tools retain `isError: true` and a readable text error, adding
`structuredContent.error` with a code, requested account ID and optional provider, HTTP status, safe
provider reason and retry delay. Unknown provider messages, tokens and raw error
bodies are never echoed. A 401 alone is not evidence of missing consent.

| Code                                                            | Meaning / caller action                                                                                                  |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `calendar_grant_missing`                                        | This active client lacks the requested calendar grant. Do not infer email restrictions.                                  |
| `calendar_account_inactive`                                     | The granted provider account is inactive or unavailable; grants were not removed.                                        |
| `calendar_credentials_missing` / `calendar_credentials_invalid` | Stored credentials or encryption configuration need administrator review.                                                |
| `provider_token_invalid`                                        | Invalid/expired provider token; recovery was exhausted or unavailable. Do not blindly retry.                             |
| `provider_reauthentication_required`                            | Refresh returned `invalid_grant`; ask approval to reconnect this provider account.                                       |
| `provider_refresh_failed`                                       | Refresh failed for another reason; check connectivity/configuration, not the permission checkboxes.                      |
| `provider_scope_missing`                                        | Provider explicitly reported insufficient scopes; explain the account and consent needed before requesting reconnection. |
| `provider_calendar_forbidden` / `provider_calendar_unavailable` | Provider denied access or the calendar is missing/not readable. Check sharing/policy/ID, not every account's grants.     |
| `provider_rate_limited`                                         | Defer and honour `retry_after_seconds` when supplied; do not reconnect.                                                  |
| `provider_calendar_failed`                                      | Other provider HTTP failure; inspect status and request correlation.                                                     |
| `calendar_request_aborted` / `calendar_request_timeout`         | Abort/timeout, not proof of human cancellation.                                                                          |
| `calendar_operation_failed`                                     | Other failure; diagnose before repeating requests.                                                                       |

Provider scopes are stored in `email_accounts.granted_scopes` only when actually
returned by OAuth. Existing rows start at NULL (unknown), not missing permission.
Refresh retains previous scope metadata if omitted; new/repeated consent stores
NULL if its response omits scopes. Requested scopes are not proof of granted scopes.
This metadata does not automatically grant, remove or enforce agent permissions.

Agent email/calendar edits and OAuth mailbox consent produce before/after account-ID
snapshots in the same D1 batch as the change, including the admin ID when available.
Agent revocation similarly records activation before/after without deleting grants.
Legacy email-only edits and OAuth consent do not clear calendar grants. Failed
batches roll back both the edit and its success audit. This is prospective history:
old grant timestamps alone cannot reconstruct past edits, and the audit cannot
recover provider details or client-side rejections that were never recorded.

## Deployment and checks

Apply `migrations/0012_provider_granted_scopes.sql` before deploying this code.
It adds one nullable metadata column; it does not change existing credentials,
account IDs, client activation, or email/calendar grants. Compare those grants
before and after deployment. No reconnect is required just to apply the migration.

Refresh the MCP catalog after upgrading to catalog version `1.1.2`. Use synthetic
fixtures for expiry, secondary-calendar 401 recovery, insufficient-scope 403,
revocation during refresh, rotation and atomic audit failures. Do not change live
permissions or create calendar/mail content merely to test recovery.
