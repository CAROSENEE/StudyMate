# Database model notes

The SQL migrations are the authoritative schema source. The main tables are:

- `profiles`: Supabase Auth-linked user profile, role (`student`, `manager`, `admin`), institution, department, batch, avatar and friend-request preference.
- `friend_requests`, `friendships`, `messages`: request lifecycle, accepted relationships, and private direct messages.
- `course_materials`, `assignments`, `assignment_submissions`: teaching resources and student coursework.
- `quizzes`, `quiz_attempts`: quiz definitions, attempts and scores.
- `study_notifications`: manager announcements and targeted admin notices.
- `audit_logs`: account and administrative activity events.
- `study_settings`: application-level settings.
- `user_presence`: short-lived user/session/screen heartbeat for Admin's recent-connection panel.

The backend uses a trusted PostgreSQL connection. Row Level Security is enabled on application tables; the SQL migrations do not define public client policies for direct access. Read each migration for exact columns, constraints, foreign keys, indexes and grants.
