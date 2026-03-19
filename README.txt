================================================================
  BD Engine - Local Setup Guide
================================================================


WHAT IS THIS?
  BD Engine is a local web app that tracks companies, discovers
  their job boards (ATS systems), and imports job postings with
  Canada/GTA location filtering.

  It runs entirely on your machine - no cloud server needed.


REQUIREMENTS
  - Windows 10 or 11 (PowerShell 5.1 is included by default)
  - A web browser (Chrome, Edge, Firefox, etc.)
  - That's it. No installs needed.


HOW TO START
  1. Double-click  Start-BDEngine.bat
  2. A small PowerShell window will appear (minimized)
  3. Your browser will open automatically to the dashboard
  4. If the browser doesn't open, go to: http://localhost:8173


HOW TO STOP
  Option A:  Double-click  Stop-BDEngine.bat
  Option B:  Close the PowerShell window that says "Server.ps1"


FIRST TIME SETUP
  The app comes with a pre-populated database (data/bd-engine.db)
  containing ~839 company records. No additional setup is needed
  to browse the dashboard and view existing data.

  To import fresh data:
  - Place your BD Engine spreadsheet (.xlsx) on your Desktop
    or in your Downloads folder. The app will find it automatically.
  - Place your LinkedIn Connections.csv in your Downloads folder.


OPTIONAL: GOOGLE SHEETS SYNC
  If you want live sync with Google Sheets, you need:
  1. A Google service account JSON key file
  2. Set these environment variables before starting:
       GOOGLE_APPLICATION_CREDENTIALS=C:\path\to\your\key.json
       GOOGLE_SHEETS_SPREADSHEET_ID=your-spreadsheet-id
  Most users don't need this - the local database works fine.


TROUBLESHOOTING

  "Port 8173 is already in use"
    Another copy of BD Engine (or another app) is using that port.
    Run Stop-BDEngine.bat first, then try again.

  Browser shows "can't connect" or blank page
    The server may still be starting up (takes 10-30 seconds).
    Wait a moment and refresh the page.

  PowerShell window shows red error text
    Check if your antivirus is blocking PowerShell scripts.
    You may need to allow powershell.exe in your security settings.

  "Execution policy" error
    The launcher sets the execution policy automatically.
    If it still fails, open PowerShell as admin and run:
      Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned


FILE STRUCTURE
  Start-BDEngine.bat     - Double-click to start
  Stop-BDEngine.bat      - Double-click to stop
  app/                   - Web UI (HTML/CSS/JavaScript)
  server/                - PowerShell backend
  server/vendor/sqlite/  - Bundled SQLite database driver
  data/                  - Database and runtime files
  scripts/               - Maintenance and diagnostic scripts
