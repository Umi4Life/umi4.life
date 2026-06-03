+++
date = '2026-06-03T18:30:00+07:00'
draft = false
translationKey = 'hermes-litellm-authelia-control-plane'
title = 'ทำ LiteLLM API สาธารณะ พร้อม Control Plane ผ่าน Authelia เฉพาะ LAN'
description = 'บันทึกการ debug homelab ตั้งแต่ Hermes Dashboard, Traefik, Authelia OIDC จนถึง LiteLLM workflow ที่ให้ API ใช้สาธารณะ แต่ admin UI ต้องเข้า LAN และผ่าน SSO'
tags = ["hermes-agent", "litellm", "authelia", "oidc", "traefik", "cloudflare", "homelab", "sso", "docker", "debugging"]
categories = ["homelab", "infrastructure", "automation"]
+++

# ทำ LiteLLM API สาธารณะ พร้อม Control Plane ผ่าน Authelia เฉพาะ LAN

**คำบรรยาย:** จาก Hermes Dashboard ไปถึง Traefik, Authelia OIDC และ LiteLLM SSO ที่พังเพราะ endpoint เล็ก ๆ หนึ่งบรรทัด

โพสต์นี้เริ่มจากเป้าหมายที่ดูง่ายมาก:

> เปิด Hermes Dashboard ให้เข้าจาก LAN ได้ แล้วทำให้ LiteLLM ใช้เป็น public API ได้ โดยที่ admin UI ยังต้องผ่าน SSO ใน LAN/VPN เท่านั้น

ภาพรวมที่ต้องการคือ:

```text
Public services
  -> https://litellm.umi4.life/v1/...
  -> LiteLLM API keys

Admin browser on LAN/VPN
  -> https://litellm.umi4.life/ui
  -> LiteLLM OIDC login
  -> LAN-only Authelia
```

พูดสั้น ๆ คือ public data plane แต่ private control plane

ฟังดูสะอาด แต่ของจริงคือเราไล่แก้ทีละชั้น: Hermes Dashboard bind อยู่แค่ localhost, Traefik/HTTPS header ทำให้ OIDC redirect เพี้ยน, Authelia reject token exchange, Docker container resolve hostname ไม่ได้ และสุดท้าย LiteLLM callback พังเพราะ `GENERIC_USERINFO_ENDPOINT` ชี้ผิด endpoint

---

## Hermes Dashboard: localhost ไม่ใช่ LAN

ปัญหาแรกตรงไปตรงมา: Hermes Dashboard รันอยู่ที่

```text
127.0.0.1:9119
```

จากใน VM มันใช้ได้ แต่ browser เครื่องอื่นใน LAN เข้าไม่ได้ เพราะ `localhost` คือใน VM เอง

ทางแก้คือให้ dashboard listen ที่:

```text
0.0.0.0:9119
```

หลังจากนั้นก็เพิ่ม watchdog แบบเงียบ ๆ: ถ้าปกติไม่ต้องพูดอะไร ถ้า dashboard start ไม่ขึ้นค่อยแจ้งเตือน

---

## LiteLLM ต้องมี security สองชั้น

LiteLLM workflow ที่ต้องการคือ:

1. API endpoint เปิด public ได้ เพื่อให้ service อื่นเรียก local LLM ผ่าน API key
2. Admin UI ต้องไม่เปิด config ให้ใครก็ได้ ต้องเข้า LAN/VPN และผ่าน Authelia SSO

ดังนั้น public API แบบนี้โอเค:

```text
curl https://litellm.umi4.life/v1/models \
  -H "Authorization: Bearer {LITELLM_API_KEY}"
```

แต่ admin UI แบบนี้ต้องไม่ใช่ของที่คนข้างนอกใช้งานได้ทันที:

```text
https://litellm.umi4.life/ui
```

นี่เป็น pattern ที่ตั้งใจ: API ใช้ public ได้ แต่ control plane อยู่ใน LAN

---

## OIDC ไม่เหมือน forward-auth ธรรมดา

Service อื่นอย่าง Coder หรือ Hermes ใช้ Authelia แบบ reverse-proxy/forward-auth แล้วทำงานได้ดี แต่นั่นไม่เหมือน LiteLLM OIDC

forward-auth โดยประมาณคือ:

```text
Browser -> service -> Traefik forward-auth -> Authelia
```

แต่ LiteLLM OIDC คือ:

```text
Browser -> LiteLLM UI
Browser -> Authelia authorization endpoint
Authelia -> browser callback to LiteLLM
LiteLLM backend -> Authelia token endpoint
LiteLLM backend -> Authelia userinfo endpoint
```

จุดสำคัญคือ LiteLLM container เองต้องเรียก Authelia ได้ด้วย ไม่ใช่แค่ browser เข้าได้

เพราะ Authelia ตั้งใจให้เป็น LAN-only เลยต้องให้ทั้ง browser ฝั่ง LAN/VPN และ LiteLLM container resolve hostname เดียวกันได้ เช่น:

