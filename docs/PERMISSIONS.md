# Sivarr — Roles & Permissions Model

> Blueprint Stage 3. The role hierarchy used across **Org** and **Academic** spaces,
> and how it's enforced. Keep this in sync as new features add permission checks.

## Role hierarchy (Org)
`owner > admin > manager > member > guest`

Stored in `org_members.role` (Postgres). Derived **server-side** from
`db.get_org_by_member(sid)` → `member_role` — never trusted from client input
(see SIVARR_SECURITY_GUIDE: don't read role from the user-writable progress file).

| Capability | Owner | Admin | Manager | Member | Guest |
|---|:--:|:--:|:--:|:--:|:--:|
| View org space | ✓ | ✓ | ✓ | ✓ | ✓ |
| Create/edit tasks, projects, docs | ✓ | ✓ | ✓ | ✓ | — |
| Invite members | ✓ | ✓ | ✓ | — | — |
| Remove members | ✓ | admins may remove member/guest only | — | — | — |
| Change member roles | ✓ | — | — | — | — |
| Edit org profile | ✓ | — | — | — | — |
| View audit log | ✓ | ✓ | — | — | — |
| Founder tab / financials | ✓ | — | — | — | — |
| Delete org | ✓ | — | — | — | — |

**Invariants enforced server-side:**
- The **owner row is immutable** — `set_org_member_role`/`remove_org_member` carry `AND role <> 'owner'`.
- An **admin cannot** remove another admin/manager/owner, or remove themselves.
- Only the **owner** changes roles or edits the org profile.
- Audit log (`org_audit` collection) records role changes, removals, and profile edits with actor + timestamp.

**Enforcement points (current):**
- `/api/org/update`, `/api/org/member/role`, `/api/org/member/remove`, `/api/org/audit` (app.py)
- `/api/org/invite` (owner/admin/manager)
- Founder tab visibility: `_founderTabVisibility()` (owner-only, client) — backed by server gating on founder data.
- UI mirrors these gates in the Settings → Organisation section, but **the server is the source of truth**.

## Academic spaces
A separate, lighter model on the class bridge (`acad_*`):
- **Class owner** (lecturer who created the class): take attendance, post announcements, create assignments, grade, go live, run polls, manage the class.
- **Member** (student who joined via code): check in, submit assignments, view grades/feed, vote in polls.
- Enforced via `_acad_require_owner(code, sid)` and `_acad_is_member(code, sid)` (app.py). The class owner may also act as a member (e.g. self check-in).

## Rule for new features
Any new org/academic action MUST derive identity + role from the server
(`get_org_by_member` / `_acad_*`), check the table above (or extend it), and —
for state changes by admins/owners — write an audit entry. Never gate on a
client-supplied role or `sid`.
