# Smart StudyMate

Smart StudyMate is a mobile-first study assistant for student planning, course materials, coursework, quizzes, peer communication, and academic progress. It has a responsive web app, a Node.js API, Supabase Auth and PostgreSQL, and an Android APK built with Capacitor.

## Current project status

The hosted backend and database are configured. The code is in GitHub, Render hosts the API, and Supabase provides authentication and PostgreSQL storage. The initial database schema and live-presence migration have been applied to the linked production Supabase project.

- **GitHub repository:** [CAROSENEE/StudyMate](https://github.com/CAROSENEE/StudyMate)
- **StudyMate web app and API:** <https://studymate-api-63in.onrender.com/>
- **API health endpoint:** <https://studymate-api-63in.onrender.com/api/health>
- **Supabase project reference:** `vzwrzrfevzawyppzfbat`
- **Android APK:** `StudyMate.apk` in the project root (generated locally; excluded from GitHub)

The Render free service may sleep when idle. Its first request after sleeping can take longer while the service wakes.

## Technology and architecture

- **Frontend:** HTML, CSS, and JavaScript; mobile-first responsive layout and PWA support
- **Backend:** Node.js and Express REST API; WebSocket connection for friend messaging
- **Authentication:** Supabase Auth, including email confirmation
- **Database:** Supabase PostgreSQL
- **Hosting:** Render web service
- **Source control:** GitHub
- **Android packaging:** Capacitor and Gradle
- **Local demo mode:** SQLite when Supabase environment variables are not configured

Neon is not used in the current architecture. Never commit `.env` files, database passwords, Supabase private/service-role keys, or other credentials. The frontend and APK use only the public Supabase URL and publishable key where applicable; the database connection string remains in the backend environment.

## Completed features

### Students

- Register with name, email, department, batch, and password
- Confirm email and sign in
- View study materials, assignments, quizzes, and announcements
- Submit assignment responses and quiz attempts
- Send and respond to friend requests
- Message accepted friends
- Use study-planning, routine, focus, and progress screens

### Managers

- Publish course materials, assignments, quizzes, and announcements
- View student coursework and progress summaries

### Administrators

- Review student accounts, registrations, and system activity
- View dashboard statistics and account reports
- Manage system settings
- View connected students and managers in the live-presence panel

### Account and messaging behavior

- New public registrations receive the `student` role by default.
- Email confirmation redirects to the hosted StudyMate URL. Users who do not receive an email can request a new confirmation email from the login page.
- Messages are available only between accepted friends. The API uses authenticated user sessions and checks friend relationships before returning or sending messages.
- Admin activity records event types and message counts; it does not include private message text.

## Live user presence

The Admin dashboard displays students and managers whose app sent a heartbeat within the last 90 seconds. The app sends a heartbeat every 30 seconds; the Admin dashboard refreshes the list every 15 seconds. It displays the user's name, role, broad app section, and recent heartbeat time.

Presence indicates that an app session recently connected. It does not prove that a person is looking at or interacting with the app at that exact moment. Presence stores only account ID, a session ID, a coarse section label, and heartbeat time. It does not record private message contents, typed input, IP addresses, or device details. Admin access is required to view the list.

The feature is implemented by migration `supabase/migrations/202611110002_live_presence.sql`, which adds the `public.user_presence` table with Row Level Security enabled and no client-facing policies. The Express API writes presence and returns the live list only to Admin users.

## Supabase setup

The Supabase project is linked to this repository through the Supabase CLI. Database migrations are stored under `supabase/migrations/`:

- `202611110001_initial_schema.sql` creates profiles, friendship and messaging tables, coursework tables, settings, and audit logs.
- `202611110002_live_presence.sql` adds the short-lived app-presence table.

Both migrations have been applied to the linked production project. To apply future migrations from the project folder:

```powershell
npx supabase login
npx supabase link --project-ref vzwrzrfevzawyppzfbat
npx supabase db push --remote
```

If the CLI is already logged in and the project is linked, the last command is sufficient. The `--remote` flag applies migrations to the linked Supabase project rather than trying to connect to a local Docker database.

### Authentication URL settings

Supabase **Authentication > URL Configuration** is configured for the hosted app:

- **Site URL:** `https://studymate-api-63in.onrender.com`
- **Redirect URL allowlist:** includes `https://studymate-api-63in.onrender.com`

The backend uses `AUTH_REDIRECT_URL` for signup confirmation and resend-confirmation links. Confirmation links can expire; request a new email from the app if an older link no longer works.

### Roles

Public registration can only create Student accounts. To grant the first Admin or Manager role, first register and verify the account, then run the appropriate statement in the Supabase SQL Editor as the project owner. Replace the example email with the verified account email:

```sql
update public.profiles set role = 'admin' where email = 'your-admin-email@example.com';
update public.profiles set role = 'manager' where email = 'your-manager-email@example.com';
```

There is no public API for promoting roles. Keep the number of Admin accounts limited to trusted project operators.

## Render deployment

The Render Blueprint is defined in `render.yaml`. It creates the `studymate-api` Node.js web service, runs `npm ci` and `npm start`, and uses `/api/health` as the health check. Render is connected to the GitHub repository and deploys changes from the `main` branch.

The Render environment contains these settings:

- `NODE_ENV=production`
- `SUPABASE_URL` - Supabase project URL
- `SUPABASE_PUBLISHABLE_KEY` - Supabase public publishable key
- `DATABASE_URL` - PostgreSQL connection string, including the private database password
- `AUTH_REDIRECT_URL=https://studymate-api-63in.onrender.com`

Keep the value of `DATABASE_URL` private. If its password contains URL-reserved characters such as `#`, percent-encode those characters in the connection string. Do not put this connection string in source files or share it publicly.

The health endpoint should report `ok: true` and `database: connected` when the hosted API is running. A free Render instance can sleep while idle, so the first request may be delayed.

## GitHub workflow for future changes

From PowerShell in the project folder, commit and push code changes to `main`:

```powershell
cd D:\CAROSINE\StudyMate
git add .
git commit -m "Describe the change"
git push origin main
```

Render deploys the new version from GitHub. Before using `git add .`, review `git status` and make sure `.env`, database files, passwords, and other private data are not included. The repository `.gitignore` excludes `.env`, SQLite data, build caches, and APK files.

When a code change adds or modifies a database migration, push the migration to Supabase with `npx supabase db push --remote` before relying on it in the deployed API.

## Run locally

Requirements: Node.js 24 or later.

```powershell
npm install
npm start
```

Open <http://localhost:3000>. Without the Supabase environment variables, the server runs its SQLite demo mode and stores data in `data/studymate.sqlite`. Local demo accounts are configured through `.env.example`; use them only for local development. Offline role previews use sample data and do not sync with the hosted database.

For local hosted-mode development, create a private `.env` file with `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and `DATABASE_URL`. Never commit that file.

## Android APK

Build the current debug APK from the project folder:

```powershell
npm run android:apk
```

The script syncs the frontend into the Capacitor Android project, builds the APK, and writes `StudyMate.apk` in the project root. The current APK defaults to the hosted StudyMate HTTPS API. You can change the API address from the app's **Server** setting. A phone's `localhost` means the phone itself, not your computer.

After changing the frontend or API address, rebuild the APK and install the new file. A debug APK is suitable for project demonstration and testing; it is not a Play Store release build.

## Important limitations

- Some planning screens and offline role previews still use sample data rather than database-backed records.
- Live presence reports a recent app connection and broad screen section, not a complete click-by-click history.
- Free hosting and database plans have usage, sleep, and availability limits. This setup is intended for academic demonstration and development, not production-scale use.