```text
auth.umi4.life -> LAN Traefik IP
```

ใน Docker Compose อาจใช้:

```yaml
extra_hosts:
  - "auth.umi4.life:{TRAEFIK_LAN_IP}"
```

แล้วต้อง recreate container:

```bash
docker compose up -d --force-recreate litellm
```

---

## HTTPS, forwarded headers, และ YAML `*`

ช่วงหนึ่ง LiteLLM สร้าง redirect เป็น `http://` แทน `https://` ซึ่งทำให้ OIDC พัง เพราะ redirect URI ต้อง match แบบเป๊ะ ๆ

ค่าที่ช่วยคือ:

```yaml
PROXY_BASE_URL: "https://litellm.umi4.life"
FORWARDED_ALLOW_IPS: "*"
```

กับดักคือ YAML ต้อง quote `*`:

```yaml
# wrong
FORWARDED_ALLOW_IPS: *

# right
FORWARDED_ALLOW_IPS: "*"
```

หลังจากแก้แล้ว `/ui` redirect ไป `/ui/` ด้วย 307 เป็นเรื่องปกติ ไม่ใช่ bug

---

## Authelia reject token exchange เพราะ path เป็น HTTP

Authelia เคย log ว่า:

```text
method=POST path=/api/oidc/token
error="invalid X-Forwarded-Proto header value 'http'"
```

ตอนแรกดูเหมือน client config ผิด แต่จริง ๆ คือ LiteLLM เรียก Authelia ผ่าน internal HTTP path

สำหรับ OIDC issuer ที่เป็น HTTPS ควรใช้ hostname เดียวกันใน endpoint:

```yaml
GENERIC_AUTHORIZATION_ENDPOINT: "https://auth.umi4.life/api/oidc/authorization"
GENERIC_TOKEN_ENDPOINT: "https://auth.umi4.life/api/oidc/token"
GENERIC_USERINFO_ENDPOINT: "https://auth.umi4.life/api/oidc/userinfo"
```

ไม่ใช่:

```text
http://192.168.x.x:9091/api/oidc/token
```

ถ้า hostname เป็น LAN-only ก็แก้ด้วย split DNS หรือ `extra_hosts` แทน แต่ URL ยังควรเป็น HTTPS issuer hostname

---

## Container minimal image ไม่มี `getent`

LiteLLM image ไม่มี `getent` เลยใช้คำสั่งนี้ไม่ได้:

```bash
docker exec litellm getent hosts auth.umi4.life
```

ใช้ Python ได้ แต่ต้องมี `-i` ไม่งั้น heredoc อาจไม่เข้าไปใน container:

```bash
docker exec -i litellm python - <<'PY'
import socket
print(socket.getaddrinfo("auth.umi4.life", 443))
PY
```

รายละเอียดเล็กมาก แต่ตอน debug จริงทำให้สถานการณ์ดูงงได้ง่าย

---

## Bug สุดท้าย: userinfo endpoint ชี้ผิด

หลังจากแก้ proxy, DNS, HTTPS และ Authelia client แล้ว LiteLLM ยังพังที่ callback:

```text
https://litellm.umi4.life/sso/callback?code=...
```

บรรทัดที่ผิดคือ:

```yaml
GENERIC_USERINFO_ENDPOINT: "https://auth.umi4.life/api/oidc/token"
```

`/token` ใช้แลก code เป็น token ไม่ใช่ endpoint สำหรับดึง user profile

ค่าที่ถูกคือ:

```yaml
GENERIC_USERINFO_ENDPOINT: "https://auth.umi4.life/api/oidc/userinfo"
```

หลังจากแก้ตรงนี้ flow ก็ทำงาน

---

## สรุป workflow ที่ได้

ผลลัพธ์สุดท้ายตรงกับที่ต้องการ:

```text
Public internet:
  LiteLLM API ใช้ได้ผ่าน API key
  Admin UI config ไม่สำเร็จถ้าไม่ผ่าน SSO

LAN/VPN:
  Browser เข้า LiteLLM UI ได้
  LiteLLM redirect ไป Authelia OIDC
  Authelia ออก code กลับมา
  LiteLLM แลก token และเรียก userinfo สำเร็จ
```

นี่คือ public API + private admin control plane ที่ตั้งใจไว้ตั้งแต่แรก

เรื่องนี้สอนซ้ำอีกครั้งว่า homelab debugging ไม่ได้พังแบบสุ่ม มันพังเป็นชั้น ๆ:

1. Dashboard bind localhost
2. Public base URL / forwarded headers ผิด
3. YAML `*` ไม่ quote
4. OIDC redirect URI ต้อง match เป๊ะ
5. Token endpoint ต้องใช้ HTTPS issuer hostname
6. Container ต้อง resolve hostname ของ Authelia ได้
7. Userinfo endpoint ต้องเป็น `/api/oidc/userinfo`

พอแยกทีละชั้น ทุก failure ก็กลายเป็นข้อมูลสำหรับ Version ถัดไป
