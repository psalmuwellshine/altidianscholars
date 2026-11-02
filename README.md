# Altidian

Study library, quizzes, leaderboard, events and student profiles for NDU students, with a
full admin control panel.

- Students: `/`  (Home, Library, Quizzes, Ranks, Events, Profile)
- You (admin): `/admin`

## What the admin panel controls
- **Overview**: totals, 14-day activity chart, most attempted quizzes, newest students.
- **Academics**: faculties, departments or programmes (each with its highest level, 100 to 600) and courses (code, title, level, which departments take it, or all departments).
- **Students**: search by name or matric number, filter by department and level, view scores, edit matric/department/level, remove a profile picture, set a new password, disable or enable, clear scores, delete, CSV downloads.
- **Materials**: add, edit, pin, hide, delete. Notes, past questions, slides, videos, links, files (12 MB).
- **Quizzes**: build or edit, hide as draft, paste many questions at once, see attempts and average score.
- **Events**: add, edit, delete. Shown on the home page and the Events page.
- **Announcement**: banner at the top of every page (info, important, good news).
- **Leaderboard**: clear one entry or reset the season.
- **Student uploads**: approve or reject notes and past questions shared by students (class reps can do this for their own class too).
- **Timetable and exams**: class times, exams and tests for any department and level. Exams get a countdown and automatic reminders.
- **Students > Make rep**: appoint a class rep for one department and level.
- **Announcement**: the banner, plus a form to send a notification to every phone, or to one department and level.
- **Chat**: watch every room, delete messages, review reported messages, mute a student (also from the Students list), post as admin, clear a room, and make extra rooms (for example an admin-only Announcements room).
- **Site settings**: site name, tagline, motto, hero text, footer, open or close registration, require login for quizzes, turn the leaderboard on or off, WhatsApp / Telegram / Instagram / email links.

Environment variables: `ADMIN_PASSWORD` (required), `MONGODB_URI` (for permanent storage on free hosting), `SESSION_SECRET` (optional, a long random text; Render generates it).

No build step. The server uses only Node's built-in modules. The `mongodb` package is
loaded only when you connect a database.

## Chat rooms

Every student gets a **General** room, a room for their **department**, and a room for their **class** (department + level). Students only see rooms that belong to them, and the server enforces it. Messages appear live (Server-Sent Events, no extra service needed), with a 20-second fallback if live updates are blocked. Each room keeps its last 300 messages; messages are 600 characters at most, with a 1-per-second rate limit and duplicate-message blocking. Students can delete their own messages and report others. Chat can be switched off in **Site settings**. Students need their department and level set in their profile to see their department and class rooms.

## Notifications, offline reading, timetable, uploads and class reps

**Notifications.** Students turn them on in their profile. Phones then get alerts for new materials and quizzes, events, announcements, class updates and exam reminders (1 week, 1 day and the morning of). Each student chooses which kinds they want. The site makes its own push keys the first time it runs and keeps them in the database, so there is nothing to set up. To keep your own keys, set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and optionally `VAPID_SUBJECT` (like `mailto:you@example.com`) on Render. On iPhone the student must first use Share > Add to Home Screen and open Altidian from there. Exam reminders go out while the server is awake; on Render's free plan a sleeping site wakes when a student opens it, so use an uptime pinger if you want them on time.

**Offline reading.** Every free note or file has a "Save offline" button. Saved items open with no internet, and the site itself opens from its last saved copy. Paid files are view-only and are never saved.

**Timetable and exams.** Admins and class reps post classes, exams and tests. Students see a countdown on the home page and a weekly timetable under Events > Timetable and exams, and can add private entries of their own.

**Student uploads.** Any student can share notes or a file (PDF, Word, PowerPoint or picture, up to 8 MB) from the Library. A class rep for that course or an admin approves it. Approved uploads appear with "Shared by <name>", earn points (set in Site settings, default 20) and unlock the Contributor and Knowledge Giver badges.

**Class reps.** In Students, tap "Make rep" and pick a department and level (or all levels). The rep gets a panel in their profile to review uploads, post to the library, set the class timetable and events, and message the class. A rep only ever affects their own class.

