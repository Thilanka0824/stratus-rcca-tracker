# Stratus Aerial — Test Operations Platform

https://stratus-rcca-tracker.vercel.app

A test-operations dashboard for a **fictional** autonomous drone-robotaxi company.
It covers the whole lifecycle of a test program:

> **Request → Prioritize → Dispatch → Execute → Triage → RCCA → Report**

The first half is a coordinator's day. Requests come in against a cutoff, get
prioritized, and get matched to vehicles and certified crew across shifts under
staffing targets. The second half starts when the sortie flies: runs, failures,
triage, root cause, and the end-of-day report. A persona picker decides who can
do what: coordinators plan, authority sets priority, the trainer grants ratings,
crew acknowledge their seat — and a rider-operations desk that cannot be waived
covers every flight with riders aboard. I built it to show how I run that work,
as software with the rules written down.

**All data is synthetic.** `generate_data.py` produces it from a fixed seed, so every
number in this README can be regenerated. The design is modeled on
test-coordination workflows I've run. It isn't any employer's system, and no real
company data, tooling, people, or incidents appear anywhere in the repo.

---

## The problem

Daily test dispatch looks the same at most companies. Engineers submit requests
against a cutoff. A coordinator matches them to tails and certified crew across
shifts, under staffing targets and priorities. The tooling is a spreadsheet plus
chat threads. That works until a shortage gets argued in a thread instead of
measured, and the program pays for the wrong fix.

This build does one narrow slice properly. The board will only save what the rules
allow, and it tells you which rule and why. A deferral can't be saved without a
reason, so the deferral log turns into data. And the capacity view names the
constraint that's actually binding, then checks whether the reason the log gave
survives contact with the roster.

Everything else is on the cut list, on purpose.

## The principle

**Rider experience is the product.** A rider-facing flight without a rider
operator on the line is not a flight, and a rider operator juggling more riders
than the desk ratio allows is not coverage. Both are structural rules (R10), not
settings: there is no waiver control anywhere in the app, and the seed contains
the week that principle cost a P0 showcase flight.

Before I coordinated tests I ran rider operations: riders calling in during
rides, escalation, and staffing a desk to a minimum every shift. Stratus treats
that desk as a first-class resource — people on the roster, a window covered, a
ratio — because that is what it is.

Two supporting principles were already in the build and now have names.
**Musts become structure**: R8, R9 and R10 are enforced in code, and the
disabled button is a courtesy. **Deferrals are data**: every refusal carries a
reason and an actor.

## Who it's for

| Persona | Job to be done | Where it lives |
|---|---|---|
| **Test coordinator** (primary) | Intake everything, prioritize, build tomorrow's plan, roster the rider desk, handle day-of scrubs, explain shortages with data | Requests · Dispatch · Capacity |
| **Requesting engineer** | Submit a complete request before cutoff, withdraw it while it waits, know when it will run and why it didn't; triage failures | Requests (intake form, timeline drawer) · Triage |
| **Program lead / PM** | Set priority and tail targets inside scope; demand vs supply, deferral causes; the PM also sets the desk's ratio | Dispatch (program header) · Capacity · Reports |
| **Rider ops lead** | The desk's ratio and minimum, and a view of who covers it — the coordinator rosters it | Dispatch (desk row) · Capacity |
| **Trainer** | Grant ratings and the desk qualification, effective-dated — never their own | Capacity (rating matrix) |
| **Operator / safety pilot / rider operator** | See tomorrow's sortie or desk window, and acknowledge it | My day |
| **Manager** | Read everything, change nothing | Capacity · Reports |

## What's modeled

| Concept | In Stratus |
|---|---|
| Test operator + driver pairing per shift | **Operator** + **safety pilot** per window (AM · PM · NIGHT) |
| Per-person platform certifications | **Type ratings** per airframe, with an effective date |
| Vehicle families and individual vehicles | **Airframes** in the *Windz* family: Levant (6 tails) · Harmattan (4) · Sirocco (2) |
| Daily min/max staffing target per program | Program **asset target** (min–max tails per day) |
| Daily intake post with a next-day cutoff | **Intake cutoff** at 15:00 local. Late requests are flagged, never silently absorbed |
| Request flavors | **Crew requirement**: none · pilot only · operator + pilot · lone operator (self-pilot) |
| Vehicle down / reserved | Asset **status**: available · grounded · maintenance · reserved, with history |
| Shortage argued in a thread | **Structured deferral reason**, the thing the spreadsheet can't give you |
| Rider operations: a remote desk on comms with riders aboard | **Rider desk**: coverage per window, a ratio of rider-facing sorties per coverer, an effective-dated qualification |
| Who may do what | **Personas, not logins**: app roles with scoped authority, and three separation-of-duties rules |

