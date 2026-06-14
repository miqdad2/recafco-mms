# User Account Lifecycle

## States

Every user account passes through up to three lifecycle states. The state is derived
from two columns on the `profiles` (and mirrored on `auth_users`) table:

| State        | `is_active` | `deleted_at`   | Can log in |
|--------------|-------------|----------------|-----------|
| Active       | `true`      | `NULL`         | Yes        |
| Deactivated  | `false`     | `NULL`         | No         |
| Archived     | `false`     | `NOT NULL`     | No         |

### Active

Normal operating state. The user can log in, receive notifications, and act
according to their role permissions.

### Deactivated

The account is suspended. All sessions are revoked on deactivation. The user
cannot log in until re-activated by an Admin.

Deactivation is the required first step before archiving.

### Archived

The account is hidden from normal administrative views. The user cannot log in.
All linked business history (work orders, approvals, assignments, audit logs,
parts requests, purchase requests) is fully preserved — archiving performs no
cascade deletes.

Archived accounts appear only when viewing `/admin/users?view=archived`.

---

## Transitions

```
Active ──── deactivate ──→ Deactivated ──── archive ──→ Archived
                              ↑                              │
                         activate                         restore
                              │                              │
                              └──────────────────────────────┘
                                  (restored accounts start Deactivated)
```

| Transition    | Trigger                    | Who can act          | Sessions revoked |
|---------------|----------------------------|----------------------|-----------------|
| Activate      | `toggleUserActiveAction`   | Admin (users.manage) | No              |
| Deactivate    | `toggleUserActiveAction`   | Admin (users.manage) | Yes             |
| Archive       | `archiveUserAction`        | Super Admin only     | Yes             |
| Restore       | `restoreUserAction`        | Super Admin only     | No              |

---

## Restrictions

- **Cannot archive self.** Super Admin cannot archive their own account.
- **Cannot archive another Super Admin.** The Super Admin role is protected.
- **Must deactivate before archiving.** Attempting to archive an active account returns `must-deactivate-first`.
- **No permanent delete through UI.** Users with any linked business records cannot be permanently deleted from the UI. The `getUserDeletionImpact()` helper quantifies linked records.
- **Restored accounts start inactive.** After restoration the account is `is_active = false`. An Admin must explicitly activate it.

---

## Login protection

The sign-in query enforces:

```sql
where lower(au.email) = $email
  and au.deleted_at is null
  and p.deleted_at is null
```

Archived users are therefore blocked at query level in addition to the
`is_active = false` check.

---

## Impact detection

`lib/user-lifecycle/impact.ts` exports `getUserDeletionImpact(profileId)` which
returns a `DeletionImpact` object with counts of all linked records:

```typescript
type DeletionImpact = {
  workOrdersCreated:      number;
  approvalsDecided:       number;
  workOrderAssignments:   number;
  auditLogsActed:         number;
  partsRequestsLinked:    number;
  purchaseRequestsLinked: number;
  totalSessions:          number;
  canPermanentDelete:     boolean;  // true only when all counts are 0
};
```

The UI displays this summary next to the Archive button so the Super Admin
understands what history belongs to the user before proceeding.

---

## Audit trail

Every lifecycle transition is recorded in `audit_logs`:

| Action             | Logged when                            |
|--------------------|----------------------------------------|
| `user.activated`   | Account activated                      |
| `user.deactivated` | Account deactivated; sessions revoked  |
| `user.archived`    | Account archived; sessions revoked     |
| `user.restored`    | Archived account restored              |
