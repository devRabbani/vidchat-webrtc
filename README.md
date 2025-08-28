## Vidchat WebRTC

Simple video chat in the browser using WebRTC for media and Firestore for signaling.

### Setup
1) Copy `.env.example` to `.env.local` and fill Firebase keys.
2) (Optional) Add TURN for reliability:
   - `NEXT_PUBLIC_TURN_URLS=turns:your.turn.server:5349`
   - `NEXT_PUBLIC_TURN_USERNAME=...`
   - `NEXT_PUBLIC_TURN_CREDENTIAL=...`

### Dev
```
pnpm install
pnpm dev
```

Open `http://localhost:3000`.

### Use
- Click New to start a call and share the link (`/?id=...`).
- Opening the link auto‑joins the call.
- Disconnect ends your session; if you’re the caller you can also remove the room.

### Notes
- Use HTTPS in production (required for camera/mic).
- You can add a TTL policy on `expiresAt` to auto‑clean rooms.
