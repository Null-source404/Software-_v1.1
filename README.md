# 🔗 URL Shortener — Backend Mastery Project

> A production-grade URL shortener built **in phases** — each phase adds one real engineering concept on top of the last. This is not a finished product. It is a living system, built to understand what happens at every layer of a backend application.

---

## 🧠 The Idea

Most developers learn backend by following tutorials that show *how* to connect things. This project is different. It's built to understand *why* things are connected the way they are — and what breaks when they're not.

Each phase ships a working product. Each phase also teaches a concept that separates engineers who can build things from engineers who can build things **and** reason about them under pressure.

---

## 🏗️ System Architecture

```
Internet
   │
   ▼
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│    NGINX    │────▶│   Node.js   │────▶│    Redis    │
│  (Phase 5)  │     │    App      │     │  (Phase 2)  │
│ Reverse     │     │  (Phase 1)  │     │   Cache     │
│ Proxy + SSL │     │             │     │             │
└─────────────┘     └──────┬──────┘     └─────────────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
              ▼            ▼            ▼
       ┌──────────┐ ┌──────────┐ ┌──────────────┐
       │  MySQL │ │RabbitMQ  │ │  WebSocket   │
       │(Phase 1) │ │(Phase 7) │ │  Dashboard   │
       │ Primary  │ │  Queue   │ │  (Phase 4)   │
       │   DB     │ │          │ │              │
       └──────────┘ └──────────┘ └──────────────┘
```

> 7 separate programs. 1 product. Every layer understood.

---

## 📦 Phases

### ✅ Phase 1 — The Core
**Concepts:** Express.js · PostgreSQL · REST API · Connection Pooling

The foundation. A working URL shortener — nothing more, nothing less.

- `POST /api/shorten` — accepts a long URL, returns a short code
- `GET /:code` — redirects to the original URL, increments click counter
- `GET /api/urls/:code/stats` — returns click analytics for a URL
- PostgreSQL with connection pooling via `pg.Pool`
- Input validation (URL format, protocol whitelist)
- Global error handler that never leaks internals to the client
- Database index on `short_code` for O(log n) lookups

**Stack:** Node.js · Express · MySQL · nanoid · Helmet · CORS

---

### 🔲 Phase 2 — Caching
**Concepts:** Redis · Cache-Aside Pattern · TTL · Cache Invalidation

Every redirect hits the database. At scale, one popular short URL means thousands of identical DB queries per minute — for the same row. Redis fixes this.

- Cache-aside pattern on the redirect route
- TTL-based expiry (cache auto-invalidates)
- Cache miss → DB fetch → cache write → return
- ~95% reduction in database read load on popular URLs

**Stack:** Redis · ioredis

---

### 🔲 Phase 3 — API Security
**Concepts:** JWT · Rate Limiting · Input Validation · RBAC

A public API with no protection is an attack surface. This phase adds authentication for URL creation, distributed rate limiting, and proper validation.

- JWT authentication for `POST /api/shorten`
- Redis-based distributed rate limiting (works across multiple app instances)
- Zod schema validation on all request bodies
- CORS policy — explicit origin allowlist, not `*`
- RBAC middleware pattern (admin vs. standard user)

**Stack:** jsonwebtoken · Zod · ioredis

---

### 🔲 Phase 4 — Live Dashboard (WebSockets)
**Concepts:** WebSockets · Real-Time · Bidirectional Communication · Heartbeat

REST is request-response — the client always asks first. WebSockets keep a persistent connection open so the server can push data the moment something happens.

- Real-time click counter updates on every redirect
- Live dashboard — click count updates without page refresh
- Heartbeat/ping-pong to detect dead connections
- Room-based broadcasting (per short URL channels)

**Stack:** ws · A minimal HTML/JS frontend

---

### 🔲 Phase 5 — NGINX + Deployment
**Concepts:** Reverse Proxy · SSL Termination · Load Balancing · Rate Limiting

NGINX sits in front of everything. It handles raw internet traffic, terminates HTTPS, and forwards clean requests to the app. The app never deals with SSL certificates or raw TCP.

