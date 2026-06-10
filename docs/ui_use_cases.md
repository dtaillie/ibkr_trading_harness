# Dashboard Use Cases And Surface Budget

The dashboard accumulated many overlapping summary panels (assistants,
evidence panels, action summaries, command centers) that restate the same
facts in different prose. This document names the use cases each page serves
and budgets the surfaces allowed on each page's default lens. Anything that
does not directly serve the page's primary use case belongs in a secondary
lens (Activity / Diagnostics) or should be removed.

## Key Use Cases

- **UC1 — Health glance.** "Is my strategy healthy right now?" Answerable in
  under ten seconds from Overview Home without scrolling past one viewport.
- **UC2 — Performance read.** "How is it doing today / this month / all-time,
  and why?" Charts first; drill from a number to the trades or days behind it.
- **UC3 — Data confidence.** "What saved data do I have, and why is a symbol
  visible or missing?"
- **UC4 — Replay loop.** "Take saved data, build a draft, validate, replay,
  read the result."
- **UC5 — Incident response.** "Something is wrong — what, why, and what do I
  do?" Every alert explains itself and links to the page that fixes it.

## Surface Budget Per Default Lens

A default lens gets at most: one intro strip, one hero/primary surface, and
three supporting surfaces. Meta-panels that summarize other panels count
against the budget; two summaries of the same facts means one of them moves
or dies.

## Pass 1 (2026-06-10) — Overview Home

Kept: hero (equity + sparkline + status tiles), Performance Snapshot,
Current Alerts (promoted from Diagnostics — incidents belong on Home),
Open Positions. Moved to Activity: Today's Command Center, Today at a
Glance, Since Last Refresh. Moved to Diagnostics: Backend Pipeline,
Strategy Health Report, Start Here.

## Pass 2 Candidates

- **Performance Home**: Story, Review, Evidence, Action Summary, Scoreboard,
  Report, and Periods strip all summarize the selected source. Keep the
  scoreboard and the home band; move the prose meta-panels to Diagnostics.
- **Workbench Home**: Simulation Plan, Readiness Review, Evidence, Stage
  Summary, and Action Summary restate the same guide state. Keep the stepper
  and one summary; move the rest.
- **Page intro strips**: the per-view answers/evidence/next-move card rows and
  numbered workflow rails are onboarding aids; consider collapsing them after
  first use (e.g. a dismissible state) or moving them into Help.
- **Data Home**: keep Saved Universe spotlight + Data Inventory; the
  remaining review/report/visibility panels overlap and belong in
  Diagnostics.
