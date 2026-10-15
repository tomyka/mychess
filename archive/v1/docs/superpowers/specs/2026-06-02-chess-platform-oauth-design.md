# Chess Platform OAuth Ownership Verification

**Date:** 2026-06-02  
**Status:** Approved

## Problem

Chess.com and lichess usernames are stored in `profiles` but not verified. Any user can claim any username. We want proof that the user owns the account on each platform.

FIDE ID is already protected: saving a FIDE ID requires the entered first/last name to match the FIDE ratings profile. This is considered sufficient for FIDE.

## Goal

Replace manual username text fields for chess.com and lichess with OAuth 2.0 PKCE "Connect" buttons. After OAuth, the platform-verified username is stored automatically. The user cannot claim a username they do not own.

## Architecture

### New Routes

| Route | Purpose |
|---|---|
| `GET /auth/connect/chesscom` | Initiate chess.com OAuth PKCE flow |
| `GET /auth/connect/lichess` | Initiate lichess OAuth PKCE flow |
| `GET /auth/callback/chesscom` | Handle chess.com OAuth callback |
| `GET /auth/callback/lichess` | Handle lichess OAuth callback |

### OAuth Flow (per platform)

1. User clicks "Connect" button on `/settings`
2. Server route (`/auth/connect/{platform}`):
   - Generates PKCE `code_verifier` (64 random bytes, base64url-encoded)
   - Derives `code_challenge` = base64url(SHA-256(`code_verifier`))
   - Generates `state` = HMAC-signed `{user_id}:{nonce}:{timestamp}` (signed with `OAUTH_STATE_SECRET`)
   - Stores `code_verifier` in `HttpOnly Secure SameSite=Lax` cookie `oauth_pkce_verifier` (5-min TTL)
   - Redirects to platform authorization URL
3. User approves on platform, redirected to `/auth/callback/{platform}?code=...&state=...`
4. Callback route:
   - Verifies `state` HMAC and timestamp (rejects if > 5 min old)
   - Reads `code_verifier` from cookie, clears cookie
   - Exchanges `code` + `code_verifier` for access token
   - Calls platform API to fetch username
   - Updates `profiles.chesscom_username` or `profiles.lichess_username`
   - Redirects to `/settings` with success flash message
5. On any error: redirect to `/settings` with error flash message

### Platform-Specific Notes

**Lichess:**
- Public client (PKCE without client secret)
- Authorization URL: `https://lichess.org/oauth`
- Token URL: `https://lichess.org/api/token`
- Username endpoint: `GET https://lichess.org/api/account` (Bearer token) → `{ username }`
- No scope required for account identity

**Chess.com:**
- Confidential client (requires `CHESSCOM_CLIENT_SECRET`)
- Authorization URL: per chess.com OAuth docs
- Exact scopes: minimal profile read scope (confirm during implementation from chess.com developer portal)
- Username endpoint: `GET https://api.chess.com/pub/player/me` or equivalent authenticated endpoint → `{ username }`

## Database

No schema changes. `profiles.chesscom_username` and `profiles.lichess_username` columns already exist.

## Environment Variables

```
CHESSCOM_CLIENT_ID
CHESSCOM_CLIENT_SECRET
CHESSCOM_REDIRECT_URI        # e.g. https://yourdomain.com/auth/callback/chesscom
LICHESS_CLIENT_ID
LICHESS_REDIRECT_URI         # e.g. https://yourdomain.com/auth/callback/lichess
OAUTH_STATE_SECRET           # random secret for HMAC-signing state params
```

## Settings UI Changes

**Before:** Text input fields for chess.com and lichess usernames.

**After:**

- If not connected: "Connect chess.com" / "Connect lichess" button
- If connected: display verified username + "Disconnect" button
- Disconnect: POST form action that clears the column — no OAuth involvement
- Error/success messages shown inline after OAuth callback redirect

FIDE section is unchanged.

## Security

| Concern | Mitigation |
|---|---|
| CSRF on callback | `state` param HMAC-signed with `OAUTH_STATE_SECRET`, verified before token exchange |
| Code injection / replay | `code_verifier` in HttpOnly cookie; PKCE ensures code unusable without verifier |
| State replay | Timestamp embedded in state, rejected if > 5 min old |
| Cookie theft | HttpOnly + Secure + SameSite=Lax |
| FIDE ID theft | Name must match FIDE profile (existing protection, kept as-is) |

## Out of Scope

- Periodic re-validation of linked accounts
- OAuth token refresh / storing access tokens long-term (username fetched once, token discarded)
- Chess.com / lichess OAuth for any purpose other than username verification
