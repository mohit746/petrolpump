---
  Feature Issues — fueldesk-v2

  ---
  1. Attendance

  [BUG] Checkout GPS coordinates are always null
  - In Attendance.tsx → checkInMutation.onSuccess, setPendingAction(null) is called for both check-in and check-out paths (lines 130-131). The handover dialog opens and handoverMutation tries to read
  pendingAction?.lat — but by then it's already null.
  - Fix: only reset pendingAction when !result.requiresHandover.
  
  [BUG] Night-shift late detection is wrong after midnight
  - In attendance.ts:52-61, shift is assigned purely on checkInHour with hard ranges (6→14 = morning, 14→22 = evening, else = night). An employee checking in at 00:30 for a 22:00 night shift gets
  minutesLate = 30 - (22*60) = -1290 which is negative → marked PRESENT. But someone checking in at 05:00 gets minutesLate = 300 - (22*60) = -1020 → also PRESENT. The math collapses when the shift spans
   midnight.
  - Fix: normalize minutes to handle day-wrap (add 1440 if minutesLate < -lateGrace).

  [BUG] Download icon imported but never rendered in AdminAttendance
  - Attendance.tsx:7 imports Download from lucide-react but no export/download button exists in the admin view. Either wire it up or remove the import.
  
  [MISSING] Admin attendance view has no CSV export or date-range filter
  - Admin can only pick a single date. No way to export monthly attendance data for payroll review.

  ---
  2. Leaves

  [BUG] End date before start date is not validated
  - Leaves.tsx leave form sets min={today} for both fields but does no cross-field validation. A user can submit start_date=2025-05-30, end_date=2025-05-01. The leave record is created with a negative
  duration.
  - Fix: add form-level validation end_date >= start_date.
  
  [BUG] "Earned" leave balance always shows 0 used
  - Leaves.tsx:74-86 — earnedUsed is initialized to 0 and never incremented. PLANNED → casualUsed, EMERGENCY → sickUsed. Earned leaves always display as fully remaining.
  
  [BUG] Leave day count uses manual Math.ceil math prone to DST errors
  - Both Leaves.tsx:77 and payslip.ts:163 compute days as Math.ceil((end - start) / 86400000) + 1. On DST-transition days this gives ±1 wrong answer. differenceInCalendarDays from date-fns is already
  imported — use it instead.

  [MISSING] No check against leave balance before applying
  - Employees can apply for more days than their remaining balance. The leave balance card is informational only, with no hard block on the form.

  ---
  3. Credit Management

  [BUG] Outstanding balance is recalculated from ALL transactions including REJECTED
  - CreditManagement.tsx:73-84 — after inserting a new transaction, all rows are fetched and summed with no status filter. REJECTED transactions still inflate or deflate the balance.
  - Fix: add .neq('status', 'REJECTED') (or .in('status', ['PENDING','APPROVED'])) to the balance recalculation query.

  [BUG] notes field inserted but absent from the CreditTransaction type
  - CreditManagement.tsx:67 inserts notes: d.notes, but types/index.ts CreditTransaction interface has no notes field. The type and DB are out of sync.
  
  [MISSING] No UI to approve or reject pending credit transactions
  - All transactions are created with status: 'PENDING'. The type defines APPROVED / REJECTED / AWAITING_APPROVAL statuses but there is no approve/reject button anywhere in the transactions dialog.

  ---
  4. Employees

  [BUG] Salary field name mismatch: TypeScript type says base_salary, DB column is salary
  - types/index.ts:46 defines base_salary: number, but Employees.tsx:88 upserts salary:, the list renders e.salary, and payslip.ts:75 reads employee.salary. The TypeScript type is wrong relative to the
  actual column name, causing TypeScript to not catch salary-related bugs.
  
  [BUG/RISK] supabase.auth.signUp() can replace the admin's active session
  - Employees.tsx:70-84 — calling signUp() in the admin context can silently swap the Supabase client's active session to the newly created user (Supabase v2 behavior). The save-and-restore via
  setSession() is fragile: if the new user requires email confirmation the session won't exist to restore; if setSession fails the admin is logged out silently.
  - Fix: Use a Supabase Edge Function / Admin API to create auth users server-side, eliminating client-side session manipulation.

  ---
  5. Payslip
  
  [BUG] allowances displayed in payslip detail but missing from type and DB
  - Payslip.tsx:140: {formatINR(detail.allowances ?? 0)} — allowances doesn't exist on the Payslip type or in savePayslip(). The allowances row always shows ₹0.
  
  [BUG] currentYear is module-level — stale across year boundary
  - Payslip.tsx:15: const currentYear = new Date().getFullYear() executes once when the module is loaded. If the app is left open over midnight on December 31, the year selector stays on the old year.
  - Fix: Move inside the component or use useMemo.

  [BUG] Payslip upsert conflict key missing pump_id
  - payslip.ts:318: onConflict: 'user_id,month,year' — two employees at different pumps with the same Supabase user_id would conflict. Conflict key should be pump_id,user_id,month,year.
  
  [BUG] Lorry allowance rate is hardcoded at ₹500/duty
  - payslip.ts:210: const lorryAllowancePerDuty = 500. This should be read from system_settings so each pump can configure their own lorry allowance rate.
  
  [UX] "Download" button calls window.print() — misleading
  - The payslip detail modal has a Download icon button that triggers window.print(). Users expect a file download. Either rename it to "Print / PDF" or generate an actual PDF download.

  ---
  6. Lorry Duty

  [BUG] Marking a duty COMPLETED sets arrived_at instead of completed_at
  - LorryDuty.tsx:103: if (status === 'COMPLETED') patch.arrived_at = new Date().toISOString() — this overwrites the arrived_at timestamp set in the previous step (ARRIVED → COMPLETED) instead of
  setting a separate completed_at field.
  
  [MISSING] No date range or employee filter for the admin duty list
  - The management view shows all duties in reverse-chronological order with no filtering by date, employee, or status. For active pumps, this list becomes unusable.

  ---
  7. Salary Advances

  [FEATURE INCOMPLETE] Month/year selector is not wired up — always shows current month
  - SalaryAdvances.tsx:76-77:
  const [year]  = useState(now.getFullYear())
  const [month] = useState(now.getMonth() + 1)
  - No setters are exposed and no picker is rendered in the UI. The comment on line 74 explicitly says this was designed to allow past months — but it was never finished. Admins and accountants cannot
  review prior months' advances.
  
  ---
  8. Incentives
  
  [BUG] No amount validation — ₹0 and negative incentives are allowed
  - Incentives.tsx:51-56 — parseFloat(d.amount) is used directly with no > 0 guard. Awarding ₹0 or a negative incentive silently creates a bad record.

  [UX] "Mark Paid" button has no confirmation dialog
  - A single click on "Mark Paid" immediately sets is_paid: true and paid_at with no undo. Every other destructive/irreversible action in the app (block employee, delete employee, reject leave, cancel
  advance) uses a ConfirmDialog. This one does not.

  ---
  9. Fuel Management

  [BUG] total_cost never set in fuel purchase insert
  - FuelManagement.tsx:522-534 — the insert omits total_cost. If there's no DB trigger computing quantity * rate_per_unit, the total_cost column in the DB is null/0 and the list will always show ₹0 for
  every purchase.
  - Fix: add total_cost: qty * rate to the insert payload.

  [MISSING] No date range filter or search on the purchases list
  - The purchases tab fetches the last 50 records with no date filter, supplier search, or fuel type filter. Older records are inaccessible.

  ---
  10. Reports

  [SECURITY] CSV export leaks profit/COGS data regardless of analytics.profit permission
  - Reports.tsx:167-197 — exportDaily() always includes cogs and profit columns in the CSV. The showProfit flag hides these columns in the chart UI but has no effect on the export. A user without
  analytics.profit can click "Daily CSV" to see margin data. 
  - Fix: conditionally exclude cogs and profit from the export when !showProfit.

  ---
  11. Settings
  
  [MISSING] No input validation for geofence latitude/longitude
  - The geofence tab accepts any number for lat/lng. An invalid value (e.g., lat = 999) will be saved and then silently break geofence enforcement in attendance check-in.
  - Fix: add range validation (lat: −90–90, lng: −180–180) before saving.

  [SECURITY] WhatsApp Bearer token stored in plaintext in system_settings
  - The WhatsApp API token is stored in the system_settings table as a plain string, accessible via any authenticated DB query matching the RLS policy. Consider storing it in Supabase Vault or at
  minimum restricting the RLS policy to settings.whatsapp permission holders only.


  ---
  9. Fuel Management

  [BUG] total_cost never set in fuel purchase insert
  - FuelManagement.tsx:522-534 — the insert omits total_cost. If there's no DB trigger computing quantity * rate_per_unit, the total_cost column in the DB is null/0 and the list will always show ₹0 for
  every purchase.
  - Fix: add total_cost: qty * rate to the insert payload.

  [MISSING] No date range filter or search on the purchases list
  - The purchases tab fetches the last 50 records with no date filter, supplier search, or fuel type filter. Older records are inaccessible.

  ---
  10. Reports

  [SECURITY] CSV export leaks profit/COGS data regardless of analytics.profit permission
  - Reports.tsx:167-197 — exportDaily() always includes cogs and profit columns in the CSV. The showProfit flag hides these columns in the chart UI but has no effect on the export. A user without
  analytics.profit can click "Daily CSV" to see margin data.
  - Fix: conditionally exclude cogs and profit from the export when !showProfit.

  ---
  11. Settings

  [MISSING] No input validation for geofence latitude/longitude
  - The geofence tab accepts any number for lat/lng. An invalid value (e.g., lat = 999) will be saved and then silently break geofence enforcement in attendance check-in.
  - Fix: add range validation (lat: −90–90, lng: −180–180) before saving.

  [SECURITY] WhatsApp Bearer token stored in plaintext in system_settings
  - The WhatsApp API token is stored in the system_settings table as a plain string, accessible via any authenticated DB query matching the RLS policy. Consider storing it in Supabase Vault or at
  minimum restricting the RLS policy to settings.whatsapp permission holders only.

  ---
  12. Dark Mode

  [BUG] Dark mode never updates if system preference changes after app load
  - App.tsx:109-114 — DarkModeInit reads window.matchMedia(...) once on mount with no addEventListener('change', ...) listener. If the user changes their OS theme while the app is open, the app stays on
   the old theme.

  [MISSING] No manual dark/light mode toggle in the UI
  - Dark mode is entirely controlled by the OS preference. Users have no way to override it from within the app.

  ---
  13. Cross-Cutting

  [MISSING] No Audit Log viewer page
  - src/lib/audit.ts records audit events for user create/update/delete, fuel price changes, and advances. But there is no route or page in the app to view these logs. Admins have no way to review the
  audit trail.

  [MISSING] List views have no pagination
  - Credit transactions, incentives, lorry duties, payslips, and fuel purchases all load all records (or a hard limit(50) cap) with no "load more" or pagination control. Large datasets will be slow or
  incomplete.

  Summary of Changes
  
  5 P0 bugs fixed (data integrity & security):

  ┌──────┬──────────────────────┬──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
  │  #   │         File         │                                                                     Fix                                                                      │
  ├──────┼──────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ P0-1 │ Attendance.tsx       │ setPendingAction(null) now only clears after check-in; stays alive through handover dialog so checkout GPS coordinates are written correctly │
  ├──────┼──────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ P0-2 │ CreditManagement.tsx │ Balance recalculation now excludes REJECTED transactions (.neq('status', 'REJECTED'))                                                        │
  ├──────┼──────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ P0-3 │ FuelManagement.tsx   │ total_cost: qty * rate added to fuel purchase insert — totals now show real values                                                           │
  ├──────┼──────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ P0-4 │ Reports.tsx          │ CSV export gates cogs/profit columns on showProfit permission — users without analytics.profit no longer see margin data                     │
  ├──────┼──────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ P0-5 │ LorryDuty.tsx        │ Removed the duplicate arrived_at assignment on COMPLETED — the timestamp set during ARRIVED is no longer clobbered                           │
  └──────┴──────────────────────┴──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘

  3 P1 bugs fixed (broken features & wrong data):

  ┌──────┬────────────────────┬───────────────────────────────────────────────────────────────────────────────────────────────┐
  │  #   │        File        │                                              Fix                                              │
  ├──────┼────────────────────┼───────────────────────────────────────────────────────────────────────────────────────────────┤
  │ P1-1 │ Leaves.tsx         │ applyMutation now throws if end_date < start_date — prevents bad leave records                │
  ├──────┼────────────────────┼───────────────────────────────────────────────────────────────────────────────────────────────┤
  │ P1-2 │ Leaves.tsx         │ Added else { earnedUsed += days } catch-all — earned leave balance is no longer permanently 0 │
  ├──────┼────────────────────┼───────────────────────────────────────────────────────────────────────────────────────────────┤
  │ P1-3 │ SalaryAdvances.tsx │ Exposed setMonth/setYear + added month/year picker — admins can now view past months          │
  ├──────┼────────────────────┼───────────────────────────────────────────────────────────────────────────────────────────────┤
  │ P1-4 │ Payslip.tsx        │ Removed the phantom Allowances row that always showed ₹0 (field never existed in the data)    │