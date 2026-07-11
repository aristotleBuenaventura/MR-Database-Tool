# MR Database Tool

React + Node.js + MySQL starter for managing database records.

## Stack

| Layer | Tech |
| --- | --- |
| Frontend | React, Vite, React Router |
| Backend | Node.js, Express, JWT |
| Database | MySQL + Prisma |

## Project structure

```text
MR-Database-Tool/
├── frontend/          # React app (port 5173)
├── backend/           # Express API (port 4000)
└── package.json       # Convenience scripts
```

## Prerequisites

- Node.js 20+
- MySQL running locally (or remote)

## Setup

### 1. Install dependencies

```bash
npm run install:all
```

### 2. Configure MySQL

Create a database:

```sql
CREATE DATABASE mr_database_tool;
```

Copy env values and update credentials:

```bash
cp backend/.env.example backend/.env
```

### 3. Generate Prisma client + migrate

```bash
npm run db:generate
npm run db:migrate
```

When prompted for a migration name, use something like `init`.

### 4. Run the apps

Both at once:

```bash
npm run dev
```

Or separately:

```bash
npm run dev:backend
npm run dev:frontend
```

- Frontend: http://localhost:5173
- API health: http://localhost:4000/api/health

## Auth endpoints

- `POST /api/auth/login` — `{ email, password }` → JWT
- `GET /api/auth/me` — requires `Authorization: Bearer <token>`

## Roles

| Role | Access |
| --- | --- |
| `viewer` | Read-only (view records later). No create/edit/delete/import/export. |
| `admin` | Full access, including Excel import/export. |

### Seed accounts

```bash
npm run db:seed --prefix backend
```

| Role | Email | Password |
| --- | --- | --- |
| Admin | `admin@mrtool.local` | `Admin123!` |
| Viewer | `viewer@mrtool.local` | `Viewer123!` |

## Deploy

See the full DigitalOcean Droplet guide (Nginx, PM2, MySQL, Certbot, Cloudflare):

- [docs/DEPLOY-DROPLET.md](docs/DEPLOY-DROPLET.md)
- Word document (app guideline + deploy): [docs/MR-Database-Tool-Guidelines.docx](docs/MR-Database-Tool-Guidelines.docx)

## Notes

- Vite proxies `/api` to the backend during development.
- Update `JWT_SECRET` before deploying.
