# Quick Start Guide for OSINT Graph

To run the application, you need to start both the backend and frontend servers in two separate terminal windows.

## Terminal 1 (Backend)
1. Open a terminal and navigate to the backend directory:
   cd backend

2. Activate the virtual environment:
   Windows: .\venv\Scripts\activate
   Mac/Linux: source venv/bin/activate

3. Start the FastAPI server:
   uvicorn app.main:app --reload --port 8000

## Terminal 2 (Frontend)
1. Open a second terminal and navigate to the frontend directory:
   cd frontend

2. Install dependencies (only required the first time):
   npm install

3. Start the React frontend server:
   npm run dev

Once both are running, open your web browser and go to http://localhost:5173 to use OSINT Graph!
