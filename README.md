# FairQueue

**Fair, explainable work allocation for an in-house data analytics team.**

| | |
|---|---|
| **Team** | Untitled (1) |
| **Campus branch** | Taylor's University |
| **Deployed app** | https://dormathon-demo.vercel.app |
| **Pitch deck** | [Deck](https://drive.google.com/file/d/1bnzSwd8G2Y-zxefzB0P1uutXV1n1-4Do/view?usp=sharing) |

---

## Problem statement

A central data analytics team serves several departments (HR, IT, Finance and Marketing) with
reports, models, dashboards, automations and documentation. Requests arrive through chat and email,
and the team lead assigns them largely from memory. That causes the same problems again and again:

- **Uneven workload.** The analysts people already know get overloaded while others sit under capacity.
- **Missed deadlines with no warning.** Nobody can see which tickets are drifting until they are already late.
- **Guesswork on effort.** Requesters don't know how long work will take, and estimates vary by person.
- **Leave breaks plans.** When an analyst takes time off, their queue is handed over late and in a rush.
- **Unexplained decisions.** When a ticket goes to someone, there is no record of why, so assignments
  feel unfair and are hard to review.

## Our solution

FairQueue is a ticketing and planning tool that recommends who should take each request and
**shows its reasoning**. A person always makes the final decision. It has three role-based views:

### Requester
- **New request** with AI suggestions as you type: predicted department, category, priority (with a
  reason tied to the department's KPIs), estimated hours (low / likely / high), a recommended analyst
  and similar past work.
- Track submitted tickets, review completed deliverables and request revisions.

### Analyst
- **My queue** and **My work & feedback**, shown as ticket cards with detail pop-ups.
- **Request leave** with an AI Leave & Reassignment Planner that shows which of their deadlines the
  leave puts at risk and suggests a colleague to take over each ticket.

### Team lead
- **Dashboard**: workload per analyst, deadline-risk alerts with a cause label (leave conflict,
  overloaded assignee, skill mismatch, underestimated type), and a volume forecast for the next weeks.
- **Assign**: a fit-score recommendation for each ticket that the lead can accept, or override with a
  reason. Every decision is logged.
- **Leave & what-if**: "If Ravi takes leave next week, which deadlines break?", with suggested takeovers.
- **Deliverables library**, **Replay results**, **Override log** and adjustable **Fit settings**.

### How it works
- **Fit score:** a weighted mix of skill, track record, pairing history, capacity and deadline
  feasibility. The weights can be tuned in Fit settings.
- **Hours prediction:** LightGBM quantile models give low / likely / high estimates. Ticket types the
  model hasn't seen get low confidence and a wider range instead of a guess.
- **Deadline risk:** queue arithmetic over each analyst's working hours and approved leave, with a
  rule-based cause for every alert.
- **Replay:** runs historical tickets through round-robin, fewest-open, and FairQueue assignment, then
  compares the outcomes against what actually happened.
- **AI agents:** tool-calling agents (suggestions, planning assistant, leave planner) that take every
  number from FairQueue's own engines, never from the model. Without an API key, or if a call fails,
  each feature falls back to a rule-based answer that is labelled as such.

## Tech stack

| Layer | Tools |
|---|---|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS, Recharts, React Big Calendar |
| Backend | Python, FastAPI, SQLite, pandas, scikit-learn, LightGBM |
| AI | Groq (default), Anthropic Claude or Google Gemini, chosen in `backend/config.yaml` |
| Deployment | Render (backend, see `render.yaml`) |

## Project structure

```
dormathon-demo/
├── backend/
│   ├── main.py              # FastAPI app and routers
│   ├── config.yaml          # all tunable settings (LLM provider, alerts, working hours)
│   ├── agents/              # AI agents: suggestions and planning assistant
│   ├── fairqueue/
│   │   ├── engine/          # fit score, schedule, deadline risk, forecast, what-if
│   │   ├── models/          # hours and handover models (training and loading)
│   │   ├── sim/             # replay simulator
│   │   ├── leave_advisor/   # leave & reassignment planner
│   │   └── ...              # tickets, assignment, planning, requester APIs, database
│   ├── data/                # department map and department KPI documents
│   └── tests/
├── web/                     # React frontend
└── render.yaml              # Render deployment config
```

## Setup and run locally

### Prerequisites
- Python 3.12+
- Node.js 20+ and npm
- *(Optional)* An API key for Groq, Anthropic or Gemini to turn on the AI features

### 1. Clone the repository
```bash
git clone <REPOSITORY_URL>
cd dormathon-demo
```

### 2. Backend
```bash
cd backend
python -m venv .venv

# Windows (PowerShell)
.venv\Scripts\Activate.ps1
# macOS / Linux
source .venv/bin/activate

pip install -r requirements.txt
```

Create `backend/.env` from the example and fill in the key for the provider set in `config.yaml`
(Groq by default):
```bash
cp .env.example .env
# then edit .env, e.g. GROQ_API_KEY=your_key_here
```

Seed the demo data and start the API:
```bash
python -m fairqueue.db.seed        # optional: resets the demo database
uvicorn main:app --reload --port 8000
```
The API runs at http://localhost:8000 (interactive docs at http://localhost:8000/docs). On first start
it creates the database and trains the models automatically if they are missing.

### 3. Frontend
In a second terminal:
```bash
cd web
npm install
npm run dev
```
Open http://localhost:5173. Use the role switcher to move between **Requester**, **Analyst** and
**Team lead**.

The frontend calls `http://localhost:8000` by default. To point it at another backend, create
`web/.env` with `VITE_API_URL=<backend_url>`.

### 4. Run the tests (optional)
```bash
cd backend
pip install pytest
python -m pytest tests -q
```

## Configuration

| Setting | Where |
|---|---|
| AI provider and model | `backend/config.yaml` → `llm.provider`, `llm.model` |
| API keys | `backend/.env` (`GROQ_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`) |
| Working hours, alert threshold | `backend/config.yaml` |
| Allowed frontend origins (CORS) | `FRONTEND_URL` environment variable |
| Backend URL for the frontend | `web/.env` → `VITE_API_URL` |

> **Note:** Groq's free tier allows about 8,000 tokens per minute. Several AI suggestions within one
> minute may fall back to rule-based answers until the limit resets.

## Demo data

The demo has no login. Identities are picked from the role switcher. The ticket history is
**synthetic** and labelled as such in the app. To train on real data, drop a help-desk ticket CSV into
`backend/data/raw/`, map its columns in `config.yaml`, then run `python -m fairqueue.models.train`.

## Team

**Untitled (1)**, University of Malaya

- Gan Zi Xiang
- Ooi Yong Zhe
- Cha Teck Min
- Chew Jee Syuen
