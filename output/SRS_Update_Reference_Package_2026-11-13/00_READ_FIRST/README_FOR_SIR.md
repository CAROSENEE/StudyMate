# StudyMate SRS Update Reference Package

**Purpose:** Source-code and project-reference files to support revision of the StudyMate Software Requirements Specification (SRS).

## Project stack confirmed from source
- Frontend: HTML, CSS and JavaScript (no React source folder in this project)
- Backend: Node.js and Express
- Authentication: Supabase Auth
- Hosted database: Supabase PostgreSQL
- Local demonstration mode: SQLite
- Android wrapper: Capacitor / Android Java
- Hosting: Render; source control: GitHub

## Suggested SRS update order
1. Read the existing project proposal and this overview.
2. Review the database migrations and ER diagram for entities, keys, and relationships.
3. Review backend endpoint notes and backend source for role permissions and validation.
4. Review frontend files for screens and user workflows.
5. Review deployment/environment examples and Android integration.
6. Update the SRS requirements, use cases, data model, interfaces, constraints, and limitations to match the implemented source.

## Roles
- **Student:** signs up, views study content, submits assignments, takes quizzes, plans study, checks progress, finds classmates, and messages accepted friends.
- **Manager:** manages course materials, assignments, quizzes, announcements, and reviews student progress.
- **Admin:** reviews accounts and activity, manages settings, views recent connection presence, sends targeted notices, and can change Student/Manager roles.

Public sign-up creates Student accounts only. The first Admin is assigned by the project owner; Admin can promote a verified Student to Manager.

## Important scope and limitations
- The built-in Study Assistant in the current app uses built-in guidance, not a live AI service.
- The live presence panel reports recent connections and broad app sections, not a full click history.
- Some planner/progress features and offline role previews use sample/local data.
- Friend discovery is limited to users with the same institution name.
- `www/` is the Capacitor-synchronized copy of the frontend; root frontend files are the editable source of truth.

## Safe handling
This package intentionally excludes `node_modules`, vendor/build folders, local SQLite data, APK binaries, and any private `.env` file. `.env.example` is included for configuration reference only; its local sample demo credentials are not online credentials. Do not copy database passwords, Supabase private/service-role keys, or real student data into the SRS.

## Source and deployed app
- GitHub: https://github.com/CAROSENEE/StudyMate
- Hosted app/API: https://studymate-api-63in.onrender.com/
- Supabase project reference: `vzwrzrfevzawyppzfbat`

The database migrations in this package are ordered by their timestamped filenames. Confirm the applied migration status in Supabase before describing a feature as active in the hosted database.
