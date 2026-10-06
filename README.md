# ShortLink — URL Shortener & Telemetry Service

A complete, ready-to-run URL shortener web application and REST API built with **Node.js**, **Express**, and **MySQL** (with an automatic zero-config local JSON persistence fallback so the project works immediately after cloning even without MySQL running).

## Features

- **Instant URL Shortening**: Convert long `http://` or `https://` URLs into compact 8-character short links or custom aliases (`3–24` alphanumeric/hyphen/underscore characters).
- **Fast HTTP 302 Redirection**: Visiting `/:shortCode` (or `/api/:shortCode`) redirects to the destination URL and atomically increments the click counter and `last_accessed_at` timestamp.
- **Live Links Directory & Search**: View all created links, filter by code or destination URL, sort by newest or most clicked, copy links in one click, and export telemetry to CSV.
- **Link Telemetry & Lookup**: Inspect total clicks, creation timestamps, and last-accessed timestamps for any short code.
- **Dual Storage Engine**:
  - **MySQL Mode**: When `DB_HOST` is set in `.env`, connects via `mysql2/promise` connection pool and automatically ensures the `urls` table exists.
  - **Zero-Config Local Mode**: When `DB_HOST` is omitted or unreachable, persists links to `data/urls.json` automatically so you can clone and run the app in seconds.
- **Automated Test Suite**: Includes end-to-end API tests powered by Jest (`npm test`).

## Project Structure

```text
url-shortener/
├── db/
│   └── init.sql                 # MySQL database & table schema
├── public/
│   ├── index.html               # Web dashboard & API explorer UI
│   └── styles.css               # Stylesheet
├── src/
│   ├── config/
│   │   └── db.js                # MySQL connection pool + persistent local JSON fallback
│   ├── controllers/
│   │   └── urlController.js     # Shorten, list, redirect, stats, and delete handlers
│   ├── middleware/
│   │   └── errorHandler.js      # Centralized Express error handling middleware
│   ├── routes/
│   │   └── url.js               # Express API router (/api/*)
│   └── app.js                   # Express application entry point
├── tests/
│   └── url.test.js              # Jest integration test suite
├── .env.example                 # Environment variable template
├── .gitignore
├── LICENSE
├── package.json
└── README.md
```

## Quick Start (Clone & Run)

1. **Clone the repository**
   ```bash
   git clone https://github.com/Null-source404/Software-_v1.1.git
   cd Software-_v1.1
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment variables (Optional for local mode, required for MySQL)**
   ```bash
   cp .env.example .env
   ```
   - Leave `DB_HOST=` empty to use the built-in local JSON store (`data/urls.json`).
   - Or configure `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, and `DB_PORT` to use MySQL (you can also run `db/init.sql` manually if desired).

4. **Start the server**
   ```bash
   npm run dev
   ```
   Open `http://localhost:3000` in your browser.

5. **Run the automated test suite**
   ```bash
   npm test
   ```

## REST API Reference

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/shorten` | Create a shortened URL (`{ "originalUrl": "https://...", "customCode": "optional-slug" }`) |
| `GET` | `/api/urls` | List all shortened URLs and aggregate click counts |
| `GET` | `/api/stats/:shortCode` | Retrieve click count, timestamps, and destination URL for a short code |
| `DELETE` | `/api/urls/:shortCode` | Delete a shortened URL by its short code |
| `GET` | `/:shortCode` | Redirect (`302 Found`) to the original URL and increment click count |
| `GET` | `/health` | Health check endpoint (`{ "status": "OK" }`) |

## License

MIT