Six programs share the fleet: Precision Landing Cert (P0, Harmattan), Perception
Nightly (P1, Levant), Sirocco Bring-up (P0), Urban Route Campaign (P1, Levant),
Crew Qualification (P2, the lowest priority; remember that), and ad hoc Showcase
Flights (P0).

## The rules

Judgment stays in the coordinator's head. The deterministic shell is code. Rules
live in `src/lib/rules.js` as pure functions over plain data, and the test suite
runs the same functions over the seed. The data and the app can't disagree about
what's allowed.

| # | Rule | Severity |
|---|---|---|
| R1 | Operator and pilot must hold the type rating for the sortie's airframe, as of that day | block |
| R2 | No person and no tail in two sorties in the same date + window (a scrubbed sortie frees its crew, not its slot) | block |
| R3 | Grounded / maintenance tails are unassignable; reserved tails only to the reserving program | block |
| R4 | Crew must satisfy the request's crew requirement; a lone operator needs self-pilot + rating | block |
| R5 | Program tails per day between `asset_min` and `asset_max`. Under = red, over = amber | warn |
| R6 | P0 starvation: an unscheduled P0 waits while a lower priority holds a compatible tail that day | warn |
| R7 | Submitted after the cutoff for the next day → `late`, defaults to the next open day | warn |
| R8 | A deferral (or scrub) without a reason cannot be saved | structural |
| R9 | Authorization: a mutation whose actor lacks the permission, the ownership or the scope is refused with the role and the action named | structural |
| R10 | Coverage: a rider-facing sortie can't be saved into a window with no qualified rider operator covering, and can't push the desk over its ratio (rider-facing sorties ÷ coverers) | block |

R2 extends to the desk: a person covering a window can't fly in it, and can't cover
it twice; and a coverer can't be released while the window's riders would be left
uncovered. A block is rejected with the rule id and a message, for example "R1 · H.
Brandt is not rated on Sirocco", "R9 · coordinator only (signed in as Observer)",
"R9 · you can't assign your own request" or "R10 · desk at 3:1, ratio is 2". A
warning renders inline and in the day summary. Intake runs the same way: the form
validates each field by name and shows the R7 verdict before you submit, so a late
request is never a surprise to the person who filed it.

## Roles: personas, not logins

Authorization without authentication. The header has a "Signed in as" picker; the
persona is state, not identity, so switching it never resets the plan — it changes
what the plan allows. No passwords, no accounts, nothing persists. Every control a
persona can't use stays on screen, disabled, with the rule as its tooltip, so
everyone can see what they can't do and why. Enforcement is in the rules; the
disabled button is a courtesy.

Crew roles (operator, safety pilot, rider operator) live on people and describe
seats and desks. App roles live on personas and describe behavior; the title is
display.

| Title | App role | Scope |
|---|---|---|
| Engineer, Test engineer | `requester` | own requests; triage on failures |
| Test coordinator (AM / PM) | `coordinator` | the plan and the desk roster |
| Program lead | `authority` | their programs |
| PM | `authority` | everything, and the desk's settings |
| Rider ops lead | `authority` | the desk |
| Trainer | `trainer` | ratings and qualifications, never their own |
| Pilot, Operator, Rider operator | `crew` | their own sortie or coverage |
| Manager | `observer` | read-only, plus Capacity and Reports |

The matrix is data (`src/lib/auth.js`) and the tests are generated from it, every
role × every action. The short version:

| Action | requester | coordinator | authority | trainer | crew | observer |
|---|---|---|---|---|---|---|
| file a request | yes | yes (on behalf) | in scope | · | · | · |
| withdraw, before it is scheduled | own | yes | in scope | · | · | · |
| assign, reassign, defer, scrub, cover the desk | · | **yes** | · | · | · | · |
| program priority and tail targets | · | · | **in scope** | · | · | · |
| the desk's ratio and minimum | · | · | **PM or rider ops lead** | · | · | · |
| grant or revoke a rating or qualification | · | · | · | **not self** | · | · |
| acknowledge a sortie or coverage | · | · | · | · | own | · |
| triage a failure | **yes** | · | · | · | · | · |
| Capacity, Reports, analytics | yes | yes | yes | yes | · | yes |

