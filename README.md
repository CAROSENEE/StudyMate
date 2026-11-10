# Smart StudyMate

Smart StudyMate is a mobile-first student assistant for study planning, course activities, peer communication, and academic progress. The project includes a responsive web frontend and an Android app built with Capacitor.

## Project status

The current codebase has a Node.js and Express API, WebSocket messaging, and a local SQLite database with custom authentication. The API has not yet been deployed to a public server.

The planned hosted architecture is:

- **GitHub** for source-code version control
- **Supabase Auth** for registration, sign-in, and user sessions
- **Supabase PostgreSQL** for application data
- **Render** (or another Node.js host) for the Express API and WebSocket service
- **Capacitor** for packaging the frontend as an Android APK

The Supabase and Render setup is a migration plan, not yet configured in this repository. Until that work is completed, follow the local SQLite instructions below. Neon is not part of the selected plan.

A first PostgreSQL schema draft is available at supabase/migrations/202611110001_initial_schema.sql. It has not been applied to a Supabase project yet, and the running API still uses SQLite and custom authentication.

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
- View dashboard statistics and reports
- Manage available system settings
- Access course-management screens where permitted

Some study-planning screens and the offline role preview use sample data. Offline preview changes are not synchronized with the backend.

## Run locally (current SQLite version)

Requirements: Node.js 24 or later.

```powershell
npm install
npm start
```

Open `http://localhost:3000`. The local database is created at `data/studymate.sqlite`. The development server seeds demo Admin and Manager accounts on first start. For local credentials, see `.env.example` and keep demo passwords for development only.

To customize local server settings, copy `.env.example` to `.env` and edit the values. Never commit `.env`, database files, service keys, or passwords to GitHub.

## Android APK

Build the Android debug APK from the project folder:

```powershell
npm run android:apk
```

The build script synchronizes the latest frontend files and creates `StudyMate.apk` in the project folder. To use online accounts and shared data on a phone, the API must be deployed to a public HTTPS URL and that URL must be entered in the app's **Server** setting. The phone's `localhost` address refers to the phone itself, not your computer.

## Planned Supabase migration

Before hosting the application, the migration work will need to:

1. Replace custom registration, password, and session handling with Supabase Auth.
2. Verify Supabase access tokens in the Express API.
3. Migrate the SQLite schema and queries to Supabase PostgreSQL.
4. Store profile and application roles in protected database records; new sign-ups must receive the Student role by default.
5. Keep backend secrets in the hosting provider's environment settings, never in the APK or frontend.
6. Deploy the Express API and WebSocket service, then configure the APK to use its HTTPS URL.

## Repository safety

The `.gitignore` excludes `.env`, local database data, build caches, and APK files. Review `git status` before pushing and confirm that no credentials or private data are staged.

## Current limitations

- No public API URL or hosted database is configured yet.
- Multi-device login, friend requests, messaging, and database-backed coursework require the API server to be available.
- Free hosting services may sleep, pause, or enforce usage limits. The project is currently intended for development and academic demonstration, not production use.

