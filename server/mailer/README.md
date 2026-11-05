# Invitation email delivery

`mail.invite` uses the existing Boss worker. Creation, reissue, and resend insert a job in
the active-Room transaction; queue failure rolls back the invitation write and fails
the request. Jobs contain an
invitation ID and SHA-256 token fingerprint, not recipient addresses or tokens.
`InviteEmailProcessor` loads the current record and skips invitations that were
used, expired, reissued, removed, or belong to a deleted Room. SMTP errors propagate
to Boss rather than being recorded as successful delivery. Queue defaults apply.

For a failed delivery, inspect the `mail.invite` job state and error in Boss after
checking worker availability and SMTP configuration. Use the existing authorized
Resend invitation action to queue a new attempt while the invitation remains
active. Reissuing changes the token; older queued attempts then drain without
sending. A successful enqueue confirms durable scheduling, not SMTP delivery.

SMTP does not provide exactly-once delivery here. A worker crash after SMTP
accepts a message but before Boss records completion can lead to a duplicate if
that attempt is retried. Repeated explicit resends also produce separate emails.
Do not claim inbox receipt from SMTP acceptance.

All invitation-email producers use this queue. The Room lock serializes creation,
reissue, membership changes and acceptance. Concurrent create requests retain one
invitation record; each explicit request may enqueue a delivery. Creation analytics
run only after commit. OTP email delivery is a separate path and is not covered here.

Automatic retry policy, alerting, and an operator replay interface remain to be
completed. No historical invitation is queued merely by deploying the worker.
