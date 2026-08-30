# Beneficiary Auth Deployment Runbook

Moving beneficiary PIN checks from the browser to a Supabase Edge Function.

Right now any visitor with the public anon key can read every beneficiary's
`encrypted_key` and guess PINs offline as fast as their laptop allows. After
this change the ciphertext is only released after a server-side PIN check with
attempt limits, and repeated wrong guesses lock the account.

**Nothing here is automated.** Every step is a thing you do by hand, and the
order matters — several steps break login if run early.

---

## Before you start

You need:

- Supabase dashboard access for the target project (staging first).
- Supabase CLI installed and logged in (`supabase login`).
- The ability to deploy the frontend.
- 45 minutes of quiet time. Do not do this during a demo or while beneficiaries
  are actively using the system.

Do the whole sequence on **staging** first, end to end, including the tests.
Only then repeat it on production.

### Write these down before you touch anything

Record the exact value of `SUPABASE_URL` for the project, and check how many
existing beneficiary accounts you have:

```sql
select count(*) from public.beneficiaries;
```

If that number is 0 you have no legacy accounts, and step 8 does not apply to
you. Every other step still does, including step 2 — see the note there.

If it is greater than 0, read the **Legacy accounts** section at the bottom
before you begin, so you know what those users will experience on their first
login.

---

## Step 1 — Apply migration 0002 (audit table)

**File:** `supabase/migrations/0002_beneficiary_pin_backfill_audit.sql`

Open the Supabase SQL editor, paste the file, run it.

This creates `beneficiary_pin_backfills`, a log of legacy accounts migrating to
server-side PIN checks. It changes nothing about existing behaviour, so it is
safe to run at any time.

**This must come first.** The Edge Function refuses to migrate a legacy account
if it cannot write to this table. Deploy the function without this table and
every pre-existing user sees a server error when they log in.

Confirm it worked:

```sql
select count(*) from public.beneficiary_pin_backfills;
```

Expect `0`. An error here means the migration did not run.

---

## Step 2 — Set the function secrets

**Do this even if you have no existing accounts.** With nothing to migrate the
value has no effect on behaviour, but leaving it unset makes the function log a
configuration error on every cold start, and step 5 tells you to treat that as a
blocker. Setting it costs nothing and keeps the logs clean.

The migration timestamp decides which accounts are treated as legacy. Use the
current UTC time — you are about to apply 0001 in the next step.

Get the timestamp:

```bash
date -u +"%Y-%m-%dT%H:%M:%SZ"
```

Set it, replacing the value with what you just got:

```bash
supabase secrets set BENEFICIARY_BACKFILL_DEPLOYED_AT=2026-08-30T09:00:00Z
```

Accounts created **before** this instant get one grace login to establish their
PIN. Accounts created after it are expected to have a PIN already, and will not
get the grace login. Setting this too far in the past strands real users;
setting it in the future gives the grace login to accounts that do not need it.

The grace period lasts 14 days by default. To choose a different length, also
set:

```bash
supabase secrets set BENEFICIARY_BACKFILL_CUTOFF_AT=2026-09-20T09:00:00Z
```

If you skip this step entirely, legacy users cannot log in at all. That is
intentional — a missing setting fails safe rather than leaving the grace login
open forever — but it means an outage for those users until you fix it.

---

## Step 3 — Apply migration 0001 (lock down the table)

**File:** `supabase/migrations/0001_beneficiaries_pin_lockout.sql`

Paste into the SQL editor and run.

This adds the PIN hash and lockout columns, then removes the browser's ability
to read `encrypted_key` or write to the table at all.

**Beneficiary login is broken from this moment until step 6 finishes.** That
is expected. The old client cannot read what it needs, and the new client is not
deployed yet. Vendor and funder login are untouched and keep working.

Confirm the lockdown took effect:

```sql
select grantee, column_name, privilege_type
from information_schema.column_privileges
where table_schema = 'public'
  and table_name = 'beneficiaries'
  and grantee = 'anon';
```

Expect exactly three rows: `nrc`, `public_key`, `created_at`, all `SELECT`. If
you see `encrypted_key` in that list, the lockdown did not work — stop and
investigate rather than continuing.

### If something goes wrong here

Run `supabase/migrations/0001_beneficiaries_pin_lockout_rollback.sql`. That
restores the old permissions and login works again with the currently deployed
client. It deliberately keeps the new columns, so no PIN data is lost and you
can roll forward again later.

