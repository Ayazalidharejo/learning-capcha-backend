# Register & Login demo (2-stage register + captcha + calendar booking)

This is a small demo web app created to implement the flow you described:

- Register with a 2-stage form (stage 1: name/email/password; stage 2: choose security questions and answers)
- Login with captcha (generated server-side) + second-step security questions matching the ones from registration
- After login you see a welcome dashboard with a sidebar containing 5 buttons and a "Book a Calendar" flow
- Calendar covers 6 months and each month shows 5 available dates; when a user reserves a date it is reserved and will be booked automatically after 5 seconds

Quick start (Windows / PowerShell):

1. Install dependencies
```
npm install
```

2. Run the server
```
npm start
```

3. Open the app in your browser
```
http://localhost:3030/
```

React + Tailwind frontend (new)
--------------------------------
This project now uses a React + Tailwind frontend in the `client/` folder. Two ways to run it:

- Development mode (fast iteration):
	- Open a terminal in `client/` and run:
		npm install
		npm run dev
	- The client dev server will run (default Vite port 5173). It communicates with the backend at `http://localhost:3030` by default.

- Production build (serve from Node server):
	- Build client: run `npm run build` inside `client/`.
	- Then the server will serve the built files automatically from `client/dist/` if present.

Note: I left the old static `public/` HTML files in place as lightweight fallbacks that now show a short migration notice. The React client is the recommended UI going forward.

Note about single-file demo
--------------------------
I previously added a client-only single-file demo (`public/merged.html`) that used localStorage so the app could run without a backend. Per your request I removed that file and restored the server-backed flow as the primary working mode.

Why you saw those browser errors
--------------------------------
- The console errors you pasted ("Refused to apply style ... MIME type ('text/html')" and "Failed to load resource 404") mean the browser requested a file (e.g. /styles.css or /app.js) and the server returned an HTML page (often a 404 page or the index), not the actual CSS/JS file. Browsers refuse to apply a CSS file if its MIME type is text/html.
- This commonly happens when you open a page under a different server root (e.g., Live Server at http://127.0.0.1:5500) while the HTML uses absolute paths like `/styles.css` or `/app.js` — the request then targets the workspace root instead of the `public/` folder, causing 404 / HTML responses.

How to avoid it
---------------
1) Best (use the included Node server):
	- Start the server with `npm start` and open pages at `http://localhost:3030/`.
	- The Node server serves `public/` at the root so absolute paths like `/styles.css` and `/app.js` work.

2) If you prefer Live Server or opening HTML directly:
	- Open the HTML inside the `public/` folder and use relative paths for assets (for example `styles.css` and `app.js`).

	Note: If you've just pulled updates or I asked you to reload, please do a hard refresh in your browser (Ctrl+F5) or close/reopen the page so the newest `public/app.js` is loaded. This fixes issues where an old client keeps sending 'undefined' for the registration session id.

	Note: you may also run `node app.js` — the repository now includes a small top-level `app.js` wrapper which simply loads `server.js`, so both `node server.js` and `node app.js` will start the server. The recommended way is still `npm start`.

I updated the HTML files in `public/` to use relative includes so opening them with Live Server or file:// will now work.

Notes:
- Data is stored under the `data/` folder (users.json and calendar.json). The calendar is initialized automatically on first run.
- This is a demo project with simple file-based storage for ease of testing.

Security & env
---------------
- The project uses a `.env` file to configure `MONGO_URI` and other runtime values. Do not commit your `.env` to public repositories — it's included in `.gitignore` by default.

Create `.env` in the project root with content like:

MONGO_URI=mongodb+srv://<username>:<password>@cluster0....

Replace with your real connection string. If `.env` is missing the server will use the file-based demo storage instead.
