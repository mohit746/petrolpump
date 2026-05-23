# FuelDesk v2 — Petrol Pump Management SaaS

A comprehensive multi-tenant platform for managing petrol pump operations, staff, finances, and analytics. Built for pump operators who need daily sales tracking, HR management, credit accounts, and business intelligence in one place.

## Overview

FuelDesk v2 is a **multi-tenant SaaS** where:
- A **Platform Owner** manages all pump tenants from a global dashboard, handling subscriptions and bulk operations
- Each **pump** is a self-contained tenant with its own staff, inventory, and settings
- **Five roles** (Platform Owner, Super Admin, Admin, Accountant, Employee) govern access to 34 granular permissions

### Key Capabilities

- **Daily Operations**: Nozzle meter readings, cash reconciliation, fuel inventory
- **HR Module**: GPS-geofenced attendance, leave requests, payslips, salary advances, incentives
- **Credit Management**: Customer credit accounts, transaction tracking, outstanding balances
- **Fuel Management**: Fuel types, price history, purchase receipts
- **Equipment**: Machine (dispenser) and nozzle catalog with live readings
- **Lorry Duty**: Delivery scheduling, status workflows, WhatsApp notifications
- **Analytics**: Revenue, profit, fuel mix, employee performance, credit aging with CSV export
- **Configuration**: 7-tab settings (general, geofence, shifts, salary, leaves, WhatsApp, fuel rates)
- **Notifications**: WhatsApp integration for attendance, leave approvals, duty assignments, payslip delivery
- **Accessibility**: Bilingual (English + Hindi), PWA-ready, responsive design

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | React 18 + TypeScript + Vite |
| **Routing** | React Router DOM v6 |
| **State Management** | Zustand v4 (persisted to localStorage) |
| **Backend / Database** | Supabase (PostgreSQL + Auth + RLS) |
| **Data Fetching** | TanStack React Query v5 |
| **Forms** | React Hook Form + Zod validation |
| **UI / Styling** | Tailwind CSS + Framer Motion |
| **Icons** | Lucide React |
| **Charts** | Recharts |
| **Internationalization** | i18next (EN + HI) |
| **PWA** | vite-plugin-pwa |

---

## Architecture

### Authentication & Authorization

- **Supabase Auth**: Email/password or mobile number login (mobile resolved via `get_email_by_phone` RPC)
- **Session Persistence**: Auth state stored in localStorage (`fueldesk-auth`) and revalidated on app load
- **RBAC (Role-Based Access Control)**:
  - 34 permissions defined in `role_permissions` DB table
  - Cached in memory on login for instant UI checks
  - Per-user overrides supported via `users.permissions` array (`+permission` = grant, `-permission` = revoke)
  - Supabase RLS is the **true security boundary**; UI cache is a convenience layer
- **Pump Lockout**: Suspended, expired, cancelled, or deleted pumps block login for non-PLATFORM_OWNER users

### Permission System

Permissions are grouped into logical categories:
- **Platform/Tenant**: Pump CRUD, global analytics, tenant impersonation
- **Users / Staff**: User creation, deletion, blocking, permission assignment
- **Leaves**: Request submission, list access, approval/rejection
- **Credit**: Account management, transaction creation/approval
- **Machines / Nozzles**: Catalog CRUD, list access
- **Fuel & Pricing**: Type/price/purchase management, history read
- **Sales / Readings**: Meter reading creation, list access, day lock
- **Salary**: Structure, advances, incentives, payout, payslips
- **Analytics**: Dashboard and profit reports
- **Settings**: Read and update access

---

## Roles & Permissions

### Role Hierarchy

| Role | Scope | Description |
|---|---|---|
| **PLATFORM_OWNER** | Global | SaaS operator—manages all pump tenants, subscriptions, analytics |
| **SUPER_ADMIN** | Pump | Pump owner—full access to pump operations, staff, settings |
| **ADMIN** | Pump | Pump administrator—same as SUPER_ADMIN except cannot create new users or assign permissions |
| **ACCOUNTANT** | Pump | Financial/payroll specialist—credit, salary, readings, fuel purchases |
| **EMPLOYEE** | Pump | Operational staff—limited to own attendance, reads, leaves, payslips |

> Note: `isManagement = SUPER_ADMIN || ADMIN`

### Role × Permission Matrix

PO = PLATFORM_OWNER · SA = SUPER_ADMIN · AD = ADMIN · AC = ACCOUNTANT · EM = EMPLOYEE

