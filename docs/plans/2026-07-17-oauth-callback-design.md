# OAuth callback repair

## Cause

Loom returns the correct `302` callback, but its authorization-page CSP limits
`form-action` to `'self'`. Chromium blocks the cross-origin ChatGPT callback
after the password form posts. DevSpace does not impose that restriction.

## Design

- Keep existing server-side form and `302` OAuth flow.
- Add only the validated redirect URI origin to `form-action`; keep
  `default-src 'none'`, inline styles, frame denial, no-referrer, and no-store.
- Keep page plain: system font, neutral adaptive colors, one card, one password
  field, one button, no scripts, remote assets, gradients, or animation.
- Preserve client, scope, resource, warning, and escaped error details.

## Verification

- Regression test proves CSP contains the exact callback origin, not its path.
- Regression test proves successful authorization returns `302` with code and
  state on the registered callback.
- Existing OAuth security, full workspace, package, and live public checks pass.