Three separation-of-duties rules, each a test and each true of the seed:

- **I1** Nobody assigns their own request, refused even for a coordinator. When a
  coordinator files on an engineer's behalf, the other coordinator places it.
- **I2** Nobody grants their own rating or qualification.
- **I3** Coordinators consume priority and can't set it; authority sets priority and
  can't assign.

Two more hold on the seed and are checked on every regeneration: every actor's role
permits the event it stamped (I4), and every rider-facing sortie flew with a
qualified coverer in its window, at or under ratio (I5). The matrix also carries
`request.edit` and `plan.reassign` ahead of their controls; today's edits are
withdraw and the board's assign.

## Metrics

The KPI tree, as the Capacity view and the SQL notebook compute it:

- **North star, on-window fulfillment:** requests executed within a requested
  window on or before their date ÷ requests submitted before cutoff, split by
  priority. 85% in the seed, 70% for P0. Rider-facing requests are split out
  from it, because that is the number the desk's ratio is meant to protect.
- **Deferral share by cause.** The Pareto that turns "operator shortage vs pilot
  shortage" into a number. Occurrence-weighted, like the root-cause Pareto — and
  since the desk exists it has a cause that is neither aircraft nor pilots.
- **Desk load:** rider-facing sorties per coverer, per window, against the ratio.
  This is the rider-experience proxy and the KPI the principle protects; in the
  seed it peaks at 2.0 per coverer on Jun 15. **Desk coverage** is the same thing
  from the other side: coverers per window against rider-facing demand, by day.
- **Actions by role:** filings by requesters and leads, plans and deferrals by
  coordinators, grants by the trainer. Every event carries its actor.
- **Asset utilization:** assigned asset-windows ÷ available asset-windows, on
  operating days. Grounded tails leave the denominator. Never penalize the plan
  for a grounded tail. Tail-day saturation sits next to it, because the two numbers
  tell different stories in a grounding week.
- **Crew utilization:** the same, per rated operators and pilots.
- **Lead time:** submitted → executed, p50 / p90.
- **Plan churn:** scrubs + same-day reassignments per day, after the plan was set.
- **Loop metric:** grounding days attributable to RCCA items. That's the dispatch
  cost of the RCCA backlog.

One more number isn't a KPI but decides which lever to pull. Call it the tell. Of
the deferrals logged as "no rated operator", how many fell on a day when a rated
operator sat idle in a window the request asked for? In the seed, 16 of the 24 on
Harmattan, and in most of those no rated pilot was free either. Someone on the
rider desk is on comms, not idle; the tell knows the difference.

## The stories seeded in the data

Synthetic data is honest about being synthetic. It's also designed, not random. Seven
arcs are planted so every view has something to say.

**Dispatch, the upstream half**

1. **The misattributed shortage.** Through April the Harmattan deferrals are logged
   as *no rated operator*. That was the thread consensus. The rating matrix shows
   the real constraint: two pilots rated on Harmattan. Two Crew Qualification
   flights cross-rate two operator-pilots at the end of May, and the Harmattan
   crew-deferral rate drops by about two-thirds. The twist is that those flights
   had been deferred twice during the cert push, because training is P2. The
   lowest-priority program was the one that would have fixed the shortage.
2. **The bring-up surge.** Over one June weekend, Sirocco Bring-up files 22 requests
   against 8 asset-windows (2 tails × 2 days × AM/PM). Seven fly, one is lost to
   fog, fifteen defer with reasons, and five arrived after the Friday cutoff and
   carry `late`. Lead-time p90 for the surge is 6 days against 2 overall. The backlog
   clears the following week.
3. **The grounding cascade.** LV-03 and LV-05 are grounded June 10 to 18 against the
   software-regression failure below. That's 18 tail-days, 8 of them while the
   failure was still open. The remaining Levants fly every day, Perception Nightly
   misses its asset minimum on five days, and churn peaks on the day of the
   grounding. The same event shows on the board and on the RCCA weekly chart. Click
   the grounded tail on the board and you land on the failure.
