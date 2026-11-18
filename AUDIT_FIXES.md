# StudyMate audit fixes

## Scope

The prior audit report was not present in this project workspace, so this change addresses the confirmed role-boundary defect found during source review. It does not claim that every StudyMate feature has now been audited or fixed.

## High severity: Manager access to Admin API in SQLite mode

The SQLite demo seed stores the configured Manager account with the legacy `admin` database role, while `publicUser` exposes it to the UI as `manager`. Before this fix, the server's `requireAdmin` middleware checked only the stored role, so that Manager identity could pass Admin-only API authorization.

The Admin guard now also excludes the configured Manager email. Manager API access remains available through `requireManager`; genuine Admin accounts keep their Admin access.

### Files changed

- `server/sqlite.js` — tightened `requireAdmin` for the seeded legacy Manager identity.
- `package.json` — added `npm test` using Node's built-in test runner.
- `tests/sqlite-role-boundaries.test.js` — added an integration regression test that starts SQLite with a disposable database under the OS temp directory, then verifies Manager/Admin route boundaries.

### Verification

- `npm test` — passed (1 test, 0 failures).
- `node --check server/sqlite.js` — passed.
- `node --check tests/sqlite-role-boundaries.test.js` — passed.
- `git diff --check` — passed.
- No Supabase or other production database was contacted or changed. The integration test removes only its unique temporary test directory.

## Remaining audit scope

The regression test covers the SQLite authorization defect only. Hosted Supabase role enforcement and the remaining feature, API, Android, compatibility, and dependency checks still require their own non-production test coverage before they can be marked verified.
