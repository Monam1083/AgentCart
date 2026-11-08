# AgentCart

An AI shopping agent that does the legwork and leaves the payment to you.

You type what you want ("cheapest frozen food bundle under $30, no pork"). A Gemini agent searches the catalog, compares options and builds a **draft cart**. You review it and tap **Confirm**, then approve the payment in **PayPal**. The agent never touches your money.

Built for the [Build What's Next with PayPal and AI](https://paypalaihackathon.devpost.com/) hackathon. PayPal runs in the **sandbox only**: no real money moves, and the code has no path to the live API.

## How the safety design works

| Step | Who acts | What is enforced |
| --- | --- | --- |
| 1. Request | You | Message length and session validated |
| 2. Propose a cart | Gemini, via three tools | The agent can call only `search_products`, `compare_options` and `propose_cart`. There is no payment tool. The server prices every line from the catalog, rejects bad ids and out-of-stock items, and blocks carts above your spending limit. |
| 3. Confirm | **You** | Only `POST /api/carts/:id/confirm` can create a PayPal order. It re-prices the cart, checks ownership of the session, and checks the limit again. |
| 4. Approve | **You**, inside PayPal | PayPal's own checkout page |
| 5. Capture | Backend | Runs only when PayPal redirects back for an order the backend created, only once, and the captured amount must equal the cart total |

Two human checkpoints sit between a request and a charge. A wrong or manipulated price from the model cannot reach checkout, because totals never come from model output.

## Architecture

```
Flutter app  ──►  Node/Express backend (Render)  ──►  Gemini (function calling)
                          │
                          └──►  PayPal sandbox (Orders v2: create, capture, webhook)
```

- `backend/` Express server, Gemini agent loop, PayPal client, tests
- `app/` Flutter chat app (cart card, Confirm button, PayPal approval, live status)
- `render.yaml` one-click backend deploy

## Run it locally

### 1. Backend (Node 20+)

```bash
cd backend
npm install
cp .env.example .env   # then fill it in (see below)
export $(grep -v '^#' .env | xargs)   # or set the variables however you prefer
npm start
```

The server reads real environment variables; it does not load `.env` by itself. Without `GEMINI_API_KEY` it runs a small **offline demo agent** (rule-based, same tools) so you can try the flow, and without PayPal credentials chat works but checkout returns 503. For the real project, set both.

**PayPal sandbox credentials**

1. Log in to the [PayPal Developer Dashboard](https://developer.paypal.com/dashboard/) and open *Apps & Credentials* in *Sandbox* mode.
2. Create an app and copy the **Client ID** and **Secret** into `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET`.
3. Under *Testing Tools > Sandbox Accounts*, use the default **Personal (buyer)** account to approve payments. Its email and password are shown there.

**Gemini key:** create one at [Google AI Studio](https://aistudio.google.com/apikey) and set `GEMINI_API_KEY`. `GEMINI_MODEL` defaults to `gemini-2.5-flash`.

`PUBLIC_BASE_URL` must be reachable by your browser, because PayPal redirects the buyer back to `/paypal/return` on it. Locally that is `http://localhost:3000`.

### 2. Flutter app (Flutter 3.22+)

The repo contains the Dart sources, not the generated platform folders. Generate them once:

```bash
cd app
flutter create . --project-name agentcart --org tech.monam
flutter pub get
flutter run            # pick a device, or: flutter run -d chrome
```

Platform notes:

- **Android emulator** reaches your machine at `http://10.0.2.2:3000` (the default). In `android/app/src/main/AndroidManifest.xml` add `android:usesCleartextTraffic="true"` to `<application>` for local http, and add this inside `<manifest>` so links can open:
  ```xml
  <queries>
    <intent><action android:name="android.intent.action.VIEW"/><data android:scheme="https"/></intent>
  </queries>
  ```
  For release builds also add `<uses-permission android:name="android.permission.INTERNET"/>`.
- **Web / desktop / iOS simulator** use `http://localhost:3000`.
- **Physical phone:** open the in-app settings (sliders icon) and set the backend URL to your deployed Render URL or your computer's LAN address.

## Deploy the backend to Render

1. Push this repo to GitHub and create a new *Blueprint* on Render pointing at it (it reads `render.yaml`).
2. Set `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `GEMINI_API_KEY` and `PUBLIC_BASE_URL` (your `https://<service>.onrender.com` URL).
3. Free instances sleep when idle; open `/health` a minute before a demo.

Optional webhook: add a PayPal webhook for `PAYMENT.CAPTURE.COMPLETED` pointing to `<PUBLIC_BASE_URL>/api/paypal/webhook` and set `PAYPAL_WEBHOOK_ID`. Events are accepted only after PayPal's verify-webhook-signature API returns SUCCESS.

## Tests

```bash
cd backend && npm test
```

32 tests cover pricing and shipping, the tools, the Gemini loop (with a stubbed Gemini API), PayPal request bodies (with a stubbed PayPal), and the full HTTP flow including the failure paths: unconfirmed capture, another session's cart, cancel, double capture, amount mismatch, spending limit and missing credentials. The Flutter model tests are in `app/test`.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | Status, which agent is active, whether PayPal is configured |
| GET | `/api/catalog` | Demo catalog |
| POST | `/api/chat` | `{sessionId, message, spendingLimit?}` returns `{reply, cart, trace}` |
| GET | `/api/carts/:id?sessionId=` | Cart status |
| POST | `/api/carts/:id/confirm` | `{sessionId}` creates the PayPal order, returns `approvalUrl` |
| GET | `/paypal/return`, `/paypal/cancel` | PayPal redirect targets (capture happens on return) |
| POST | `/api/paypal/webhook` | Verified PayPal webhook |

## Tools used (for the Devpost form)

- **Gemini** (`gemini-2.5-flash` by default) with function calling: interprets the request and decides which catalog tool to call.
- **PayPal Orders v2 API (sandbox)**: create order with item breakdown, buyer approval via redirect, capture, and webhook verification.
- **Render**: hosts the backend.
- **Flutter**: mobile and web client.

## Known limits

- State is in memory, so carts are lost on restart. Swap `backend/src/store.js` for Firestore or Postgres to persist.
- The demo catalog is fixed (`backend/src/catalog.js`), including a deliberately out-of-stock item.
- Sessions are random IDs created by the app. That is enough to keep one user's carts from another's in a demo, but it is not real authentication. Add Firebase Auth or similar before anything real.
- The offline agent exists for development and tests; it is not the AI feature.

## License

MIT, see [LICENSE](LICENSE).