## Run it on your computer

1. Install Node.js 18 or newer from nodejs.org.
2. In this folder, run:

       npm install
       ADMIN_PASSWORD="choose-a-strong-password" npm start

   On Windows (Command Prompt):

       set ADMIN_PASSWORD=choose-a-strong-password
       npm start

3. Open http://localhost:3000 and http://localhost:3000/admin.

Locally, data is saved in the `data` folder.

## Put it online for free (Render + MongoDB Atlas)

Free hosts wipe their local disk on every restart, so the site keeps its data in a free
MongoDB Atlas database instead. Free plans and limits change, so check each site's
current pricing page.

**1. Database (MongoDB Atlas)**
1. Create a free account at mongodb.com/atlas and create a free (M0) cluster.
2. Database Access: add a database user with a password.
3. Network Access: add the IP address `0.0.0.0/0` (Render's addresses change).
4. Connect > Drivers: copy the connection string. It looks like
   `mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/`. Put your real password in it.

**2. Code (GitHub)**
1. Create a free GitHub account and a new empty repository.
2. Upload every file in this folder (the `node_modules` and `data` folders are not needed).

**3. Website (Render)**
1. Create a free account at render.com, then New > Web Service, and connect the repository.
2. Settings: Runtime `Node`, Build command `npm install`, Start command `npm start`.
3. Environment variables (these keep secrets out of your code):
   - `ADMIN_PASSWORD` = a strong password only you know
   - `MONGODB_URI` = the connection string from step 1
4. Deploy. Render gives you a link like `https://exam-warriors.onrender.com`.

Share that link with students. Go to `/admin` on the same link to log in.

Note: on Render's free plan the site goes to sleep when nobody visits for a while, so the
first visit after a quiet period can take about a minute to load. Your data is not lost.

## Using the admin page

- **Notice banner:** one line shown at the top of the site (test dates, announcements).
- **Add study material:** a title, course and type, plus any of: note text, a file
  (PDF, Word, PowerPoint, Excel, images, CSV, text; up to 12 MB) or a link.
- **Create a quiz:** one question per line:

      Question | Option A | Option B | Option C | Option D | Answer letter | Explanation (optional)

  Example:

      Which enzyme joins Okazaki fragments? | DNA polymerase I | DNA ligase | Helicase | Primase | B | Ligase seals the nicks.

- **Remove** anything you published, or a name from the leaderboard.

## How scoring works

Students do not need accounts. Each phone gets a private random ID saved in its browser,
and scores are tied to it. The server marks the answers itself, so scores cannot be faked
by editing the page. A student who clears their browser data or switches phone starts as a
new warrior. Points are 10 per correct answer, counted from the best attempt at each quiz.

## Security notes

- Set a long `ADMIN_PASSWORD`. Without one, the admin page stays switched off.
- Admin login is limited to a few tries per 15 minutes and lasts 12 hours.
- Uploaded files are checked by type and contents, and are served in a sandbox.
- Do not publish the connection string or password anywhere public.

## Quiz mistakes, timed exams, CGPA and reports

- **Practise my mistakes**: every quiz attempt remembers which questions were missed (`scores.missed`, matched by question text so reordering a quiz is safe). The quiz card and result page offer "Practise N mistakes". Practice gives no points; each right answer removes that question from the list.
- **Timed exam**: `#/quiz/<id>?mode=exam`. One minute per question (minimum 5 minutes), no feedback until submitted, auto-submits at zero. It counts as a normal attempt.
- **CGPA calculator**: `#/cgpa`, Nigerian 5.0 scale, saved on the phone only (localStorage).
- **Report a problem**: students flag a quiz question, a resource or the site (`POST /api/report`, 40/hour). Admin > Reports lists them; "Mark as fixed" sends the student a thank-you notification.

## Move-over banner (Exam Warriors to Altidian)

Admin > Site settings > Move-over banner. Shows a banner with a countdown on the home page, a one-time welcome pop-up for each student, and a ribbon on the login and sign-up pages for people arriving from old links. Settings: `moveOn`, `moveEnds` (countdown day), optional `moveTitle` and `moveText`. The banner hides itself a week after the countdown day.
