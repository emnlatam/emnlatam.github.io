# EMN — Escuela de Música y Negocios

Jekyll static site on GitHub Pages, served at **https://emnlatam.github.io** (home page lives at `/emn/`). Repo: `emnlatam/emnlatam.github.io`.

## History

This repo was split off from a combined AMBRA+EMN repo (`zareenterprises.github.io`) on 2026-09-29/30, using `git filter-repo` to preserve the real commit history of every EMN-only file (59 commits). AMBRA now lives entirely separately in the original repo, under a different GitHub account. Never mix the two projects' files, Supabase projects, or credentials again.

**Repo naming matters**: this repo must stay named exactly `emnlatam.github.io` (matching the `emnlatam` account name exactly) — that's the only way GitHub Pages serves it at the domain root instead of under a `/reponame/` subpath. Learned this the hard way during the migration.

## Push workflow

The user pushes via **GitHub Desktop**, signed in as the `emnlatam` GitHub account (a different account than the one used for AMBRA — GitHub Desktop only supports one GitHub.com account at a time, so switching projects usually means switching signed-in accounts too). The user writes their own commit messages — don't run `git commit` on their behalf; only stage changes for review. `git push` from a sandboxed/agent shell tends to fail here — expect to hand off pushes to the user.

## Supabase

Own, separate Supabase project — never reuse AMBRA's credentials:
- URL: `https://gpoddvcrsdkpgfmyniqu.supabase.co`
- Anon key: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdwb2RkdmNyc2RrcGdmbXluaXF1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk0Nzc3MzksImV4cCI6MjEwNTA1MzczOX0.N9XvN4xdln5GFlTcpv3nE3iThH7Jfoym23HPp97_fxc`

**RLS gotcha**: Supabase now auto-enables Row Level Security on newly created tables by default. This app's convention is RLS **disabled** (frontend-only permission checks, matching everything else here) — after creating any new table, always run `alter table public.<name> disable row level security;` or writes will silently fail with a 42501 error that looks like a client bug but isn't.

Key tables: `students` (id/email/full_name/role/status/avatar_url — role is `admin`/`professor`/`student`), `practice_activity`, `career_progress` (one JSONB `data` row per student_id), `interview_prep_prelim_answers`, `interview_prep_final_answers`.

Edge Functions (deploy with `supabase functions deploy <name> --project-ref gpoddvcrsdkpgfmyniqu`):
- `invite-student` — admin-only, creates a Supabase Auth account + `students` row, sends a real invite email. `redirectTo` must exactly match an entry in this project's Authentication → URL Configuration → Redirect URLs allow-list.
- `emn-interview-summarize` — calls Google Gemini (`GEMINI_API_KEY` secret) to generate AI conclusions/drafts for the Interview Prep tool.

## Site conventions

- Permalinks are root-level with **no trailing slash** (e.g. `/practice-lab`, `/career`, `/usuarios`, `/career-progress`), except the home page which is `/emn/` (trailing slash, historical).
- Static assets use cache-busting: `?v={{ site.time | date: '%s' }}`.
- `assets/js/emn-auth.js` is the shared client — every page loads it after the Supabase JS CDN script. It exposes `emnSession` / `emnStudentProfile` (both null when signed out — sign-in is optional almost everywhere) after `emnInit()` resolves, and injects nav dropdowns by hand (not via each page's own HTML): "Mi Aula" (any signed-in person: Calendario, Career Progress) and "Administrar" (admin/professor only: Usuarios, Actividad, Calendario de clases), plus the account/login link. When signed in it also splits the Practice Lab dropdown's "Interview Prep" into Practice (`/interview-prep`) and Questions (`/clases-interview-prep`). The static part of the header (logo → home, no "Inicio" tab; Practice Lab dropdown) lives once in `_includes/emn-header.html`, included by every layout with a header. It also owns a self-contained in-page modal system (`emnConfirm()`, `emnOpenAccountModal()` for name/photo/password) injected via JS so no page needs its own modal CSS/HTML.
- **Forgot password** lives on `/emn-login` ("¿Olvidaste tu contraseña?"): `resetPasswordForEmail` with `redirectTo` = `https://emnlatam.github.io/emn-login` (must stay in Supabase's Redirect URLs allow-list, same as the invite). Supabase only emails addresses that already have an account, and the form answers identically either way so it never reveals who is enrolled. There is no self-signup.
- **All popups are in-page modals**, never the browser's native `alert()` / `confirm()` / `prompt()`: use `emnAlert()` / `emnConfirm()` from `emn-auth.js` (the user asked for this explicitly). The one unavoidable exception is the browser's own prompt when closing/reloading a tab with unsaved changes (`beforeunload`), which browsers don't let pages restyle.
- Sign-in is optional on most tool pages (Sight Melody, Interview Prep practice tool) — they work the same signed in or out, just don't log practice time when signed out.

## Notable features

- **Sight Melody Live Mode** (`_layouts/emn/sight-melody.html`): two-way real-time sync between a professor and a student over Supabase Realtime Broadcast (no DB table, ephemeral channel keyed by a short join code). Uses a seeded PRNG (`rngFn`, swappable, seeded via `mulberry32`) so both sides render the *exact* same generated exercise from a tiny `{state, seed}` payload instead of syncing the whole generated note data. Dictation Mode is the one deliberate exception that stays local to each person (never touches shared `state`).
- **Career Progress** (`/career-progress`): a multi-category tracker (songs, social content, TV, press, press kit, portfolio, contests, volunteering) with per-row "stage" progress tracks, CSV/Excel export, and Supabase persistence per student. Admin/professor get a student dropdown (or `?student=<id>`) to open and edit any student's tracker.
- **Cursos** (`/cursos`, editor at `/cursos-editor`): paid video courses with their own dashboard (no site header) and a LearnWorlds-style viewer. Tables `courses`, `course_lessons` (public outline; `kind` video/quiz, `is_free`), `lesson_videos` (the protected content: `video_url` or `quiz` JSON), `course_access`, `lesson_progress`. **These are the one exception to the RLS-disabled convention** — RLS is what keeps unpaid people from reading lesson content; schema and policies are in `supabase/sql/cursos.sql`. Access is granted by a `course_access` row; "Desbloquear" opens `courses.payment_url` (Stripe Payment Link). Staff can preview as a non-buyer with `?as=visitante`.
- **Clases Interview Prep** (`/clases-interview-prep`): fixed set of real English audition questions, each unlocked by Spanish "preguntas previas" tagged into one of 7 thematic "gemas" (Capacidad, Motor, Origen, Progreso, Identidad, Vision, Comunidad), with AI-assisted conclusions/drafts. Admin/professor can view and edit a specific student's answers via `?student=<id>` (from a "Ver Interview Prep" link on `/usuarios`), gated by role check.