4. **The desk shortage.** The showcase run — three guest flights a day, Jun 15–17,
   all in the afternoon — lands while the swing-shift rider operator is on leave,
   so one person covers the PM desk. One rider operator can hold two rider-facing
   sorties, not three (R10): the third P0 showcase of the day is refused with
   `R10 · desk at 3:1, ratio is 2` while a Levant and a rated crew sit free — the
   refusal note names them — and the note asks the PM to waive a ratio that has
   no waiver. On Jun 17 the trainer's desk qualification for an operator takes
   effect, the desk has two coverers, and the backlog flies. Cross-training fixes
   the shortage for the second time in the dataset: arc 1 was ratings, this one
   is the desk.

**RCCA, the downstream half**

5. **The sim-only crosswind failure.** "Precision Landing — Gusty Crosswind" fails
   chronically in Simulation while the same scenario passes in Flight. That's the
   signature of a test-config problem, and the 5-Whys land on a unit mismatch (m/s
   vs. knots).
6. **The telemetry gap cluster.** Flight runs in a three-week window drop telemetry
   about 40% of the time. It traces to an uploader race on rapid disarm.
7. **A genuine regression.** Builds v2.15.0 and .1 spike intruder-avoidance
   failures. The weekly chart shows the dip and the recovery after v2.15.2 ships.
   This is the failure that grounded the two Levants in arc 3.

## The ten-minute demo

The app opens as the AM coordinator; steps that need another persona say so.

1. Open **Dispatch** for tomorrow. The rail shows two unscheduled P0.
2. Assign the Sirocco request with an unrated pilot. R1 blocks with the message.
   Pick a rated one and the chip fills; the program meter turns green.
3. Defer the P2 type-rating request. A reason is required. Choose *no rated pilot*.
4. Open **Capacity** and filter deferrals by cause to Harmattan. *No rated pilot*
   dominates, and the rating matrix as of May 15 shows the two-pilot bottleneck.
   The fix was cross-rating, not hiring, and it was sitting in the P2 queue.
5. Open the board on June 10 and click a grounded Levant. You land on its failure
   in **Triage**, and the dip is in **Reports**. Same event, both sides.
6. Sign in as **Manager**: Assign is disabled, tooltip `R9 · coordinator only
   (signed in as Observer)`, and the triage stepper says `requester only`. Sign
   in as **Coordinator**: the same button works.
7. Open Jun 15 on the board. The rail shows the third showcase deferred:
   `R10 · desk at 3:1, ratio is 2 · LV-02 and K. Halvorsen / W. Adeyemi were free
   — asked R. Adair (PM) to waive the ratio; there is no such action`. Switch to
   **PM**: the desk's settings are a ratio and a minimum, and nothing else. *The
   principle cost us a P0, on purpose.*
8. Sign in as **Trainer**, open Capacity, edit the matrix: qualify an operator on
   the rider desk from tomorrow. The trainer's own row is refused (I2). Back as
   Coordinator, cover tomorrow's PM with them: the desk row recomputes.
9. Capacity: the deferral Pareto shows `No rider operator`, the desk chart shows
   the June week against the ratio, and actions by role shows who deferred what.
   Open any request: the timeline names the actor on every event, and query 09 in
   the notebook says the same in SQL.
10. Every rule has a test — the matrix tests are generated from the matrix — and
    `npm run data` regenerates everything, including the SQLite file and the
    analytics notebook in this repo, and asserts the arcs still hold.

## Architecture decisions

- **Build-time data stays.** Generator → JSON → props. Board edits (assign, defer,
  scrub) and triage edits live in React state for the session only, and the footer
  says so. A backend would spend the effort proving CRUD, which is the wrong claim.
- **Rules are pure functions with tests.** `vitest` is scoped to `rules.js` on
  purpose; it's the repo's first test suite. Fixtures violate each rule and assert
  the outcome, and the seed is checked against the same functions.
- **SQL layer, honestly scoped.** The generator also writes `data/stratus.sqlite`
  from `sql/schema.sql`, with foreign keys and slot uniqueness enforced.
  `sql/analytics/*.sql` holds the metric queries and `docs/analytics.md` is rendered
  from them. The app renders live from state; the notebook answers the same
  questions against the seed database. Reviewable SQL in the repo, no server.
