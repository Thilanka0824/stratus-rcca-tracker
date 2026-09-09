# Stratus Aerial — Test Operations Platform

https://stratus-rcca-tracker.vercel.app

A test-operations dashboard for a **fictional** autonomous drone-robotaxi company.
It covers the whole lifecycle of a test program:

> **Request → Prioritize → Dispatch → Execute → Triage → RCCA → Report**

The first half is a coordinator's day. Requests come in against a cutoff, get
prioritized, and get matched to vehicles and certified crew across shifts under
staffing targets. The second half starts when the sortie flies: runs, failures,
triage, root cause, and the end-of-day report. I built it to show how I run that
work, as software with the rules written down.

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

## Who it's for

| Persona | Job to be done | Where it lives |
|---|---|---|
| **Test coordinator** (primary) | Intake everything, prioritize, build tomorrow's plan, handle day-of scrubs, explain shortages with data | Requests · Dispatch · Capacity |
| **Requesting engineer** | Submit a complete request before cutoff; know when it will run and why it didn't | Requests (intake form, timeline drawer) |
| **Operator / safety pilot** | See tomorrow's assignment; know what they're rated on | Dispatch · rating matrix |
| **Program lead** | Demand vs supply, deferral causes, whether the target is being met | Capacity · Reports |

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

A block is rejected with the rule id and a message, for example "R1 · H. Brandt is
not rated on Sirocco". A warning renders inline and in the day summary. Intake runs
the same way: the form validates each field by name and shows the R7 verdict before
you submit, so a late request is never a surprise to the person who filed it.

## Metrics

The KPI tree, as the Capacity view and the SQL notebook compute it:

- **North star, on-window fulfillment:** requests executed within a requested
  window on or before their date ÷ requests submitted before cutoff, split by
  priority. 88% in the seed, 73% for P0.
- **Deferral share by cause.** The Pareto that turns "operator shortage vs pilot
  shortage" into a number. Occurrence-weighted, like the root-cause Pareto.
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
operator sat idle in a window the request asked for? In the seed, 15 of the 22 on
Harmattan, and in most of those no rated pilot was free either.

## The stories seeded in the data

Synthetic data is honest about being synthetic. It's also designed, not random. Six
arcs are planted so every view has something to say.

**Dispatch, the upstream half**

1. **The misattributed shortage.** Through April the Harmattan deferrals are logged
   as *no rated operator*. That was the thread consensus. The rating matrix shows
   the real constraint: two pilots rated on Harmattan. Two Crew Qualification
   flights cross-rate two operator-pilots at the end of May, and the Harmattan
   crew-deferral rate drops about 80%. The twist is that those flights had been
   deferred twice during the cert push, because training is P2. The lowest-priority
   program was the one that would have fixed the shortage.
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

**RCCA, the downstream half**

4. **The sim-only crosswind failure.** "Precision Landing — Gusty Crosswind" fails
   chronically in Simulation while the same scenario passes in Flight. That's the
   signature of a test-config problem, and the 5-Whys land on a unit mismatch (m/s
   vs. knots).
5. **The telemetry gap cluster.** Flight runs in a three-week window drop telemetry
   about 40% of the time. It traces to an uploader race on rapid disarm.
6. **A genuine regression.** Builds v2.15.0 and .1 spike intruder-avoidance
   failures. The weekly chart shows the dip and the recovery after v2.15.2 ships.
   This is the failure that grounded the two Levants in arc 3.

## The five-minute demo

1. Open **Dispatch** for tomorrow. The rail shows two unscheduled P0.
2. Assign the Sirocco request with an unrated pilot. R1 blocks with the message.
   Pick a rated one and the chip fills; the program meter turns green.
3. Defer the P2 type-rating request. A reason is required. Choose *no rated pilot*.
4. Open **Capacity** and filter deferrals by cause to Harmattan. *No rated pilot*
   dominates, and the rating matrix as of May 15 shows the two-pilot bottleneck.
   The fix was cross-rating, not hiring, and it was sitting in the P2 queue.
5. Open the board on June 10 and click a grounded Levant. You land on its failure
   in **Triage**, and the dip is in **Reports**. Same event, both sides.
6. Every rule has a test, and `npm run data` regenerates everything, including the
   SQLite file and the analytics notebook in this repo.

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
- **No router.** Seven tabs in two groups by index. Hash routing only if it hurts.
- **"Today" is the last date in the dataset.** Tomorrow (today + 1) exists as a
  planned day with an unscheduled queue, which is the board's default view. Nothing
  ages by the wall clock.
- **Paretos are occurrence-weighted**, for root causes and for deferral reasons
  alike. A thing seen nine times counts nine.
- **Artifact requirements vary by pipeline.** Video is n/a for Simulation, so the
  integrity audit has no false alarms.
- **Light and dark themes, system-aware**, resolved before first paint.

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

## Cut list, with reasons

- **Auth / roles.** One coordinator, one screen. Roles would prove login, not dispatch.
- **Notifications.** The board and the EOD report are the notification.
- **Live multi-user backend.** Session-only state keeps the claim on workflow design.
- **Drag-and-drop.** Click-to-assign runs the same rules with fewer accidents.
- **Mobile layout.** The board is a desk tool. The rest of the app already collapses.
- **Training / certification ladder, program handbook, calendar sync.** Real, and out of scope.
- **AI intake parser.** Free-text request → schema via tool use with a
  validation-retry loop. It needs a serverless function for the key, so it waits
  until there's a backend to put it behind.

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
src/lib/rules.js          R1–R8 as pure functions (+ rules.test.js)
src/lib/dispatch.js       plan-side derivations: Pareto, the tell, utilization, lead time, churn, rating matrix
src/lib/helpers.js        RCCA-side derivations and the chart theme
src/views/                Requests · Dispatch · Capacity | Runs · Triage · Analytics · Reports
src/data/*.json           the emitted seed the app imports at build time
```

## Next

- Structured intake from free text: parse a request into the schema the intake
  form already validates.
- Live multi-user state, once there's something worth persisting.
- Lazy-load the seed JSON the way the chart views already are. The initial chunk
  is about 780 KB before gzip, most of it the seed.

The shortage you hear about isn't always the shortage you have. That's what the
data is for.

---

Built by Thilanka Rodrigo · [github.com/Thilanka0824](https://github.com/Thilanka0824)
