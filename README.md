# Spotlight Gym — class booking with an automatic waitlist

Members with an **active membership** book classes. When a class is **full** they join a **waitlist**, and when someone cancels the **server** moves the first person in the queue into the freed spot — in order, every time. Trainers mark attendance. Admins build the schedule.

**Stack:** Node.js 20+ · Express 4 · MySQL 8 · React 18 (Vite) · JWT auth (bcrypt) · zod validation · `node:test`


---

## 1. Run it (about 3 minutes)

Prerequisites: **Node 20+** and **Docker** (for MySQL). No Docker? Install MySQL 8 yourself and skip step 2.

```bash
# 1. install everything (root + server + client)
npm run setup

# 2. configure (creates your private .env — never commit it)
cp .env.example .env
#    then edit .env: set DB_PASSWORD, MYSQL_ROOT_PASSWORD and JWT_SECRET
#    generate a secret:  node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

# 3. start MySQL in Docker (waits until healthy)
npm run db:up

# 4. create tables + load demo data
npm run db:reset

# 5. run API (http://localhost:4000) and web app (http://localhost:5173)
npm run dev
```

Open **http://localhost:5173**. On the login page you can tap a demo login to fill the form.

Run the tests: `npm test` (needs the MySQL container from step 3; the unit tests also run alone with `npm --prefix server run test:unit`).

Single-process production mode: `npm run build && npm start` — Express then serves the built React app on `:4000`.

### Demo logins

| Role    | Email                         | Password       |
|---------|-------------------------------|----------------|
| Admin   | `admin@gym.test`              | `Admin123!`    |
| Trainer | `tara@gym.test`, `tom@gym.test` | `Trainer123!` |
| Member  | `alice@gym.test` (quarterly, active) | `Member123!` |
| Member  | `bob@gym.test` (monthly, active)     | `Member123!` |
| Member  | `carol@gym.test` (**expires in 3 days** → reminder demo) | `Member123!` |
| Member  | `dave@gym.test` (**expired** → cannot book)  | `Member123!` |
| Member  | `eve@gym.test` (**no plan** → cannot book)   | `Member123!` |
| Member  | `frank@gym.test`, `grace@gym.test` (active)  | `Member123!` |

