# URL Shortener Service

A simple and efficient URL shortener service built with Express.js and MySQL.

## Features

- Shorten long URLs into compact, shareable links
- Redirect shortened URLs to original destinations
- Track URL statistics and analytics
- RESTful API endpoints
- MySQL database backend

## Project Structure

```
url-shortener/
├── src/
│   ├── config/
│   │   └── db.js              # MySQL connection pool
│   ├── controllers/
│   │   └── urlController.js   # Business logic
│   ├── routes/
│   │   └── url.js             # Route definitions
│   ├── middleware/
│   │   └── errorHandler.js    # Global error handling
│   └── app.js                 # Express setup
├── .env.example               # Environment variable template
├── .gitignore
├── package.json
└── README.md
```

## Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```

3. Create a `.env` file from `.env.example`:
   ```bash
   cp .env.example .env
   ```

4. Configure your environment variables

## Getting Started

Start the development server:
```bash
npm run dev
```

Or start in production mode:
```bash
npm start
```

## API Endpoints

- `POST /api/shorten` - Create a shortened URL
- `GET /:shortCode` - Redirect to original URL
- `GET /api/stats/:shortCode` - Get URL statistics

## License

MIT
