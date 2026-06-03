+++
date = '2026-06-03T18:30:00+07:00'
draft = false
translationKey = 'hermes-litellm-authelia-control-plane'
title = 'Building a Public LiteLLM API with a LAN-Only Authelia Control Plane'
description = 'A homelab debugging story about exposing LiteLLM for API use while keeping the admin UI behind LAN-only Authelia OIDC, after setting up Hermes Dashboard and breaking Traefik more than once.'
tags = ["hermes-agent", "litellm", "authelia", "oidc", "traefik", "cloudflare", "homelab", "sso", "docker", "debugging"]
categories = ["homelab", "infrastructure", "automation"]
+++

# Building a Public LiteLLM API with a LAN-Only Authelia Control Plane

**Subtitle:** Hermes Dashboard, Traefik, Authelia OIDC, and the small typo that made LiteLLM SSO look much more cursed than it was.

![Traefik Proxy](./images/icons/traefik-proxy.svg) ![Cloudflare](./images/icons/cloudflare.svg) ![Docker](./images/icons/docker.svg) ![Authelia](./images/icons/authelia.svg) ![LiteLLM](./images/icons/litellm.svg)

The cast of tools was very homelab-coded: Hermes Agent for the control surface, Traefik for routing, Cloudflare tunnel for public reachability, Authelia for SSO, Docker for the runtime boundary, and LiteLLM for the public model API.

This started as a simple goal:

> Make the Hermes Dashboard reachable from the LAN, then make LiteLLM usable as a public API endpoint while keeping the admin UI behind local SSO.

That sounds clean. Public data plane, private control plane:

```text
Public services
  -> https://litellm.umi4.life/v1/...
  -> LiteLLM API keys

Admin browser on LAN/VPN
  -> https://litellm.umi4.life/ui
  -> LiteLLM OIDC login
  -> LAN-only Authelia
```

The actual journey was less clean.

We set up the Hermes Dashboard, broke access by binding it to localhost, fixed it to listen on the LAN, added a watchdog, moved to LiteLLM SSO, broke Traefik assumptions, broke Authelia OIDC in several different ways, and finally found the one endpoint typo that made the whole flow fail at the callback step.

Interesting. Version 1 produced data. Version 2 produced more data. Version 3 finally stopped being rude.

---

## Step 1 — Hermes Dashboard needed to listen beyond localhost

The first issue was not exotic. Hermes Dashboard was running, but only on the loopback interface:

```text
127.0.0.1:9119
```

That works from inside the VM. It does not work from a browser elsewhere on the LAN.

The fix was to start the dashboard on all interfaces:

```text
0.0.0.0:9119
```

![Hermes Dashboard after it became reachable from the LAN. Recent session details are redacted.](./images/hermes-dashboard-redacted.png)

Then the dashboard became reachable from the Hermes VM's LAN IP. A small watchdog script was added so the dashboard could stay boring: silent when healthy, noisy only when it failed to start.

The useful lesson here was not “dashboards are hard.” It was this:

> In a VM, `localhost` means the VM, not your laptop, not your browser, and not the rest of the homelab.

Mou... obvious after the fact. Most infrastructure bugs are.

---

## Step 2 — LiteLLM needed two different security stories

The LiteLLM goal was intentionally split:

1. **API access should be public** so services can call local models through a stable endpoint.
2. **Admin UI access should be private** so configuration requires LAN/VPN plus SSO.

That means this is acceptable:

```text
curl https://litellm.umi4.life/v1/models \
  -H "Authorization: Bearer {LITELLM_API_KEY}"
```

But this should not be freely usable from the public internet:

```text
https://litellm.umi4.life/ui
```

This part was intentional, not accidental. The security model was: any service may use the local LLM through API keys, but nobody should be able to configure the gateway unless their browser is connected to the LAN/VPN and can complete the Authelia SSO flow.

So the current “I can’t access LiteLLM UI from outside the LAN” behavior is not always a bug. For the admin UI, it is the desired failure mode. Public API traffic is allowed; public control-plane access is not.

![A public-facing route returning a plain 404 while the underlying routing story was being debugged.](./images/404-homepage.png)

The intended shape became:

```text
Cloudflare tunnel
  -> Traefik
  -> LiteLLM API/UI host

LAN/VPN admin browser
  -> LiteLLM UI
  -> Authelia OIDC
  -> auth.umi4.life on LAN only
```

![Traefik dashboard showing the router table. The broad service inventory is redacted; the interesting rows were auth, Hermes, LiteLLM, and the broken homepage route.](./images/traefik-dashboard-redacted.png)

This is a valid pattern: public API, private control plane.

It is also where OIDC starts being picky.

---

## Step 3 — OIDC needs both browser reachability and backend reachability

Authelia reverse-proxy auth already worked for other LAN services like Coder and Hermes. That made the LiteLLM failure look suspicious at first.

But those services used a different auth shape:

```text
Browser -> service -> Traefik forward-auth -> Authelia
```

LiteLLM OIDC uses this shape:

```text
Browser -> LiteLLM UI
Browser -> Authelia authorization endpoint
Authelia -> browser callback to LiteLLM
LiteLLM backend -> Authelia token endpoint
LiteLLM backend -> Authelia userinfo endpoint
```

That last part matters. LiteLLM itself must be able to reach Authelia, not just the browser. When it could not resolve the private issuer hostname, the callback path failed with the very unhelpful-looking but actually precise error:

```text
httpx.ConnectError: [Errno -2] Name or service not known
```

That was not LDAP. It was not the user's password. It was the LiteLLM container failing to resolve the Authelia issuer hostname during the server-side OIDC exchange.

Because Authelia was intentionally LAN-only, the solution was not “publish Authelia to the internet.” The solution was to make LAN/VPN clients and the LiteLLM container resolve the same issuer hostname correctly:

```text
auth.umi4.life -> LAN Traefik IP
```

For the LiteLLM container, that can be forced with Docker Compose:

```yaml
extra_hosts:
  - "auth.umi4.life:{TRAEFIK_LAN_IP}"
```

Then the container must be recreated, not merely restarted:

```bash
docker compose up -d --force-recreate litellm
```

---

## Step 4 — The HTTPS redirect problem

Early in the debugging, LiteLLM generated redirects with `http://` instead of `https://`.

That is fatal for OIDC because the redirect URI must match exactly.

The public callback was supposed to be:

```text
https://litellm.umi4.life/sso/callback
```

Not:

```text
http://litellm.umi4.life/sso/callback
```

The fix was to make LiteLLM know its public URL and trust forwarded proxy headers:

```yaml
PROXY_BASE_URL: "https://litellm.umi4.life"
FORWARDED_ALLOW_IPS: "*"
```

One small YAML trap appeared here too. This is wrong:

```yaml
FORWARDED_ALLOW_IPS: *
```

YAML treats `*` as an alias marker. It needs quotes:

```yaml
FORWARDED_ALLOW_IPS: "*"
```

A useful sanity check was the UI config endpoint. Once the proxy settings were correct, it reported the public URL correctly:

```json
{
  "proxy_base_url": "https://litellm.umi4.life",
  "auto_redirect_to_sso": true,
  "admin_ui_disabled": false,
  "sso_configured": true
}
```

After that, `/ui` redirecting to `/ui/` was no longer a bug. That 307 is normal.

---

## Step 5 — Authelia rejected the token exchange

The next failure appeared in Authelia logs:

```text
method=POST path=/api/oidc/token
error="invalid X-Forwarded-Proto header value 'http'"
```

That looked like an Authelia client problem, but the real issue was routing.

LiteLLM was calling an internal HTTP Authelia endpoint. Authelia's issuer was HTTPS, so the token request arrived with the wrong effective scheme.

The fix was to keep the OIDC endpoints on the HTTPS issuer hostname:

```yaml
GENERIC_AUTHORIZATION_ENDPOINT: "https://auth.umi4.life/api/oidc/authorization"
GENERIC_TOKEN_ENDPOINT: "https://auth.umi4.life/api/oidc/token"
GENERIC_USERINFO_ENDPOINT: "https://auth.umi4.life/api/oidc/userinfo"
```

Not internal HTTP URLs like:

```text
http://192.168.x.x:9091/api/oidc/token
```

If the hostname is LAN-only, use split DNS or Docker `extra_hosts`, but keep the URL as HTTPS with the issuer hostname.

---

## Step 6 — Minimal containers do not have friendly tools