- Reverse proxy: `443 HTTPS → app:3000 HTTP`
- SSL/TLS termination with Let's Encrypt
- WebSocket proxying (`Upgrade: websocket` headers)
- NGINX-level rate limiting as a first line of defence
- Static file serving for the dashboard frontend

**Stack:** NGINX · Let's Encrypt (Certbot)

---

### 🔲 Phase 6 — GraphQL Analytics
**Concepts:** GraphQL · Schema · Resolvers · DataLoader · N+1 Problem

REST gives you fixed endpoints. GraphQL lets the client ask for exactly what it needs — nothing more. The analytics layer becomes a flexible query API.

- Single `/graphql` endpoint replaces multiple `/api/stats/...` routes
- Schema: `Query.url`, `Query.topUrls`, `Query.clicksByDay`
- DataLoader to batch DB calls and eliminate the N+1 problem
- Introspection disabled in production
- Query depth limiting to prevent expensive nested queries

**Stack:** Apollo Server · DataLoader

---

### 🔲 Phase 7 — Message Broker
**Concepts:** RabbitMQ · Async Processing · Work Queues · Consumer · Dead Letter Queue

Right now, analytics are processed synchronously inside the redirect request. That means every redirect is slowed by analytics logic. The broker decouples them — the redirect is instant, analytics happen in the background.

- RabbitMQ queue: `analytics-events`
- Producer: fires an event on every redirect (non-blocking)
- Consumer: separate worker process that processes analytics
- Dead Letter Queue for failed messages
- The redirect endpoint stays fast regardless of analytics load

**Stack:** amqplib · RabbitMQ

---

## 🗂️ Project Structure

```
url-shortener/
├── src/
│   ├── config/
│   │   └── db.js              # PostgreSQL connection pool
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

---

## 🚀 Running Phase 1 Locally

**Prerequisites:** Node.js 18+, PostgreSQL running locally

```bash
# 1. Clone the repo
git clone https://github.com/YOUR_USERNAME/url-shortener.git
cd url-shortener

# 2. Install dependencies
npm install

# 3. Set up environment variables
cp .env.example .env
# Edit .env with your database credentials

# 4. Create the database
psql -U postgres -c "CREATE DATABASE urlshortener;"
psql -U postgres -d urlshortener -f src/config/schema.sql

# 5. Start the development server
npm run dev
```

**Test it:**
```bash
# Create a short URL
curl -X POST http://localhost:3000/api/shorten \
  -H "Content-Type: application/json" \
  -d '{"url": "https://github.com"}'

# Visit the short URL in your browser
# http://localhost:3000/{shortCode}

# Check the stats
curl http://localhost:3000/api/urls/{shortCode}/stats
```

---

## 🌍 Environment Variables

```bash
# .env.example
PORT=3000
DATABASE_URL=mysql://USER:PASSWORD@HOST:PORT/DATABASE
BASE_URL=http://localhost:3000

# Added in Phase 2
REDIS_URL=redis://localhost:6379

# Added in Phase 3
JWT_SECRET=your_256_bit_secret_here
JWT_EXPIRES_IN=15m

# Added in Phase 7
RABBITMQ_URL=amqp://localhost
```

---

## 📡 API Reference (Phase 1)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/api/shorten` | None (Phase 1) | Create a short URL |
| `GET` | `/:code` | None | Redirect to original URL |
| `GET` | `/api/urls/:code/stats` | None | Get click analytics |
| `GET` | `/health` | None | Health check |

---

## 💡 Why This Project

> *"Most people's GitHub is full of todo apps and tutorial clones. This is one real system, built layer by layer, that demonstrates what happens inside a production backend — not just that it works, but why it works and what breaks when it doesn't."*

Each phase is a real problem that real systems face at scale. The decisions made here — why Redis sits in front of Postgres, why analytics are queued instead of synchronous, why NGINX terminates SSL instead of the app — are the same decisions made inside companies like Bitly, Stripe, and GitHub.

---

## 📄 License

MIT — use it, learn from it, build on it.