#### Platform / Tenant

| Permission | PO | SA | AD | AC | EM |
|---|:---:|:---:|:---:|:---:|:---:|
| pump.create | ✅ | ❌ | ❌ | ❌ | ❌ |
| pump.list_all | ✅ | ❌ | ❌ | ❌ | ❌ |
| pump.update | ✅ | ✅ | ❌ | ❌ | ❌ |
| pump.suspend | ✅ | ❌ | ❌ | ❌ | ❌ |
| pump.delete | ✅ | ❌ | ❌ | ❌ | ❌ |
| pump.impersonate | ✅ | ❌ | ❌ | ❌ | ❌ |
| pump.global_analytics | ✅ | ❌ | ❌ | ❌ | ❌ |

#### Users / Staff

| Permission | PO | SA | AD | AC | EM |
|---|:---:|:---:|:---:|:---:|:---:|
| users.create_super_admin | ✅ | ❌ | ❌ | ❌ | ❌ |
| users.create | ✅ | ✅ | ❌ | ❌ | ❌ |
| users.list | ✅ | ✅ | ✅ | ✅ | ❌ |
| users.update | ✅ | ✅ | ❌ | ❌ | ❌ |
| users.delete | ✅ | ✅ | ❌ | ❌ | ❌ |
| users.block | ✅ | ✅ | ❌ | ❌ | ❌ |
| users.assign_permissions | ✅ | ✅ | ❌ | ❌ | ❌ |

#### Leaves

| Permission | PO | SA | AD | AC | EM |
|---|:---:|:---:|:---:|:---:|:---:|
| leaves.apply | ❌ | ✅ | ✅ | ✅ | ✅ |
| leaves.list_own | ❌ | ✅ | ✅ | ✅ | ✅ |
| leaves.list_all | ❌ | ✅ | ✅ | ✅ | ❌ |
| leaves.approve | ❌ | ✅ | ✅ | ❌ | ❌ |
| leaves.reject | ❌ | ✅ | ✅ | ❌ | ❌ |

#### Credit Management

| Permission | PO | SA | AD | AC | EM |
|---|:---:|:---:|:---:|:---:|:---:|
| credit.account_create | ❌ | ✅ | ✅ | ✅ | ❌ |
| credit.account_update | ❌ | ✅ | ✅ | ✅ | ❌ |
| credit.account_delete | ❌ | ✅ | ✅ | ❌ | ❌ |
| credit.txn_create | ❌ | ✅ | ✅ | ✅ | ✅ |
| credit.txn_approve | ❌ | ✅ | ✅ | ✅ | ❌ |
| credit.list | ❌ | ✅ | ✅ | ✅ | ❌ |

#### Machines / Nozzles

| Permission | PO | SA | AD | AC | EM |
|---|:---:|:---:|:---:|:---:|:---:|
| machines.crud | ❌ | ✅ | ✅ | ❌ | ❌ |
| nozzles.crud | ❌ | ✅ | ✅ | ❌ | ❌ |
| nozzles.read_list | ❌ | ✅ | ✅ | ✅ | ✅ |

#### Fuel & Pricing

| Permission | PO | SA | AD | AC | EM |
|---|:---:|:---:|:---:|:---:|:---:|
| fuel_type.crud | ❌ | ✅ | ❌ | ❌ | ❌ |
| fuel_price.update | ❌ | ✅ | ✅ | ❌ | ❌ |
| fuel_price.history.read | ❌ | ✅ | ✅ | ✅ | ❌ |
| fuel_purchase.create | ❌ | ✅ | ✅ | ✅ | ❌ |
| fuel_purchase.list | ❌ | ✅ | ✅ | ✅ | ❌ |

#### Sales / Readings

| Permission | PO | SA | AD | AC | EM |
|---|:---:|:---:|:---:|:---:|:---:|
| readings.create | ❌ | ✅ | ✅ | ✅ | ✅ |
| readings.list_own | ❌ | ✅ | ✅ | ✅ | ✅ |
| readings.list_all | ❌ | ✅ | ✅ | ✅ | ❌ |
| readings.lock_day | ❌ | ✅ | ✅ | ✅ | ❌ |

#### Salary

