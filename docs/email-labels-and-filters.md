# Safe email labels and filters

## Tools and provider support

Existing tools and Outlook move/read/rule behaviour remain available. `organize_email`
still removes INBOX when moving Gmail mail to a custom label; it is NOT label-only.

| Tool                                             | Gmail                                                            | Outlook                                                               |
| ------------------------------------------------ | ---------------------------------------------------------------- | --------------------------------------------------------------------- |
| `list_email_labels`, `create_email_label`        | Stable IDs; existing names reused case-insensitively             | Unsupported: use folder tools                                         |
| `change_email_labels`                            | Independent custom-label add/remove; archive/read changes opt-in | Unsupported                                                           |
| `get_email`                                      | Recursive decoded MIME body, completeness and calendar flags     | Graph message body                                                    |
| `search_email_page`                              | Native query, paginated IDs                                      | Paginated inbox IDs; query rejected                                   |
| `preview_email_rule`, `apply_email_rule_preview` | Existing mail, explicitly reviewed IDs                           | Unsupported; legacy rules unchanged                                   |
| `create_email_rule`, `update_email_rule`         | Native `query`/`negatedQuery`, independent labels                | Original conditions/actions; Gmail-only fields rejected before writes |

Custom-label changes preserve INBOX and UNREAD. `archive: true` and `markAsRead: true`
are opt-in; use `manage_email` to mark unread. `query` is ANDed with positive
conditions; `negatedQuery` excludes matches. Gmail syntax is not an exhaustive
mention detector or MIME validator. Extended Gmail fields reject legacy
`applyToExisting`: use preview/application instead. Original rule fields remain.

`get_email` never marks mail read. Content is sanitised/untrusted. Gmail reads
nested plain/HTML bodies and up to four text-body attachments, not PDF/Office/OCR
content. Traversal is bounded at 200 MIME parts; incomplete bodies are flagged and
skipped by previews. HTML can remain HTML text. Snippets, sanitised/incomplete
bodies or failed reads cannot prove the absence of mentions. Outlook retains the
Graph body format; MIME-based preview protection is Gmail-only.

## Preview, reconciliation and deployment

1. List/create labels first. Preview resolves existing labels only; no labels,
   filters or messages are created/modified. Pages contain at most five messages
   to keep full-body attachment reads within Workers Free limits.
2. Inspect changes and full bodies with `get_email`. Calendar MIME, `.ics`/`.ical`
   attachments and incomplete bodies are untouched. The configured-name/known-mention
   guard keeps INBOX but is not exhaustive: unknown formats require human review.
3. Apply only explicitly approved IDs using that page's encrypted 15-minute token.
   The token binds client, account, content hashes, label/read-state snapshots and
   exact changes. Apply re-reads state; stale plans fail and already-applied state
   is returned without another write. Tokens cannot add actions or broaden IDs.
4. Lost responses are reconciled by reading state, never blindly repeating writes.
   Partial failures return `isError: true` WITH individual results. Earlier writes
   are not rolled back. Gmail has no multi-message or compare-and-swap transaction:
   concurrent changes between read/write remain possible.
5. Follow `next_page_token` with the same account/query/criteria/actions and review
   each page separately. Preview tokens and pagination tokens are different.

Labels are reused by name; uncertain creation responses are reconciled. Filter
definitions are compared before/after POST. D1 write-intent claims prevent
concurrent/uncertain duplicate filter POSTs. An unresolved intent blocks automatic
recreation even if a current read shows no filter: a lost/slow write may still
finish. An administrator must verify absence and resolve that intent; never clear
it solely because the client timed out. Successful filter deletion clears matching
intents. Gmail updates create/reconcile the replacement BEFORE removing the old
filter. An interrupted update may temporarily leave both; list/reconcile first.

**Before deployment:** apply `migrations/0011_filter_write_intents.sql` and all
preceding migrations. These changes have not been applied to live mail during
development. Refresh client tools/permissions and start a fresh chat afterwards.

## Exact calls: account 1

Examples below are NOT actions performed by development. Replace tokens/IDs with
actual preview results and explicit approval. Account ID 1, example.com senders,
ExampleCo labels and Alex Morgan are synthetic: replace them with your own
account, senders, labels and protected names. Do not guess provider IDs.

```javascript
list_email_labels({ account_id: 1 });
create_email_label({ account_id: 1, name: 'business/ExampleCo' });
create_email_label({ account_id: 1, name: 'newsletters' });
```

### ExampleCo Jira

Future mail is labelled only, not automatically archived using an incomplete
mention detector. Known calendar search forms are excluded, but native filters
cannot exclude every calendar representation. For strict calendar-untouched
behaviour, use ONLY the MIME-checked preview/apply workflow, not a native filter.

```javascript
create_email_rule({
    account_id: 1,
    name: 'ExampleCo Jira label only',
    conditions: {
        from: ['jira@example.com'],
        negatedQuery: 'filename:ics OR filename:ical OR subject:invitation OR "BEGIN:VCALENDAR"',
    },
    actions: { addLabels: ['business/ExampleCo'] },
    applyToExisting: false,
});
preview_email_rule({
    account_id: 1,
    conditions: { from: ['jira@example.com'], query: 'in:inbox' },
    actions: { addLabels: ['business/ExampleCo'], archive: true },
    protect_terms: ['Alex', 'mentioned you', '@Alex Morgan'],
    count: 5,
});
get_email({ account_id: 1, message_id: '<ID_FROM_JIRA_PREVIEW>' });
apply_email_rule_preview({
    account_id: 1,
    preview_token: '<JIRA_PREVIEW_TOKEN>',
    reviewed_message_ids: ['<APPROVED_ROUTINE_ID>'],
});
```