### 60-second tour of the seeded scenarios
1. **Waitlist promotion** — class *Sunrise Vinyasa (FULL demo)* is 2/2 with carol (#1) and frank (#2) waiting. Sign in as `alice`, cancel her booking → in a second window as `carol` see the Alerts bell: she was moved in, and frank is now #1.
2. **Last-spot race** — *Private Mobility (1 spot)*. Sign in as two members in two browsers and click Book at the same moment: exactly one is booked, the other is waitlisted. (The automated test fires 12 simultaneous requests.)
3. **2-hour rule** — *Lunch HIIT (booking closed demo)* starts in ~90 minutes: Book and Cancel are disabled, and the API refuses too.
4. **Attendance** — sign in as `tara`, open *Pilates Core (attendance demo)* (started 20 min ago) and mark Present / No-show.
5. **Membership gate** — `dave` and `eve` get a clear "you need an active membership" error.
6. **Reminders / reports** — as admin, *Members → Send expiry reminders now*, then check carol's Alerts; *Reports* shows per-member attendance.

---

## 2. Features

| Requirement | Where |
|---|---|
| Monthly / quarterly plans with start & end dates; only active members can book | `membership_plans`, `memberships`, `lib/policy.js → evaluateEligibility`, `waitlistService.checkEligibility` |
| Admin creates class schedule (trainer, time, capacity) | `classService.createClass/updateClass/cancelClass`, *Admin → Schedule* |
| Book / cancel up to 2 hours before start | `bookingService.bookClass/cancelBooking`, `policy.isWithinChangeWindow` (`BOOKING_CUTOFF_MINUTES`) |
| Full class → waitlist; cancel → first in line promoted automatically | `waitlistService.promoteWaitlist`, called inside the cancel transaction |
| Trainers mark attendance | `attendanceService.markAttendance`, *Trainer → My classes* |
| **Stretch:** membership expiry reminders | `jobs/expiryReminders.js` (daily cron + admin "run now"), in-app Alerts |
| **Stretch:** attendance reports per member | `reportService`, *Admin → Reports* and *My bookings* stats |

Extras: trainer double-booking prevention, capacity edits that auto-promote, class cancellation that notifies everyone, in-app notifications, rate-limited auth, responsive UI (bottom tab bar on phones, sidebar on laptops).

---

## 3. Data model

```
users ──< memberships >── membership_plans
  │
  ├──< classes (trainer_id) ──< bookings >── users (member)
  └──< notifications
```

| Table | Key columns |
|---|---|
| `users` | `role` ∈ member / trainer / admin, unique `email`, bcrypt `password_hash` |
| `membership_plans` | `type` ∈ monthly / quarterly, `price_minor`, `is_active` |
| `memberships` | `user_id`, `plan_id`, `start_date`, `end_date` (both inclusive), `status` ∈ active / cancelled |
| `classes` | `trainer_id`, `starts_at` (UTC), `duration_minutes`, `capacity` (CHECK > 0), `status` |
| `bookings` | `class_id`, `user_id`, `status` ∈ booked / waitlisted / attended / no_show / cancelled, `promoted_at`, `cancel_reason`, generated `active_user_id` |
| `notifications` | `user_id`, `message`, `dedupe_key` (unique), `read_at` |

Full DDL with comments: [`server/db/schema.sql`](server/db/schema.sql).

### Design decisions

**1. Capacity can never be exceeded — a per-class row lock.**
Every operation that can change who holds a spot (`bookClass`, `cancelBooking`, `updateClass`, `cancelClass`, `markAttendance`) runs in a transaction whose **first statement is `SELECT … FROM classes WHERE id = ? FOR UPDATE`**. Concurrent requests for the same class queue up on that row and run one at a time; different classes never block each other. Inside the lock we count occupied spots and insert, so "check then insert" is atomic. This is simpler and more obviously correct than optimistic retries or app-level mutexes (which break with more than one server process).

**2. Waitlist promotion is server-side, ordered, and atomic with the cancellation.**
`cancelBooking` marks the booking cancelled and calls `promoteWaitlist` *in the same transaction, while still holding the class lock*. It loops: while a spot is free, take the oldest waitlisted row (`ORDER BY id`, auto-increment = arrival order, no separate position column that could drift), check the person is still eligible, set it to `booked`, notify them. Because the spot is never visible as "free" outside the transaction, nobody can sneak in ahead of the queue — a new booker also joins the waitlist whenever others are waiting. Ineligible people (membership lapsed since joining) are removed and notified instead of blocking the line.

**3. Database-level backstop against duplicates.**
`bookings.active_user_id` is a stored generated column (`NULL` for cancelled rows) under `UNIQUE (class_id, active_user_id)`. Even if application code had a bug, MySQL itself refuses a second live booking by the same member in the same class (this also makes double-clicks safe).

**4. READ COMMITTED inside transactions.**
`withTransaction` sets READ COMMITTED so every read after taking the lock sees what the previous lock-holder committed (REPEATABLE READ could use an older snapshot). Deadlocks/lock timeouts are retried.

**5. Membership rule.** A member may take a spot if they have an active membership *today* **and** a membership covering the *class date* (so renewals starting before the class count, a plan ending before it does not). Pure function, unit-tested. Dates use `GYM_TIMEZONE` (default `Asia/Kolkata`) to decide "today"; instants are stored in UTC.

**6. Validation & errors.** Every route validates `body`, `params` and `query` with zod on the server (`middleware/validate.js`), returning `{error:{code,message,details:[{field,message}]}}`. The UI shows the message and maps `details` onto form fields. Unknown errors become a generic 500 with no internals leaked.

**7. Auth & security.** Self-registration always creates a *member*; trainers/admins come from the seed. bcrypt (cost 10), JWT (HS256, 8h) verified on every request and the user re-loaded from the DB so role changes apply immediately. Login runs a dummy bcrypt compare for unknown emails (no user-enumeration timing), `helmet`, CORS allow-list, 100 kB body limit, rate-limited auth routes. A member can't cancel someone else's booking (gets 404, not 403, to avoid leaking ids). Secrets only come from `.env` (git-ignored); `.env.example` lists every setting.

**8. Cancel rules.** Confirmed spots can be cancelled until 2h before start (admins can always). Leaving the waitlist is allowed until the class starts — it frees nobody's spot, so the cut-off doesn't matter.

**9. Notifications are in-app (DB rows)** — no email provider needed; the reminder job is idempotent via `dedupe_key`.

### API overview
All under `/api`, JSON, `Authorization: Bearer <jwt>` except `auth/*`. See [`docs/API.md`](docs/API.md).

---

## 4. Tests

`npm test` → 6 unit tests (pure rules) + 16 integration tests against a real MySQL database (`DB_TEST_NAME`, created and reset automatically — your dev data is untouched). The integration suite is skipped with a clear message if MySQL isn't reachable.

Highlights (all in `server/tests/integration/booking.test.js`):
- 12 simultaneous bookings for 1 spot → exactly 1 booked, 11 waitlisted with positions 1..11
- 20 simultaneous bookings for 5 spots → exactly 5 booked
- same member double-clicking 6× → exactly one live booking
- FIFO promotion on cancel, plus two cancels at the same instant promote exactly the first two
- a new booker cannot steal a freed spot from the waitlist
- lapsed-membership waitlister is skipped and removed
- 2-hour cut-off for booking and cancelling, expired/no-plan members blocked
- attendance: only the class's trainer, only after the start, only confirmed spots
- HTTP: validation errors, no password hash leak, duplicate email, role enforcement

---

## 5. Status — what is finished, what isn't

**Finished:** everything in the core list, both stretch goals, seed data, tests, responsive UI.

**Not done / known limits**
- Payment is simulated (buying a plan just creates the membership).
- Reminders are in-app only (no email/SMS); the cron runs inside the API process.
- A member can hold two overlapping classes at once (only trainers are protected from overlaps).
- JWT is kept in `localStorage` (XSS-readable); no refresh tokens or password reset.
- Waitlist counts refresh by polling every 30 s rather than live push.
- No pagination on large lists; no end-to-end browser tests.

**With more time:** httpOnly-cookie sessions + refresh tokens, WebSocket/SSE live updates, email/push notifications (queue + outbox table), overlap checks for members, a waitlist "offer expires in 15 min" flow, pagination, Playwright E2E tests, CI (GitHub Actions with a MySQL service), a Docker image for the API and a one-click deploy.

---

## 6. AI tools used

Claude (Anthropic) was used to draft the initial project structure, the SQL schema, services, React pages and tests from my design. I reviewed the code, and the concurrency design (row lock + in-transaction promotion + unique generated column) is the part I studied most closely and can explain line by line.

---

## 7. Project layout

```
server/
  db/schema.sql            tables, constraints, unique key that blocks duplicate bookings
  scripts/migrate.js seed.js
  src/
    app.js index.js config.js db.js errors.js schemas.js
    lib/policy.js          pure business rules (unit tested)    lib/time.js  date helpers
    middleware/            auth (JWT+roles), validate (zod), error
    services/              bookingService  waitlistService  classService  membershipService
                           attendanceService  reportService  notificationService
    routes/                thin HTTP layer
    jobs/expiryReminders.js
  tests/unit  tests/integration
client/src                 React app (pages/, components/, api.js, auth.jsx)
docs/                      API.md, VIDEO_SCRIPT.md, COMMIT_PLAN.md
```
