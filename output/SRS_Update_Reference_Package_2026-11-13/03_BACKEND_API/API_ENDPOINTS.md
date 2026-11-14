# API endpoint inventory (from `server/hosted.js`)

All endpoints below are served by the Express backend. Protected endpoints require a valid Supabase Auth bearer token unless noted. Manager endpoints allow Admin where the backend's manager guard permits it; Admin endpoints require Admin.

## Health and authentication
- `GET /api/health` - API/database health.
- `POST /api/auth/register` - public registration; Student role by default.
- `POST /api/auth/resend-confirmation` - resend email verification.
- `POST /api/auth/login`, `POST /api/auth/refresh`, `POST /api/auth/logout`, `GET /api/auth/me`.

## Profile, student directory and social features
- `PATCH /api/profile`, `PUT /api/profile/avatar`.
- `GET /api/users`, `GET /api/friends`, `GET /api/friends/requests`.
- `POST /api/friends/requests`, `POST /api/friends/requests/:id/:decision`.
- `GET /api/messages/threads`, `GET /api/messages/:userId`, `POST /api/messages`.
- WebSocket endpoint: `/api/ws` for authenticated friend chat updates.

## Learning features
- `GET /api/materials`, `GET /api/assignments`, `POST /api/assignments/:id/submit`.
- `GET /api/quizzes`, `POST /api/quizzes/:id/attempt`.
- `GET /api/study/notifications`.

## Manager features
- `GET /api/manager/overview`, `/api/manager/materials`, `/api/manager/assignments`, `/api/manager/quizzes`, `/api/manager/progress`.
- `POST /api/manager/materials`, `/api/manager/assignments`, `/api/manager/quizzes`, `/api/manager/notifications`.

## Admin features
- `GET /api/admin/presence`, `/api/admin/overview`, `/api/admin/users`, `/api/admin/activity`, `/api/admin/settings`.
- `PATCH /api/admin/users/:userId/role` - Student/Manager role change; Admin creation remains owner-controlled.
- `POST /api/admin/users/:userId/message` - targeted in-app notice.
- `PUT /api/admin/settings`.

Refer to the backend source for exact request/response shapes, access checks, validation, audit events, and error handling.