- **No router.** Eight tabs in two groups by index. Hash routing only if it hurts.
- **"Today" is the last date in the dataset.** Tomorrow (today + 1) exists as a
  planned day with an unscheduled queue, which is the board's default view. Nothing
  ages by the wall clock.
- **Paretos are occurrence-weighted**, for root causes and for deferral reasons
  alike. A thing seen nine times counts nine.
- **Artifact requirements vary by pipeline.** Video is n/a for Simulation, so the
  integrity audit has no false alarms.
- **Light and dark themes, system-aware**, resolved before first paint.
- **Personas, not logins.** Authorization without authentication: the claim is who
  can do what and why, which a login screen never proves. Real login arrives with
  the backend.
- **R10 is a block, not a warning.** A soft ratio is a ratio that gets waived on
  showcase day.

## Tradeoffs I'd challenge in review

- Demand in "demand vs supply" counts a request once, by its first-choice window.
  Flexible requests are under-counted where they could also have flown.
- Utilization denominators use operating days (anyone rostered). A weekend with a
  skeleton crew counts as capacity for every tail.
- Late intake is excluded from the north-star denominator so the metric measures
  the plan rather than intake discipline. That's arguable. R7 makes intake visible
  instead.
- The planner that produced the seed is greedy: P0 first, then submission order.
  It's honest about that, and R6 exists because real plans aren't.
- A hard desk ratio defers P0 work a judgment call might have covered. In the seed
  that is showcase flights slipping a day. I'd still take it: the rider on the
  phone doesn't know it was showcase day.
- When a coordinator files on an engineer's behalf, I1 makes the other coordinator
  place it. Honest, and slightly ceremonial.

## Cut list, with reasons

- **Real login / SSO.** Still cut: a gate, not a door, and it arrives with the
  backend. Roles are no longer cut. What changed the decision is that the
  permission model changes outcomes — who can waive what, who can assign whose
  request — which login never did.
- **Notifications.** The board and the EOD report are the notification.
- **Live multi-user backend.** Session-only state keeps the claim on workflow design.
- **Drag-and-drop.** Click-to-assign runs the same rules with fewer accidents.
- **Mobile layout.** The board is a desk tool. The rest of the app already collapses.
- **Training / certification ladder, program handbook, calendar sync.** Real, and out of scope.
- **AI intake parser.** Free-text request → schema via tool use with a
  validation-retry loop. It needs a serverless function for the key, so it waits
  until there's a backend to put it behind.
- **Rider incidents feeding RCCA, a rider comms log on the sortie, role-based
  notifications.** Real, named because the desk makes them real, and next.

## Run it

```bash
npm install
npm run dev        # Vite dev server
npm run build      # production build
npm test           # vitest: rules.js, including the seed
npm run data       # python3 generate_data.py + render docs/analytics.md (also writes data/stratus.sqlite)
npm run analytics  # re-render docs/analytics.md only
```

## Stack

React 18 · Vite · Recharts · vitest · Python 3 (data generation, SQLite) ·
IBM Plex Mono / Space Grotesk / IBM Plex Sans

## Layout

```
generate_data.py          the seed: RCCA runs + failures, then the dispatch layer (own RNG stream)
sql/schema.sql            the seed database schema; sql/analytics/*.sql the metric queries
scripts/render_analytics.py → docs/analytics.md
src/lib/auth.js           the permission matrix as data: can() for the UI, authorize() for the rules
src/lib/rules.js          R1–R10 as pure functions (+ rules.test.js; the matrix tests are generated from auth.js)
src/lib/dispatch.js       plan-side derivations: Pareto, the tell, utilization, lead time, churn, the desk, actions by role
src/lib/helpers.js        RCCA-side derivations and the chart theme
src/views/                Requests · Dispatch · Capacity · My day | Runs · Triage · Analytics · Reports
src/data/*.json           the emitted seed the app imports at build time — users.json is the personas, coverage.json the desk
```

## Next

- Structured intake from free text: parse a request into the schema the intake
  form already validates.
- Live multi-user state, once there's something worth persisting.
- Lazy-load the seed JSON the way the chart views already are. The initial chunk
  is about 920 KB before gzip (about 120 KB gzipped), most of it the seed.

The shortage you hear about isn't always the shortage you have. That's what the
data is for.

---

Built by Thilanka Rodrigo · [github.com/Thilanka0824](https://github.com/Thilanka0824)