| Permission | PO | SA | AD | AC | EM |
|---|:---:|:---:|:---:|:---:|:---:|
| salary.structure.set | ❌ | ✅ | ✅ | ❌ | ❌ |
| salary.advance.grant | ❌ | ✅ | ✅ | ✅ | ❌ |
| salary.incentive.grant | ❌ | ✅ | ✅ | ❌ | ❌ |
| salary.payout.generate | ❌ | ✅ | ✅ | ✅ | ❌ |
| salary.payslip.read_own | ❌ | ✅ | ✅ | ✅ | ✅ |
| salary.payslip.read_all | ❌ | ✅ | ✅ | ✅ | ❌ |

#### Analytics

| Permission | PO | SA | AD | AC | EM |
|---|:---:|:---:|:---:|:---:|:---:|
| analytics.tenant_dashboard | ❌ | ✅ | ✅ | ✅ | ❌ |
| analytics.profit | ❌ | ✅ | ✅ | ❌ | ❌ |

#### Settings

| Permission | PO | SA | AD | AC | EM |
|---|:---:|:---:|:---:|:---:|:---:|
| settings.read | ❌ | ✅ | ✅ | ✅ | ✅ |
| settings.update | ❌ | ✅ | ✅ | ❌ | ❌ |
| settings.whatsapp | ❌ | ✅ | ❌ | ❌ | ❌ |

---

## Features

### 17 Pages / Routes

#### Management & Analytics

- **`/`** Dashboard
  - **Management view**: Today's sales, 7-day trend, fuel mix, cash variance
  - **Employee view**: Check-in status, pending duties, advance taken, month-end salary forecast
  - **Accountant view**: Credit account summary with outstanding balances

- **`/reports`** Analytics Dashboard
  - Revenue/profit/COGS trends (date-range presets)
  - Fuel mix breakdown (pie chart + table)
  - Top employees by lorry duties and incentives
  - Credit aging buckets
  - CSV export per section
  - Profit columns visible only to management

- **`/platform`** Platform Dashboard *(PLATFORM_OWNER only)*
  - Global stats: total pumps, active pumps, MRR, total users
  - Top pumps by 7-day revenue leaderboard
  - Pump list with search and status filters
  - Create, suspend, restore, delete pumps

- **`/platform/pump/:id`** Pump Detail *(PLATFORM_OWNER only)*
  - **Health tab**: Active/blocked users, 7-day metrics, outstanding credit, lifecycle actions
  - **Users tab**: Read-only roster with roles and block status
  - **Subscription tab**: Plan, fee, status, payment recording, payment history
  - **Settings tab**: Info panel explaining per-pump settings ownership

#### Operations

- **`/readings`** Daily Meter Readings
  - Nozzle-by-nozzle meter input
  - Cash/online/credit collections
  - Litres sold and expected cash calculation
  - Per-nozzle revenue/COGS/profit breakdown *(management only)*
  - Day-lock button *(management only)*
  - Unconfigured nozzles setup banner *(management only)*

- **`/fuel`** Fuel Management (3 tabs)
  - **Types**: CRUD for fuel types (name, code, unit)
  - **Pricing**: Current prices, price history, set new prices (auto-closes previous interval)
  - **Purchases**: Log inbound deliveries (quantity, rate, supplier, invoice)

- **`/machines`** Equipment Catalog (2 tabs)
  - **Machines**: CRUD for dispensers (name, code, display order, active flag)
  - **Nozzles**: CRUD for nozzles (linked to machine and fuel type)

- **`/credit`** Credit Management
  - Customer credit account list with search (name/phone)
  - Outstanding balance per account
  - Transaction history per account (fuel given on credit, payments received)
  - Add new credit account button *(management only)*

#### HR & Payroll

- **`/attendance`** Attendance & Check-In
  - **Employee view**: GPS-geofenced check-in/out, shift handover dialog with incoming employee selection, WhatsApp notification on handover
  - **Admin view**: Date-picker to view all employees' check-in/out times and status

- **`/leaves`** Leave Management
  - **Employee view**: Annual leave balance (casual/sick/earned split), submit new leave request (planned or emergency), own leave history
  - **Manager view**: All pending leaves, approve/reject with confirmation, WhatsApp notifications

- **`/lorry-duty`** Lorry Duty Scheduling
  - **Manager view**: Assign duties (date, notes), WhatsApp notification on assignment
  - **Employee view**: Own duties, status workflow (SCHEDULED → ACCEPTED → DEPARTED → ARRIVED → COMPLETED, or REFUSED), complete duty to increment tally

- **`/employees`** Staff Directory
  - Employee list with search
  - View: name, email, role, salary, blocked status
  - Create, edit, block/unblock, soft-delete *(SUPER_ADMIN only)*

