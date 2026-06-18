# 🔍 OSINT Investigative Relationship Graph Generator

An open-source intelligence (OSINT) web application that gathers publicly available information about a target identifier, extracts entities, maps their relationships, and visualizes them as an interactive graph for cyber investigation and intelligence analysis.

## ✨ Features

- **Multi-target OSINT**: Investigate by username, email, phone number, or name
- **300+ Site Username Checker**: Async parallel checks across major platforms
- **Email Intelligence**: HaveIBeenPwned integration with emailrep.io fallback
- **Phone OSINT**: Carrier detection, geo-location, reputation scoring
- **NLP Entity Extraction**: spaCy-powered NER for people, orgs, locations
- **Neo4j Graph Database**: Persistent relationship storage with Cypher queries
- **Interactive Sigma.js Graph**: Zoom, drag, filter, search nodes
- **Dark Cyberpunk UI**: React + glassmorphism design

---

## 🏗️ Architecture

```
Input (Username / Email / Phone / Name)
         ↓
   OSINT Collectors (async httpx)
         ↓
  Entity Extraction (spaCy NER + regex)
         ↓
  Relationship Discovery & Mapping
         ↓
   Neo4j Graph Database (bolt://)
         ↓
  FastAPI REST API (/api/*)
         ↓
  React Frontend + Sigma.js Graph
```

---

## 🚀 Quick Start (Docker — Recommended)

### Prerequisites
- [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- Docker Compose v2+

### 1. Clone and Configure
```bash
cd osint_graph
cp .env.example .env
# Edit .env if needed (optional: add HIBP_API_KEY)
```

### 2. Launch All Services
```bash
docker compose up --build
```

This starts:
| Service | URL | Description |
|---|---|---|
| Frontend | http://localhost:5173 | React app |
| Backend API | http://localhost:8000 | FastAPI |
| API Docs | http://localhost:8000/docs | Swagger UI |
| Neo4j Browser | http://localhost:7474 | Graph DB UI |

### 3. Open the App
Visit **http://localhost:5173**

---

## 🖥️ Local Development (Without Docker)

### Backend Setup
```bash
cd backend

# Create virtual environment
python -m venv venv

# Activate (Windows)
venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Download spaCy language model
python -m spacy download en_core_web_sm

# Copy env file
cp ../.env.example .env

# Start the API server
uvicorn app.main:app --reload --port 8000
```

### Frontend Setup
```bash
cd frontend

# Install dependencies
npm install

# Start dev server
npm run dev
```

### Neo4j (Local)

**Option A — Docker only Neo4j:**
```bash
docker run -d \
  --name osint_neo4j \
  -p 7474:7474 -p 7687:7687 \
  -e NEO4J_AUTH=neo4j/osintgraph2024 \
  neo4j:5.18-community
```

**Option B — Neo4j Desktop:**
- Download [Neo4j Desktop](https://neo4j.com/download/)
- Create a new project + database
- Set password to `osintgraph2024` (or update your `.env`)

---

## 📡 API Reference

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/investigate` | Start a new investigation |
| `GET` | `/api/investigation/{id}` | Get status + results |
| `GET` | `/api/graph/{id}` | Get graph nodes/edges |
| `GET` | `/api/entities` | List all known entities |
| `GET` | `/api/health` | Health check |
| `GET` | `/docs` | Interactive Swagger UI |

### Example: Start Investigation
```bash
curl -X POST http://localhost:8000/api/investigate \
  -H "Content-Type: application/json" \
  -d '{"query": "johndoe", "query_type": "username"}'
```

Response:
```json
{"id": "uuid-here", "status": "pending", "message": "Investigation started"}
```

### Example: Get Graph Data
```bash
curl http://localhost:8000/api/graph/uuid-here
```

---

## 🔑 HaveIBeenPwned API Key (Optional)

The HIBP API requires a paid key for programmatic account lookups.

**To get a key:**
1. Visit https://haveibeenpwned.com/API/Key
2. Purchase a subscription (~$3.50/month)
3. Add to `.env`: `HIBP_API_KEY=your-key-here`

**Without a key:** The system automatically falls back to [emailrep.io](https://emailrep.io), a free email reputation API that provides:
- Email reputation score (none / low / medium / high)
- Suspicious email detection
- Reference count (how many data sources mention this email)

---

## 🗄️ Neo4j Schema

### Node Labels

| Label | Key Properties |
|---|---|
| `Investigation` | id, query, query_type, status, created_at |
| `Username` | value, platform, url, confidence, found |
| `Email` | address, reputation, breached, breach_count |
| `PhoneNumber` | number, country, carrier, line_type |
| `Person` | name, confidence, source |
| `Organization` | name, type, url |
| `Location` | name, country |
| `Website` | url, title |

### Relationship Types

| Relationship | From → To |
|---|---|
| `CONTAINS` | Investigation → any entity |
| `FOUND_ON` | Username → Website |
| `HAS_EMAIL` | Person → Email |
| `HAS_PHONE` | Person → PhoneNumber |
| `WORKS_AT` | Person → Organization |
| `LOCATED_IN` | Person → Location |
| `USES` | Person → Username |
| `ASSOCIATED_WITH` | Email/Phone → Person |

### Useful Cypher Queries
```cypher
// All nodes in an investigation
MATCH (i:Investigation {id: "your-id"})-[:CONTAINS]->(n)
RETURN n

// All usernames found across all investigations
MATCH (u:Username {found: true})
RETURN u.platform, u.value, u.url ORDER BY u.platform

// Full relationship graph
MATCH p=()-[r]->() RETURN p LIMIT 100
```

---

## 📁 Project Structure

```
osint_graph/
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI app entry point
│   │   ├── config.py            # Pydantic settings
│   │   ├── models.py            # Request/Response schemas
│   │   ├── database.py          # Neo4j driver wrapper
│   │   ├── routers/             # API route handlers
│   │   ├── collectors/          # OSINT data collectors
│   │   ├── extractors/          # NER + relationship mapping
│   │   └── graph/               # Neo4j service layer
│   ├── data/
│   │   └── sites.json           # 100+ site definitions
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── App.jsx              # Root component
│   │   ├── index.css            # Global dark theme
│   │   ├── components/          # UI components
│   │   ├── hooks/               # useInvestigation hook
│   │   └── api/                 # API client
│   ├── package.json
│   └── Dockerfile
├── sample_data/
│   └── sample_investigation.json
├── docker-compose.yml
├── .env.example
└── README.md
```

---

## 🔮 Future Expansion

The architecture supports easy addition of:

| Module | Description |
|---|---|
| **CDR Analysis** | Call Detail Records → communication pattern graphs |
| **IPDR Analysis** | IP Detail Records → network activity mapping |
| **Tower Dumps** | Cell tower data → location timeline |
| **Device Intelligence** | IMEI/MAC → device ownership chains |
| **Case Management** | Group investigations into cases |
| **Timeline View** | Chronological event reconstruction |

---

## ⚠️ Legal Disclaimer

This tool is for **educational and authorized security research purposes only**. Only investigate targets you have explicit permission to investigate. Comply with all applicable laws and terms of service. The authors are not responsible for misuse.

---

## 📄 License

MIT License — see LICENSE file for details.
