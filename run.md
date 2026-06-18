# OSINT Graph: Setup and Run Instructions

This guide provides step-by-step instructions on how to set up and run the OSINT Graph application locally. The application consists of a Python backend (FastAPI) and a React frontend (Vite).

## Prerequisites
Before you begin, ensure you have the following installed on your machine:
- **Python 3.8+** (for the backend)
- **Node.js (v18+)** and **npm** (for the frontend)

---

## 1. Setting up the Backend

The backend is built with FastAPI and runs on Python. It includes a fallback JSON database, meaning **you do not need a running Neo4j instance** to run the app; it will automatically fall back to local storage.

### Step 1: Open a terminal in the \`backend\` directory
Navigate to the \`backend\` folder of the project:
```bash
cd backend
```

### Step 2: Create a virtual environment (Optional but recommended)
It is highly recommended to create a virtual environment to manage dependencies:
```bash
python -m venv venv
```

Activate the virtual environment:
- **Windows:**
  ```cmd
  .\venv\Scripts\activate
  ```
- **Mac/Linux:**
  ```bash
  source venv/bin/activate
  ```

### Step 3: Install dependencies
Once the virtual environment is activated, install the required Python packages:
```bash
pip install -r requirements.txt
```

### Step 4: Environment Variables (Optional)
The backend requires a Groq API key for analyzing CDR/IPDR logs, though the app will still boot without it.


*(Note: If Neo4j is not provided, the app securely falls back to local JSON storage).*

### Step 5: Start the backend server
Run the FastAPI application using Uvicorn:
```bash
uvicorn app.main:app --reload --port 8000
```
The backend is now running at **http://localhost:8000**.

---

## 2. Setting up the Frontend

The frontend is a React application built with Vite.

### Step 1: Open a terminal in the \`frontend\` directory
Open a *new* terminal window (leave the backend running) and navigate to the \`frontend\` folder:
```bash
cd frontend
```

### Step 2: Install Node modules
Install the necessary JavaScript dependencies:
```bash
npm install
```

### Step 3: Start the frontend development server
Start Vite to run the web interface:
```bash
npm run dev
```

The frontend will start up and provide you with a local URL, typically **http://localhost:5173**. 
Open this URL in your web browser to use OSINT Graph!

---

## Summary of Commands to Start the App (Quick Start)

**Terminal 1 (Backend - Windows)**
```bash
cd backend
.\venv\Scripts\activate
uvicorn app.main:app --reload --port 8000
```

**Terminal 2 (Frontend)**
```bash
cd frontend
npm install  # (only needed the first time)
npm run dev
```
