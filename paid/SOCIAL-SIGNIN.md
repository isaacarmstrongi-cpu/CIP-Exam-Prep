# Optional social sign-in

Email/password remains available. Provider buttons appear only when that provider is fully configured. Paid enrollment and public registration remain controlled by the existing independent launch gates. New social accounts currently require the isolated, capped friends-trial invitation.

## Operator configuration

Put credentials only in the existing root-readable service environment on the VPS. Never commit them, echo them in console output, or put them in a browser URL.

- Google: `GOOGLE_SIGNIN_ENABLED=true`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.
- Microsoft: `MICROSOFT_SIGNIN_ENABLED=true`, `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`.
- Missing flags leave a provider disabled. An enabled provider with incomplete credentials refuses startup.
- The redirect URI is exactly `PUBLIC_ORIGIN` + `PUBLIC_BASE` + `/api/social/google/callback` (or `/microsoft/callback`). Register exact HTTPS addresses, no wildcards. The trial and paid portal use distinct base paths and cookies.
- Microsoft is restricted to personal accounts through its `consumers` issuer. Do not register under an unrelated organizational directory. Microsoft setup is deferred by the owner; leave its flag absent/false.
- Google requests only `openid email`. If the provider consent configuration is still in Testing, only explicitly listed test users can sign in. Check provider publishing requirements before enabling for invited friends. Provider publishing does not open this application's trial capacity or paid enrollment.

## Account safeguards

The OpenID Connect library checks issuer, audience, signature, nonce and state. Every authorization uses PKCE. A separate HttpOnly, SameSite=Lax, ten-minute cookie binds the redirect to the initiating browser; ordinary account sessions remain SameSite=Strict. One-time state records include only the minimal server context and PKCE material. Tokens issued by providers are not persisted.

The stable provider/issuer/subject tuple identifies an account. Matching email alone never connects existing accounts. Learners must sign into their original account, verify its contact email and explicitly connect an additional provider within ten minutes of authentication. The original session must still be valid at callback. Provider identity collisions and replacement of an already-connected identity are rejected.

New learners confirm their contact email after provider sign-in. Verified Gmail or Workspace email can satisfy contact verification only when unchanged. Other addresses, including Microsoft addresses, require this service's verification email. An address omitted by the provider can be entered during completion. A provider-only account has no usable local password; verified recovery can establish one. Password reset revokes all sessions.

Trial access, account and provider identity are created together in one database transaction. The invitation is rechecked after the redirect, including capacity and revocation; opening provider sign-in does not reserve a place. Returning sign-in does not extend access or reset progress. Operator alerts use the same existing trial event records.

Connected method names/dates are included only in the account owner's export; subjects, credential material and security proofs are excluded. Identity records retire with the account. Expired security records are purged during sign-in activity and scheduled retention. Backups contain these private tables and follow existing restricted backup handling.

## Verification and release

`npm test` exercises real RSA-signed synthetic ID tokens through the installed library, invalid signatures/audience/nonce/state, personal Microsoft tenant constraints, redirect/browser replay, account collisions, recent-auth linking, trial capacity, contact verification, password recovery, exports, retention and HTTP routes. Synthetic checks do not prove a live provider registration works.

Before enabling a provider, run the existing checks, deploy the exact committed release with the trusted checksum-verifying deployer, install the approved credential privately, and complete a real provider sign-in. Use an existing isolated test account for explicit linking to avoid consuming any of the five real invitation places. Confirm the same account/progress after returning. Check that paid sales remain closed. If any provider fails, turn off that provider flag and preserve email signup.

## Primary references and brand asset

- [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect)
- [Google sign-in branding](https://developers.google.com/identity/branding-guidelines)
- [Microsoft OpenID Connect](https://learn.microsoft.com/en-us/entra/identity-platform/v2-protocols-oidc)
- [Microsoft developer directory requirements](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-create-new-tenant)
- [openid-client](https://github.com/panva/openid-client)

`google-signin.png` is the unmodified Google-provided Light/Pill, Android+Web, 2x sign-in button from the approved [asset bundle](https://developers.google.com/static/identity/images/signin-assets.zip), retrieved October 16, 2026. Keep its aspect ratio and colors; do not replace its logo with an invented mark. It is served locally without sending a tracking request to Google before a learner chooses sign-in.
