# OTP One-Way WebRTC Signaling Server

This backend is a signaling server for a one-way monitoring flow. The target user must accept the request, then enable mic/camera on their own device. Only then does WebRTC signaling start.

## Quick Start

```bash
npm install
npm run start
```

Open the browser test page in two tabs:

```
http://localhost:3000/test.html
```

For development with auto-reload:

```bash
npm run dev
```

## Environment

- `PORT` (default: 3000)
- `CORS_ORIGIN` (default: `*`)
- `REQUEST_TIMEOUT_MS` (default: 60000)

## Socket Flow (One-Way)

1. **Register**
   - Client emits `register-user` (payload: `{ otp }` from device, or omit to let server create)
   - Server emits `registered` with `{ otp }`

2. **Request**
   - Requester emits `monitor-request` with `{ targetOtp }`
   - Server emits `incoming-request` to target: `{ sessionId, fromOtp }`
   - Server emits `request-sent` to requester: `{ sessionId, targetOtp }`

3. **Target Accept/Reject**
   - Target emits `target-response` with `{ sessionId, accept: true|false }`
   - Server emits `request-accepted` or `request-rejected` to requester

4. **Target Media Ready**
   - Target enables mic/camera locally, then emits `target-ready` with `{ sessionId }`
   - Server emits `target-ready` to requester

5. **WebRTC Signaling**
   - Target sends `offer` with `{ sessionId, offer }`
   - Requester sends `answer` with `{ sessionId, answer }`
   - Both sides exchange `ice-candidate` with `{ sessionId, candidate }`

6. **Optional State Updates**
   - Target emits `mute-audio` with `{ sessionId, muted }`
   - Target emits `toggle-video` with `{ sessionId, videoEnabled }`

7. **End Session**
   - Either side emits `end-session` or `leave-room` with `{ sessionId }`
   - Server emits `session-ended` to both sides

## Browser Test (Two Tabs)

1. Open two tabs at `http://localhost:3000/test.html`.
2. Tab A select role `Requester`.
3. Tab B select role `Target`.
4. Both click **Register** to get OTPs.
5. Tab A enters Tab B OTP and clicks **Send Request**.
6. Tab B clicks **Accept**.
7. Tab B clicks **Start Camera & Send Offer**.
8. Tab A should see and hear Tab B (one-way).

If audio is muted by the browser, click on the page once to allow audio playback.

If you see `NotFoundError: Requested device not found`, choose **Audio only** in the test page or check that a camera/mic is available and not in use.

## Error Events

All errors are emitted as `error-message` with:

```json
{ "code": "ERROR_CODE", "message": "Human readable message" }
```

## Important Notes

- OTPs are stored in memory. A server restart clears all OTPs and sessions.
- If your app generates OTP on install, send it in `register-user`. Handle `OTP_IN_USE` by generating a new OTP and retrying.
- No media is ever sent through the server. This is signaling only.
- No stream starts without target accept + target-ready.

## Render Deploy (Free)

1. Push this repo to GitHub.
2. Go to https://render.com → New → Web Service → Connect GitHub repo.
3. Configure:
   - **Build Command**: leave blank (or `npm install`)
   - **Start Command**: `npm start`
   - **Environment Variables**:
     - `CORS_ORIGIN`: `*` (or your frontend URL)
     - `NODE_ENV`: `production` (optional, for better logging)
4. Deploy. Render assigns a public URL (e.g. `https://your-service.onrender.com`).
5. Open: `https://your-service.onrender.com/test.html` in your browser.
6. Use the Render URL as your Socket.io endpoint in Flutter.

## Railway Deploy (Free)

1. Push this repo to GitHub.
2. Create a new Railway project from the repo.
3. Railway will run `npm install` and `npm start`.
4. Set env var `CORS_ORIGIN` (e.g. `*`).
5. Use the Railway app URL as your Socket.io endpoint in Flutter.

## Recommended TURN

For better connectivity across strict NATs/firewalls, add TURN credentials in the Flutter WebRTC configuration.

## Do You Need a Database?

No database is required if OTPs are generated on the device and only need to be valid while the server is running. If you need OTPs to survive server restarts or want login/history, add a database or Redis.