---

## Step 4 — Apply migration 0003 (backfill staging)

**File:** `supabase/migrations/0003_beneficiary_backfill_tokens.sql`

Paste into the SQL editor and run.

This adds three columns used to hold a legacy account's candidate PIN hash
temporarily, before it is confirmed. It is what stops a mistyped PIN from
becoming permanent. Additive only.

If you have no legacy accounts you still need this — the function references
these columns and will error without them.

---

## Step 5 — Deploy the Edge Function

```bash
supabase functions deploy beneficiary-auth
```

Check the logs in the dashboard under Edge Functions → beneficiary-auth. On
first invocation you should see a line starting `[BACKFILL_WINDOW]` showing the
two dates from step 2.

If instead you see `[BACKFILL_WINDOW] unconfigured or invalid`, step 2 did not
take. Fix the secret and redeploy before continuing.

Smoke test it with a nonexistent NRC, using your project URL and anon key:

```bash
curl -s -X POST "https://YOUR-PROJECT.supabase.co/functions/v1/beneficiary-auth" \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action":"verify-pin","nrc":"000000/00/0","pin":"1234"}'
```

Expect `{"ok":false,"error":"not_found"}`. Anything else — especially a
`server_error` — means stop and read the function logs.

---

## Step 6 — Deploy the client

Deploy the frontend as you normally would. No new environment variables are
needed; the browser calls the function through the Supabase URL and anon key it
already has.

Beneficiary login works again once this is live. If you are running the two
environments side by side, note that an **old** client against a **new**
database cannot log beneficiaries in, so do not leave a stale deployment
serving traffic.

---

## Step 7 — Test it

Work through all of these on staging. Each one has a specific expected result;
treat a surprise as a reason to stop.

1. **New registration.** Create an account with a fresh NRC in `123456/11/1`
   format. Should succeed and land on the dashboard.
2. **Wrong NRC format.** Try registering `12345`. Should be rejected
   immediately, before any wallet funding happens.
3. **Duplicate NRC.** Register the same NRC twice. Second attempt should say the
   account already exists.
4. **Correct login.** Log out, log back in with the right PIN. Should succeed.
5. **Wrong PIN.** Enter a wrong PIN four times. Each should say "Invalid PIN"
   with a decreasing count of remaining attempts.
6. **Lockout.** Enter a wrong PIN a fifth time. You should get an orange
   "Account temporarily locked" panel, distinct from the red wrong-PIN error,
   with a wait time. The form should be disabled until it expires.
7. **Lockout expiry.** Wait out the first lockout (1 minute) and log in with the
   correct PIN. Should succeed and reset the counter.
8. **Signing counts once.** Log in, refresh the page, submit a milestone proof,
   and enter a *wrong* PIN in the signing dialog. Then check:

   ```sql
   select nrc, failed_pin_attempts from public.beneficiaries where nrc = 'YOUR/TEST/NRC';
   ```

   Expect `1`, not `2`. A `2` means the double-verify fix did not deploy.
9. **Delete account.** Delete a test account. It should ask for the PIN, reject
   a wrong one, and only delete on the correct one.
10. **Ciphertext is unreachable.** This is the whole point of the exercise, so
    verify it directly against the REST API with the public anon key:

    ```bash
    curl -s "https://YOUR-PROJECT.supabase.co/rest/v1/beneficiaries?select=encrypted_key&limit=1" \
      -H "apikey: YOUR_ANON_KEY"
    ```

    Expect a `42501` permission-denied error. If it returns ciphertext, the
    original vulnerability is still open — stop and recheck step 3.

    For contrast, this should still succeed, because the app needs it:

    ```bash
    curl -s "https://YOUR-PROJECT.supabase.co/rest/v1/beneficiaries?select=nrc,public_key&limit=1" \
      -H "apikey: YOUR_ANON_KEY"
    ```

If you have legacy accounts, also run these two. They are the whole point of
migration 0003 and are easy to get wrong.

11. **Legacy login with the wrong PIN is harmless.** Pick a pre-existing
    account and log in with a deliberately wrong PIN. It should say "Invalid
    PIN" in red — retryable, not a lockout, and not the blue administrator
    message. Then confirm nothing was committed:

    ```sql
    select nrc, pin_hash is null as still_unmigrated, failed_pin_attempts
    from public.beneficiaries where nrc = 'YOUR/LEGACY/NRC';
    ```

    Expect `still_unmigrated = true` and `failed_pin_attempts = 0`. If
    `still_unmigrated` is false, the wrong PIN was committed and this account is
    now broken — stop, because 0003 is not working.

