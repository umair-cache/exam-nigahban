# Exam Nigahban

**AI-assisted examination monitoring and evidence management system**

Team **U Square Tech** · KP AI Impact Challenge 2026 · Application Ref `AIC26-3D4D4059`

---

## About

Exam Nigahban is an AI-assisted examination monitoring and evidence-management system built
primarily for **on-site computer-based assessments (CBT)** at universities, colleges and
examination centres, with the potential to expand to remote examinations.

It works **alongside** examination platforms rather than replacing them. It helps
invigilators and examination administrators detect predefined observable conditions, review
the supporting evidence and keep structured, accountable records of examination events, so
one invigilator can supervise a whole lab from a single screen.

**Objective:** a scalable examination-monitoring solution for educational and assessment
institutions, combining AI-assisted observation, structured evidence management and
accountable human review.

**AI flags. A person decides. Every decision is recorded.**

## Key features

**Monitoring (in the candidate's browser)**
- **Face presence:** detects when the candidate's face is absent from the webcam view for a set time.
- **Multiple faces:** detects more than one visible face in the camera frame.
- **Head pose:** detects sustained or repeated head turns and looking away, using facial landmark analysis.
- **Mobile phone:** detects a visible mobile phone using object detection.
- **Leaving the exam screen:** detects switching to another tab, window or application; with entire-screen sharing, captures **screenshots of what the candidate opened**.
- **Screen sharing stopped:** raised immediately if the candidate stops sharing their screen.
- **Temporal event evaluation:** confidence, duration and occurrence rules filter out brief or unreliable detections.
- **Automated evidence capture:** each event is timestamped and carries still-image evidence (camera snapshot or screenshots).

**Review and administration**
- **Real-time notifications:** qualifying events reach administrators instantly over WebSockets.
- **Fast evidence-based review:** one-click **Confirm / Ignore** per event, **bulk review** of many events or students at once, keyboard shortcuts (C, I, Esc), remarks optional.
- **Enforcement by a person only:** pause the exam (can be lifted), cancel the exam, or open a UFM (unfair means) case.
- **Accountability:** authentication, role-based access, audit history of every decision, voided records (withdrawn, never deleted), per-session case reports and roster reports.
- **Exam management:** exams, questions, students and administrators.
- **Platform integration:** proof-of-concept integration with **iSpring QuizMaker (SCORM 1.2)**.

## How it works

1. **Candidate session:** the student opens an authorised exam and completes a readiness check (webcam, and entire-screen sharing when the exam requires it).
2. **AI monitoring:** computer-vision models analyse the webcam feed inside the candidate's browser.
3. **Event evaluation:** a temporal rule engine checks confidence, duration and occurrence conditions.
4. **Evidence generation:** when an event meets the criteria, a still image (or screenshots, for leaving the exam screen) and a timestamped event record are created.
5. **Backend validation:** the server checks the event against the candidate's active exam session and the monitoring rules configured in the database.
6. **Administrator notification:** the event and its evidence reach authorised administrators in real time.
7. **Human review:** the administrator confirms or ignores the event and decides whether any action is needed.

### Monitoring conditions (default rules)

| Condition | Detected by | Triggers after | Severity |
|---|---|---|---|
| Head left / right / up / down | Camera AI (MediaPipe) | 3 s, 3 times | Medium |
| Looking away | Camera AI (MediaPipe) | 3 s, 3 times | Medium |
| Face absent | Camera AI (MediaPipe) | 3 s | High |
| Multiple faces | Camera AI (MediaPipe) | 2 s | High |
| Mobile phone | Camera AI (YOLOX-Nano) | 0.5 s | High |
| Left exam screen | Browser focus | 2 s | Medium |
| Screen sharing stopped | Browser | Immediately | High |

Rules are stored in the database (`monitoring_rules` table) and seeded by the setup script.

## Privacy and human oversight

- Raw webcam video is processed **inside the candidate's browser** and is never streamed or stored on the server. Only event details and still-image evidence of qualifying events are sent.
- Screenshots are taken **only while the candidate is away from the exam screen**. Each one is stored with a SHA-256 hash, and every view by an administrator is logged.
- AI-generated events are **monitoring indicators, not proof of cheating**. The system never decides misconduct or applies a penalty by itself; final decisions stay with authorised examination staff.

---

## Technology

| Part | Technology |
|---|---|
| Frontend | React 19, Vite 8, React Router 7, Bootstrap 5.3, Axios |
| In-browser AI | MediaPipe Tasks Vision (Face Landmarker); YOLOX-Nano via ONNX Runtime Web (WebAssembly) in a Web Worker |
| Backend | Python, FastAPI, SQLAlchemy, Uvicorn, WebSockets, JWT (PyJWT), bcrypt |
| Database | MySQL 8 (default) or PostgreSQL |
| Evidence storage | Local folder (default) or S3-compatible storage |

```
backend/     FastAPI API: app/api (routes), app/models, app/schemas, app/services,
             app/websocket, app/cli (admin & demo-data commands), tests/
frontend/    React app: src/pages (admin, student), src/components,
             src/monitoring (AI detection), public/models/yolox-nano-phone.onnx
```

---

## How to run

Setup takes about 10 minutes. In short: **get the code → backend (Python + MySQL) → frontend
(Node.js) → open http://localhost:5173 and log in**. Commands are shown for Windows; macOS /
Linux differences are noted beside them.

### Step 0 — Install the prerequisites (once)

| Software | Version | Download |
|---|---|---|
| Python | 3.12 or 3.13 | https://www.python.org/downloads/ (Windows: tick **"Add python.exe to PATH"** during install) |
| Node.js (includes npm) | 20.19+ or 22.12+ (LTS) | https://nodejs.org/ |
| MySQL Server | 8 or newer | https://dev.mysql.com/downloads/mysql/ (remember the **root password** you set) |
| Browser | Google Chrome or Microsoft Edge | with a working webcam |

An **internet connection** is needed: the exam page downloads the MediaPipe face model the
first time it opens.

Check the installs in a new terminal:

```bash
python --version     # Windows: if not found, use  py --version   macOS/Linux: python3 --version
node --version
npm --version
```

### Step 1 — Get the code

**From the ZIP file:** right-click `AIC26-3D4D4059_USquareTech.zip` → **Extract All**, then
open a terminal in the extracted `Exam-Nigahban` folder (it contains `backend`, `frontend`
and this README).

**From GitHub:**

```bash
git clone <repository-url>
cd <repository-folder>
```

All commands below start from this project folder.

### Step 2 — Backend (terminal 1)

```bash
cd backend
python -m venv venv                  # macOS/Linux: python3 -m venv venv   (Windows: py -m venv venv also works)
venv\Scripts\activate                # macOS/Linux: source venv/bin/activate
pip install -r requirements.txt
```

`(venv)` now appears at the start of the prompt.

> **Windows PowerShell says "running scripts is disabled"?** Run
> `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass` (applies to this window only),
> then `venv\Scripts\activate` again. Or use **Command Prompt** instead of PowerShell.

**Create the configuration file:**

```bash
copy .env.example .env               # macOS/Linux: cp .env.example .env
python -c "import secrets; print(secrets.token_urlsafe(64))"
```

Open `backend/.env` in any text editor and set:

| Setting | Value |
|---|---|
| `DB_PASSWORD` | your MySQL root password (change `DB_USER` too if you don't use `root`) |
| `SECRET_KEY` | the long random text printed by the second command above |

Leave everything else as it is.

**Create the database** (an empty database named `exam_nigahban`):

```bash
mysql -u root -p -e "CREATE DATABASE exam_nigahban;"
```

If `mysql` is not recognised, open **MySQL Workbench** (or MySQL Command Line Client),
connect as root and run: `CREATE DATABASE exam_nigahban;`

**Set up tables, monitoring rules and demo accounts** (one command, safe to run again):

```bash
python setup_database.py
```

It ends with `Setup complete.` and lists the demo logins.

**Start the API** and keep this terminal open:

```bash
uvicorn app.main:app --reload
```

Check: http://127.0.0.1:8000/health shows `{"status":"ok"...}`. API documentation:
http://127.0.0.1:8000/docs

### Step 3 — Frontend (terminal 2)

Open a **second** terminal in the project folder:

```bash
cd frontend
npm install
npm run dev
```

Keep it open and go to **http://localhost:5173**.

(The frontend uses the API at `http://127.0.0.1:8000`. Only if the API runs elsewhere: copy
`frontend/.env.example` to `frontend/.env` and change `VITE_API_BASE_URL`.)

### Step 4 — Log in

Demo accounts created by `setup_database.py` (local evaluation only):

| Role | Username | Password |
|---|---|---|
| Administrator (system administrator) | `admin` | `Admin@2026` |
| Student | `ahmad.khan` | `Student@2026` |
| Student | `fatima.zahra` | `Student@2026` |
| Student | `ali.hassan` | `Student@2026` |
| Student | `aisha.malik` | `Student@2026` |
| Student | `usman.tariq` | `Student@2026` |

Two active demo exams with 5 questions each are created, with entire-screen sharing required.

### Step 5 — Try the monitoring

1. Open two browser windows: a normal one and a private (Incognito / InPrivate) one, so the two logins do not replace each other.
2. Window 1: log in as `admin` and open **Monitoring Events**.
3. Window 2: log in as a student (e.g. `ahmad.khan`), open an exam and follow the steps: allow the **camera**, and when asked to share, choose **Entire screen**.
4. During the exam: hold a phone up to the camera, look away, leave the camera view, or switch to another tab for a few seconds.
5. Window 1: the alert appears in the bell and in Monitoring Events. Click **Confirm** or **Ignore** on the row, or **Review** to see the evidence (camera photo, or screenshots of what the student opened).

Screenshots are taken only while the student is away from the exam screen. Browsers allow
this only with the student's entire-screen sharing, which new exams require by default
(**Exams → edit → Require entire-screen sharing**); with it turned off, the only evidence for
leaving the exam screen is a camera photo.

### Running it again later

```bash
# terminal 1
cd backend
venv\Scripts\activate                # macOS/Linux: source venv/bin/activate
uvicorn app.main:app --reload
```

```bash
# terminal 2
cd frontend
npm run dev
```

### Troubleshooting

| Problem | Fix |
|---|---|
| `python` is not recognised (Windows) | Use `py` instead of `python`, or reinstall Python with "Add python.exe to PATH" ticked. |
| API stops at start with a `SECRET_KEY` error | `SECRET_KEY` in `backend/.env` is missing, still the placeholder, or shorter than 32 characters. |
| `Access denied for user 'root'` or `Unknown database 'exam_nigahban'` | Check `DB_USER` / `DB_PASSWORD` in `backend/.env`, and that the database was created (Step 2). |
| `Can't connect to MySQL server` | Start the MySQL service (Windows: open **Services**, find the MySQL service, e.g. `MySQL80`, and click **Start**). |
| Login page shows a network error | The API (terminal 1) is not running, or was opened at a different address than `http://localhost:5173`. |
| Camera or screen-share prompt does not appear | Use Chrome or Edge at `http://localhost:5173` (browsers allow camera access only on localhost or HTTPS) and allow the permission in the address bar. |
| Port 8000 or 5173 already in use | Close the other program using it, or stop an earlier run of this project. |

### Run the automated tests (optional)

```bash
cd backend
venv\Scripts\activate                # macOS/Linux: source venv/bin/activate
pytest -q                            # 490 tests; uses its own in-memory database, not your MySQL data

cd ../frontend
npm test                             # 313 tests
```

### Using PostgreSQL instead of MySQL (optional)

In `backend/.env` set `DB_DRIVER=postgresql`, `DB_PORT=5432` and your PostgreSQL user and
password, create the database `exam_nigahban` (e.g. `createdb exam_nigahban`), then continue
with `python setup_database.py`.

---

## AI models, datasets and tools (disclosure)

### AI models used in the product

| Model | Purpose | Source | Licence |
|---|---|---|---|
| MediaPipe **Face Landmarker** (float16) | Face presence, multiple faces, head direction, looking away | Google MediaPipe, pretrained; loaded at runtime from `storage.googleapis.com/mediapipe-models` | Apache-2.0 (`@mediapipe/tasks-vision`) |
| **YOLOX-Nano** | Mobile phone detection (COCO class 67, "cell phone") | Megvii YOLOX, pretrained on the **COCO** dataset, exported to ONNX at 320×320; shipped as `frontend/public/models/yolox-nano-phone.onnx` | Apache-2.0 |

Both models run in the student's browser. The backend contains no AI model: it applies the
monitoring rules, stores events and evidence, and manages review and enforcement.

### Datasets

No custom dataset was collected or used for training. The phone detector uses YOLOX-Nano's
published COCO-pretrained weights; MediaPipe Face Landmarker is used as published by Google.

### Main open-source libraries

FastAPI, SQLAlchemy, Pydantic, PyJWT, passlib/bcrypt, boto3 (backend; full list in
`backend/requirements.txt`); React, Vite, Bootstrap, Axios, `@mediapipe/tasks-vision`,
`onnxruntime-web` (frontend; full list in `frontend/package.json`).

### AI tools used during development

The team used **ChatGPT** (OpenAI) and **Claude** (Anthropic) as coding assistants for
code generation, debugging, refactoring, tests and documentation. All generated code was
reviewed, tested and integrated by the team.

---

## Known limitations

- Detection quality depends on lighting, camera position and image quality; every event is reviewed by a person before any action.
- Monitoring is visual only: audio is not analysed, and a second device kept out of camera view is not detected.
- Screenshot evidence for "left exam screen" needs the student to share their entire screen (Chrome or Edge); browsers do not allow capturing other tabs without that permission.
- The MediaPipe face model is downloaded from the internet when the exam page first opens.
- The live alert channel runs in a single server process; running several API workers needs a shared message broker.
- Formal accuracy evaluation has so far covered only a small staged pilot; results should not be generalised.

## Current scope and future direction

The current prototype focuses on visual monitoring for **on-site computer-based
examinations**, complementing existing examination platforms.

Planned next steps:
- Formal AI performance evaluation on a larger, labelled set of exam sessions, and reducing false alerts.
- Monitoring-session health checks, stronger security and privacy safeguards, and load testing with many simultaneous sessions.
- Wider compatibility with existing examination platforms.
- Expansion to **remote examinations**, which needs further work on remote-session integrity, browser security, connectivity conditions, privacy safeguards and different exam environments.

---

**Team U Square Tech** — KP AI Impact Challenge 2026