- **`/payslip`** Payslip Management
  - Employees see: own payslips only
  - Management see: all employees' payslips
  - Filter by month/year
  - View detail: basic salary, incentives, lorry allowance, overtime, deductions, net salary
  - Print/download button
  - Generate all payslips button *(management only)* with WhatsApp delivery

- **`/advances`** Salary Advances
  - Summary: employee, base salary, advances drawn, incentives earned, projected payable *(management/accountant only)*
  - Grant new advance (warns if negative payable)
  - Drill into employee's advance line items (pending, cancelled)
  - Cancel pending advances via RPC

- **`/incentives`** Staff Incentives
  - Award monetary incentives (OIL_SALES, LUBRICANT_SALES, LORRY_DUTY, FESTIVAL_BONUS, PERFORMANCE, CUSTOM)
  - Mark as paid
  - Month total and unpaid summary
  - Employees see: own incentives only *(read-only)*
  - Management see: all incentives, award and mark-paid actions

- **`/settings`** Pump Configuration (7 tabs)
  - **General**: Pump name, address, GST ID
  - **Geofence**: Lat/lng/radius for attendance validation
  - **Shifts**: Morning, evening, night start-end times
  - **Salary**: Payslip day, deduction method, late grace period
  - **Leaves**: Annual quotas (casual, sick, earned)
  - **WhatsApp**: API token, phone ID, notification toggles
  - **Fuel Rates**: Legacy MS/HSD/XP rates

---

## Project Structure

```
fueldesk-v2/
├── src/
│   ├── api/                  # Supabase client and API calls
│   ├── components/
│   │   ├── layout/           # Header, Sidebar, main layout
│   │   └── ui/               # Reusable UI components (Badge, Spinner, etc.)
│   ├── hooks/                # Custom hooks (useRoleAccess, etc.)
│   ├── pages/                # 17 feature pages
│   ├── services/             # Business logic (permissions, attendance, audit, etc.)
│   ├── stores/               # Zustand stores (useAuthStore, etc.)
│   ├── types/                # TypeScript type definitions
│   ├── App.tsx               # Main app with router
│   └── main.tsx              # Vite entry point
├── database/
│   ├── migrations/           # SQL migrations (6 versions)
│   └── patches/              # One-off SQL patches
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
└── tailwind.config.ts
```

---

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn
- Supabase project (PostgreSQL + Auth)

### Installation

1. **Clone the repository**
   ```bash
   git clone <repo-url>
   cd fueldesk-v2
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   
   Create a `.env.local` file in the project root:
   ```env
   VITE_SUPABASE_URL=https://<project-id>.supabase.co
   VITE_SUPABASE_ANON_KEY=<your-anon-key>
   ```

4. **Set up the database**
   
   Run migrations in order:
   ```bash
   # Run via Supabase SQL editor or CLI
   # Migrations in: database/migrations/
   001_initial.sql
   002_rbac_and_business.sql
   003_platform_owner.sql
   004_sales_analytics.sql
   005_analytics_reports.sql
   ```

5. **Start the development server**
   ```bash
   npm run dev
   ```

   The app will be available at `http://localhost:5173`

### Build for Production

```bash
npm run build
npm run preview
```

---

## Key Architectural Patterns

### State Management

- **Zustand stores** for persistent auth state (`useAuthStore`)
- **React Query** for server state (data fetching, caching, mutations)
- **localStorage** for session persistence

### Permission Caching

1. Permissions loaded from `role_permissions` table on login
2. Cached in memory as `Map<Role, Set<string>>`
3. Per-user overrides applied at check time
4. Cache reset on login/logout

### Responsive Design

- Tailwind CSS for utility-first styling
- Framer Motion for smooth animations
- Lucide React for consistent iconography
- Mobile-friendly layout with collapsible sidebar

### Internationalization

- i18next for English and Hindi support
- Language toggle in header
- Key namespacing for maintainability

---

## Development Tips

- **Check role access**: Use `useRoleAccess()` hook or `<Can>` component to guard features
- **Add permissions**: Update `role_permissions` in migrations, then use in `useRoleAccess().can()`
- **WhatsApp notifications**: Configured via settings tab; check `src/services/notifications.ts`
- **Query data**: Use `useQuery` from React Query; all endpoints in `src/api/`
- **Forms**: React Hook Form + Zod for validation; see any page for patterns

---

## Support & Feedback

For issues, questions, or feature requests, please open an issue on the repository.

---

**Made with ❤️ for petrol pump operators worldwide.**