12. **Legacy login with the right PIN migrates it.** Log into the same account
    with its correct PIN. Should succeed. Then:

    ```sql
    select nrc, pin_hash is not null as migrated, pending_token_hash
    from public.beneficiaries where nrc = 'YOUR/LEGACY/NRC';
    ```

    Expect `migrated = true` and `pending_token_hash` null. There should also be
    exactly one row in `beneficiary_pin_backfills` for this NRC with outcome
    `backfilled`.

---

## Step 8 — Watch the legacy migration

Only relevant if you had existing accounts. For the next 14 days, check this
every few days:

```sql
-- How many legacy accounts have migrated themselves
select count(*) from public.beneficiary_pin_backfills where outcome = 'backfilled';

-- How many are still waiting
select count(*) from public.beneficiaries where pin_hash is null;
```

The second number should trend toward zero. Around day 10, if it is still
significant, those users are about to be locked out — either extend the window
via `BENEFICIARY_BACKFILL_CUTOFF_AT` and redeploy, or contact them directly.

Also watch for abuse. Real users migrate one account each:

```sql
select client_ip, count(distinct nrc) as accounts
from public.beneficiary_pin_backfills
where outcome = 'backfilled'
group by client_ip
having count(distinct nrc) > 1
order by accounts desc;
```

One IP migrating many accounts is someone spraying NRCs, not a beneficiary
logging in. The remaining audit queries are in the comments at the bottom of
`0002_beneficiary_pin_backfill_audit.sql`.

After the cutoff passes, anyone left unmigrated sees a blue "This account needs
assistance" message and must be handled manually. The assisted-reset queue query
is in the same file.

---

## Legacy accounts: read this before step 2

Accounts created before this change have no stored PIN hash. There is no way to
recover their real PIN — it was never saved anywhere. So the first time such a
user logs in during the grace window, the PIN they type becomes their PIN from
then on.

### How the first login works

It takes two steps behind the scenes, and the split is what makes a typo safe:

1. The user submits their NRC and PIN. The server has no hash to check against,
   so it puts the PIN aside as a *candidate*, hands the browser the encrypted
   wallet, and issues a short-lived one-time token. **Nothing is committed yet.**
2. The browser tries to decrypt the wallet with that PIN. If it works, it sends
   the token back and the server commits the candidate as the real PIN hash. If
   it does not work, the browser sends nothing.

So a mistyped PIN fails at the decrypt step, no token comes back, the account
stays exactly as it was, and the user retries. They see an ordinary red "Invalid
PIN" message. No lockout is applied, because the server never had a hash to
count a failed attempt against.

The token lasts three minutes and works once. This matters only in that the user
should not leave the login page half-finished for a long time; if they do, they
just log in again and a fresh candidate is staged.

### What this does not protect against

During the grace window, someone who knows a legacy NRC can still deliberately
claim that account's PIN before the real user gets to it. They cannot spend
anything — the wallet is encrypted with the original PIN, which they do not know
— but they can lock the real user out and they can walk away with the encrypted
wallet to attack offline.

This is inherent to having no stored hash to verify against, and it is why the
grace window is time-boxed rather than permanent. Shorter windows reduce the
exposure. The per-IP query in step 8 is how you would notice it happening.

### Deleting a legacy account

An unmigrated account cannot be deleted, because there is no PIN to verify
against and a destructive action must not run on an unverified PIN. The user
sees the blue administrator message. They need to log in successfully once — at
which point the account is migrated — before they can delete it.

---

## If you need to undo everything

1. Run `supabase/migrations/0001_beneficiaries_pin_lockout_rollback.sql`.
2. Redeploy the previous frontend build.

Login works again immediately. The columns from 0001 and 0003 and the audit
table stay behind harmlessly, so you keep any PIN hashes already collected and
can roll forward again without redoing steps 1 through 4.

Do not drop the `pin_hash` column as part of a rollback. Anyone who registered
or logged in after step 3 has a real hash there, and deleting it pushes them
back onto the one-time grace login for no reason.

The staging columns from 0003 are safe to drop if you want to (the statement is
at the bottom of that file) — they only ever hold candidate hashes for logins
still in progress.