At one point, the LiteLLM container could not run:

```bash
docker exec litellm getent hosts auth.umi4.life
```

because `getent` did not exist in the image.

A Python fallback works, but only if stdin is attached with `-i`:

```bash
docker exec -i litellm python - <<'PY'
import socket
print(socket.getaddrinfo("auth.umi4.life", 443))
PY
```

Without `-i`, the command may appear to do nothing because the heredoc never reaches the Python process inside the container.

This was one of those tiny operational mistakes that looks like the system is haunted. It was not haunted. The command was incomplete.

---

## Step 7 — The final bug was a copy-paste endpoint typo

After fixing routing, DNS, HTTPS, and Authelia client settings, LiteLLM still returned an internal server error at the callback URL:

```text
GET /sso/callback?code=... -> 500 Internal Server Error
```

In the browser it looked like this was still an OIDC or Authelia problem. In reality, LiteLLM had already received the code and was failing after that.

The bad line was this:

```yaml
GENERIC_USERINFO_ENDPOINT: "https://auth.umi4.life/api/oidc/token"
```

That endpoint is for token exchange, not profile lookup.

The correct line is:

```yaml
GENERIC_USERINFO_ENDPOINT: "https://auth.umi4.life/api/oidc/userinfo"
```

Once that was fixed, the flow worked.

The working LiteLLM shape became:

```yaml
environment:
  SSO_ENABLED: "true"
  AUTO_REDIRECT_UI_LOGIN_TO_SSO: "true"
  DISABLE_ADMIN_UI_AUTH: "false"

  GENERIC_CLIENT_ID: "litellm"
  GENERIC_CLIENT_SECRET: "{PLAINTEXT_SECRET_MATCHING_AUTHELIA_HASH}"

  GENERIC_AUTHORIZATION_ENDPOINT: "https://auth.umi4.life/api/oidc/authorization"
  GENERIC_TOKEN_ENDPOINT: "https://auth.umi4.life/api/oidc/token"
  GENERIC_USERINFO_ENDPOINT: "https://auth.umi4.life/api/oidc/userinfo"

  PROXY_BASE_URL: "https://litellm.umi4.life"
  FORWARDED_ALLOW_IPS: "*"
```

Authelia used a confidential OIDC client:

```yaml
identity_providers:
  oidc:
    clients:
      - client_id: litellm
        client_name: "LiteLLM Proxy"
        client_secret: "{ARGON2_HASH_OF_LITELLM_PLAINTEXT_SECRET}"
        public: false
        authorization_policy: one_factor
        consent_mode: implicit
        token_endpoint_auth_method: client_secret_basic
        redirect_uris:
          - https://litellm.umi4.life/sso/callback
        scopes:
          - openid
          - profile
          - email
        grant_types:
          - authorization_code
        response_types:
          - code
        require_pkce: false
```

Authelia 4.39 also warned about older field names:

```text
id -> client_id
description -> client_name
secret -> client_secret
issuer_private_key -> jwks
```

Those warnings were useful cleanup notes, but they were not the main blocker.

---

## The final workflow

The final behavior is exactly what we wanted:

```text
Public internet:
  LiteLLM API works with API keys.
  Admin UI cannot be configured without completing SSO.

LAN/VPN:
  Admin browser reaches LiteLLM UI.
  LiteLLM redirects to LAN-only Authelia.
  Authelia completes OIDC.
  LiteLLM UI opens with admin auth.
```

This keeps the useful part public and the dangerous part local.

Or, more simply:

> Public data plane. Private control plane.

---

## What this debugging session taught

The failures were not random. They were layered:

1. Hermes Dashboard was bound to localhost.
2. LiteLLM needed its public base URL.
3. YAML needed `"*"`, not `*`.
4. Authelia OIDC needed exact redirect URIs.
5. LiteLLM needed HTTPS issuer endpoints, not internal HTTP endpoints.
6. The LiteLLM container needed LAN DNS or `extra_hosts` for the private issuer.
7. The userinfo endpoint had to be `/api/oidc/userinfo`, not `/api/oidc/token`.

Each failure was useful once isolated.

That is the homelab rhythm: break one assumption, read the logs, make a smaller hypothesis, test again.

Yoshi. The chart was cursed, but the final architecture is clean.