Mention IDs may be approved for their label-only proposal; the token cannot add
archiving to those IDs. UNREAD is preserved. Do not approve uncertain mentions.

### The Example Newsletter

Match BOTH exact sender and subject phrase; do not generalise to security
or other mail. The optional future filter has the same native-calendar limitation.

```javascript
create_email_rule({
    account_id: 1,
    name: 'The Example Newsletter label only',
    conditions: {
        from: ['newsletter@example.com'],
        subject: ['The Example Newsletter'],
        negatedQuery: 'filename:ics OR filename:ical OR subject:invitation OR "BEGIN:VCALENDAR"',
    },
    actions: { addLabels: ['newsletters'] },
    applyToExisting: false,
});
preview_email_rule({
    account_id: 1,
    conditions: { from: ['newsletter@example.com'], subject: ['The Example Newsletter'] },
    actions: { addLabels: ['newsletters'] },
    count: 5,
});
apply_email_rule_preview({
    account_id: 1,
    preview_token: '<MONTHLY_BUILD_PREVIEW_TOKEN>',
    reviewed_message_ids: ['<APPROVED_NEWSLETTER_ID>'],
});
```

Repeat the SAME preview with `page_token: "<NEXT_PAGE_TOKEN>"` for additional
pages. The newsletter operation preserves both INBOX and UNREAD.

## Cancellation, slow calls and stale catalogs

### Outlook Inbox, Other and continuation

`get_emails` treats `other` and `focused` as classifications inside Inbox, not
folder names. Ordinary reads use `$filter` with `receivedDateTime` first and
`$orderby=receivedDateTime desc`, as required by Graph. Sender/subject searches
use `$search` without `$filter` or `$orderby`; classification and read status are
checked locally on the returned page. Returned Outlook messages include
`inferenceClassification` and `isRead`. These operations use GET only.

Both Outlook and Gmail return `exhausted` and optional `next_page_token`.
The MCP `tools/list` input schema advertises optional string `page_token` for
`get_emails`. If a client receives continuation tokens but its advertised schema
omits this parameter, refresh the connection's tools and start a new chat: that
client is using an older catalog. Reconnecting mailboxes or changing grants is
not required to refresh a tool schema.
Follow that token with the SAME account, filters and count, even after a short
or empty page. Each call reads one provider page (at most 50); filtered search
pages may contain fewer matches. Continuation tokens are encrypted, bound to the
client/account/query and expire after 30 minutes. Do not manufacture an older
date cursor from the last message: equal timestamps can cause gaps or duplicates.
Provider paging is not a mailbox snapshot; concurrent mail changes can still
affect subsequent pages. Outlook `$search` has a provider ceiling of 1,000 results;
`exhausted` describes the accessible query, not proof the mailbox contains no
older matches. Use narrower date windows for larger text searches.

```javascript
get_emails({ account_id: 1, folder: 'other', is_read: false, count: 50 });
get_emails({ account_id: 1, folder: 'other', is_read: false, count: 50, page_token: '<NEXT_PAGE_TOKEN>' });
```

See [Graph message ordering and pagination](https://learn.microsoft.com/en-us/graph/api/user-list-messages)
and [message search limits](https://learn.microsoft.com/en-us/graph/search-query-parameter).

No new short timeout or automatic mutation retry is introduced. A simulated
68-second read is tested locally; client/network limits are separate. A caller
promising a 120-second allowance does not necessarily change connector timeouts.

Correlate UTC timings with transport entry, response-start/completion/failure,
`X-Ezer0-Request-Id`, CF Ray and `X-Ezer0-Catalog-Version` (`1.1.1`). Response-start
or HTTP 200 alone does not prove tool success. Provider header timing/status logs
exclude URLs/tokens/content; new tools also emit tool lifecycle logs and audits.

`incoming_request_aborted`, `mcp_response_stream_cancelled` and incoming
`notifications/cancelled` identify request, stream or MCP peer signals, NOT who
caused them. Provider AbortError origin remains unknown unless correlated.
Cancellation reasons are not logged because they may contain user data.
The stateless transport does not use a notification on a new request to cancel
an older mutation. Client abandonment does not prove an in-flight write stopped;
reconcile its outcome before repeating it.

Earlier 9–11-second cancellations have not been reproduced with correlated server
failures; subsequent reads succeeded. Their actual source remains unresolved.
Missing audit records do not prove requests never arrived. Capture a failed call
live after deploying diagnostics; do not silently retry a deletion.

The catalog is static within a running version; tests verify repeat discovery.
e-zer0 does not emit "catalog changed after preparation". Deployment can change
schemas while a client retains prepared tools. Original failures have not been
captured at the protocol boundary, so their precise origin remains unresolved.
Compare catalog version, tools/list, incoming tool name, validation response and
tool-start/audit records. Refresh tools/start a new chat after deployment.

Provider references: [Gmail filter criteria/actions](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.settings.filters),
[Microsoft message reads](https://learn.microsoft.com/en-us/graph/api/message-get?view=graph-rest-1.0).
