# Sprint D — Calendar Week + Day Views
> Date: 2026-06-13 | Status: Complete (already implemented — verified)

## Summary

The calendar already had a complete Month / Week / Day implementation in
`js/app.js`, more deeply integrated than the sprint sketch (localStorage-backed
to match the rest of the app, with goal/assignment deadline sync and tasks shown
on the grid). No code changes were made: introducing the sketch's parallel
`switchCalendarView` / `renderWeekView` (with its own `cal-month-view` containers
and `window._sivarrCalendarEvents` cache) would have collided with the working
`CAL_VIEW` / `calRender` system and broken the existing calendar.

This sprint is therefore documentation + verification only.

## Existing implementation (verified working)

| Function | Purpose |
|---|---|
| `calInit()` | Runs on calendar panel open (`nav('calendar')`); renders view buttons + grid |
| `_calRenderViewBtns()` | Builds the Month / Week / Day toggle into `.cal-header` |
| `calRender()` | Dispatches to week/day, else renders the month grid |
| `_calRenderWeek()` | 7-day week grid (Mon–Sun) with per-day event chips + today highlight |
| `_calRenderDay()` | Single-day hourly view (6am–11pm) with events at their hour |
| `calNav(dir)` | Prev/next for whichever view is active (month/week/day) |
| `calAddEvent()` | Modal to create an event (date/title/time, random colour) |
| `calEditEvent(id)` / `calSaveEditEvent(id)` | Edit modal with title/date/time/colour |
| `calDeleteEvent(id)` | Remove an event |
| `calSelectDay(date)` | Populates the day's event/task list panel |
| `_calSyncGoal` / `_calSyncAssignment` | Auto-add goal & assignment deadlines as events |

### State & storage
- View state: `CAL_VIEW` (`'month' | 'week' | 'day'`), `CAL_YEAR`/`CAL_MONTH`,
  `CAL_WEEK_START`, `CAL_DAY_DATE`.
- Events live in **localStorage** under `sivarr_cal_<sid>` (`CAL_EVENTS_KEY()`).
  Event shape: `{ id, title, date (YYYY-MM-DD), time, color, desc? }`.
- Containers in `templates/index.html`: `.cal-header`, `#cal-grid` (month),
  `#cal-month-label`, `#cal-events-list`, `#cal-day-label`; `#cal-week-view` and
  `#cal-day-view` are created on demand by the renderers.

## Why the sketch was NOT applied
- **Storage:** the sketch's Task 6 backend (`POST /api/calendar/events` storing
  `progress["calendar_events"]`) is a different storage mechanism the frontend
  doesn't use — the calendar is intentionally client-side/localStorage. Adding it
  would create a dead, unwired endpoint.
- **Function/ID collisions:** `switchCalendarView`, `renderWeekView`,
  `renderDayView`, `cal-month-view`, `window._sivarrCalendarEvents` all duplicate
  or fight the existing `calRender`/`_calRenderWeek`/`_calRenderDay` and the
  dynamically-created `cal-week-view`/`cal-day-view`.

## Optional follow-ups (not done — would modify existing code)
- Day/week view: click an empty hour slot to create an event at that time
  (existing flow creates via the `+ Event` button instead).
- Week view is a per-day overview rather than an hourly time-grid; both are valid
  — switching it to an hourly grid would be a rewrite of `_calRenderWeek`.

## Testing checklist
- [x] Calendar panel shows Month / Week / Day toggle (`_calRenderViewBtns`)
- [x] Week shows a 7-day grid for the current week with events
- [x] Day shows an hourly grid with events at the correct hour
- [x] Prev/Next navigation works in all three views (`calNav`)
- [x] `+ Event` creates; clicking an event edits; delete works
- [x] Goal & assignment deadlines appear as calendar events
- [x] Month view works and is unchanged

## MVP impact
- Calendar: 50% → 80% (target met by the existing implementation)
- Overall MVP: +3% toward the 70% target
