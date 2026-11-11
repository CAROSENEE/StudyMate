# Smart StudyMate

Smart StudyMate is a mobile-first student assistant for study planning, course activities, peer communication, and academic progress. The project includes a responsive web frontend and an Android app built with Capacitor.

## Project status

The codebase has a Node.js and Express API with WebSocket messaging. It supports a local SQLite demo mode and a hosted mode that uses Supabase Auth and PostgreSQL. The Supabase hosted API is deployed on Render and uses Supabase Auth and PostgreSQL. The initial schema is applied; new migrations must be pushed to the linked Supabase project before deploying code that depends on them.

The hosted architecture is:

- **GitHub** for source-code version control
- **Supabase Auth** for registration, sign-in, and user sessions
- **Supabase PostgreSQL** for application data
- **Render** (or another Node.js host) for the Express API and WebSocket service
- **Capacitor** for packaging the frontend as an Android APK

Neon is not part of the selected plan. Keep Supabase database credentials in local `.env` or the hosting provider's environment settings; do not put them in the APK, frontend, or GitHub.

The initial PostgreSQL schema is tracked at `supabase/migrations/202611110001_initial_schema.sql` and has been applied to the Smart StudyMate Supabase project. `server/index.js` selects hosted mode when `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and `DATABASE_URL` are all configured; otherwise development uses the local SQLite demo API. Production refuses to start without the hosted configuration.

## User roles and features

### Student

- Register and sign in
- View course materials, assignments, quizzes, and announcements
- Submit assignment responses and take quizzes
- Use study-planning, routine, focus, and progress screens
- Find other students, send or accept friend requests, and message friends

### Manager

- Publish course materials, assignments, quizzes, and announcements
- View student progress summaries and coursework activity

### Admin

- Review registered student accounts and system activity
- See which students and managers have the app open, their current broad app section, and their last heartbeat (updates every 15 seconds)
- View dashboard statistics and reports
- Manage available system settings
- Access course-management screens where permitted

Some study-planning screens and the offline role preview use sample data. Offline preview changes are not synchronized with the backend.

## Run locally (SQLite demo mode)

Requirements: Node.js 24 or later.

```powershell
npm install
npm start
```

Open `http://localhost:3000`. The local database is created at `data/studymate.sqlite`. The development server seeds demo Admin and Manager accounts on first start. For local credentials, see `.env.example` and keep demo passwords for development only.

To customize local server settings, copy `.env.example` to `.env` and edit the values. Never commit `.env`, database files, service keys, or passwords to GitHub.

## Supabase hosted mode

Set `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and `DATABASE_URL` in a private `.env` file for local hosted-mode development, or in the API host's environment settings for deployment. `DATABASE_URL` is the PostgreSQL connection string from the Supabase project; keep its password private. Set `CORS_ORIGINS` to the exact web origins when the frontend and API are hosted separately. A public signup always creates a Student profile.

To grant the first Admin or Manager role, first create and verify that account through StudyMate, then promote the matching profile in the Supabase SQL Editor as the project owner:

```sql
update public.profiles set role = 'admin' where email = 'your-admin-email@example.com';
update public.profiles set role = 'manager' where email = 'your-manager-email@example.com';
```

Change the example addresses to the verified account emails. There is no public endpoint for promoting roles.

## Admin live presence

The admin dashboard shows students and managers connected within the last 90 seconds. The app sends a heartbeat every 30 seconds and the dashboard refreshes every 15 seconds. This indicates a recent app connection, not a person's exact actions or attention. It stores only account ID, an app section label, session ID, and heartbeat time; private message text, typed content, IP address, and device details are not tracked. Presence is available in hosted Supabase mode after applying `supabase/migrations/202611110002_live_presence.sql`.

Apply pending Supabase migrations from the project folder after linking the CLI to the correct project:

```powershell
npx supabase db push
```

## Android APK

Build the Android debug APK from the project folder:

```powershell
npm run android:apk
```

The build script synchronizes the latest frontend files and creates `StudyMate.apk` in the project folder. The APK defaults to the deployed StudyMate HTTPS API. You can change the URL in the app's **Server** setting if you use another server. The phone's `localhost` address refers to the phone itself, not your computer.

## Next deployment step

To deploy the hosted API:

1. Add the Supabase URL, publishable key, and PostgreSQL connection string to the API host's private environment settings.
2. Deploy this Node.js service with `npm start` and verify `/api/health` reports `database: connected`.
3. Set the app's **Server** address to the deployed HTTPS URL, then rebuild the APK if needed.

## Repository safety

The `.gitignore` excludes `.env`, local database data, build caches, and APK files. Review `git status` before pushing and confirm that no credentials or private data are staged.

## Current limitations

- Multi-device login, friend requests, messaging, live presence, and database-backed coursework require the API server and current database migrations to be available.
- Free hosting services may sleep, pause, or enforce usage limits. The project is currently intended for development and academic demonstration, not production use.

