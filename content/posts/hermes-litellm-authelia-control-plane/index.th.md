+++
date = '2026-06-03T18:30:00+07:00'
draft = false
translationKey = 'hermes-litellm-authelia-control-plane'
title = 'Untangling Homelab หลังตั้ง Hermes Dashboard แล้วพังเป็นลูกโซ่'
description = 'บันทึก incident จากการตั้ง Hermes Dashboard ที่ลาก tech debt ใน homelab ออกมาให้เห็น ตั้งแต่ Traefik, Authelia OIDC, split DNS จนถึง LiteLLM workflow ที่แยก public API กับ private admin UI'
tags = ["hermes-agent", "litellm", "authelia", "oidc", "traefik", "cloudflare", "homelab", "sso", "docker", "debugging"]
categories = ["homelab", "infrastructure", "automation"]
cover = 'https://raw.githubusercontent.com/Umi4Life/umi4.life/refs/heads/master/content/posts/hermes-litellm-authelia-control-plane/images/hermes-dashboard-redacted.png'
banner = 'https://raw.githubusercontent.com/Umi4Life/umi4.life/refs/heads/master/content/posts/hermes-litellm-authelia-control-plane/images/hermes-dashboard-redacted.png'
+++

**คำบรรยาย:** เราแค่อยากเปิด Hermes Dashboard ให้เข้าจาก LAN ได้ แต่ดันไปสะกิด tech debt เก่าใน routing/auth stack จนต้องไล่แก้ปมทั้ง Traefik, Authelia OIDC, split DNS และ LiteLLM

{{< icon-row >}}
![Traefik Proxy](./images/icons/traefik-proxy.svg)
![Cloudflare](./images/icons/cloudflare.svg)
![Docker](./images/icons/docker.svg)
![Authelia](./images/icons/authelia.svg)
![LiteLLM](./images/icons/litellm.svg)
{{< /icon-row >}}

งานนี้ไม่ได้ควรจะกลายเป็น incident ใหญ่เลย

เป้าหมายแรกเล็กมาก: เปิด Hermes Dashboard ให้ browser ใน LAN เข้าได้ เพื่อให้ Hermes Agent มี web control surface ที่ใช้งานง่ายขึ้น

แต่พอเริ่มแก้จริง มันลากปมเก่าใน homelab ออกมาทีละชั้น

เริ่มจาก dashboard bind อยู่แค่ `localhost` ต่อด้วย Traefik routing assumption, HTTPS forwarded header ที่ทำให้ OIDC redirect เพี้ยน, Authelia reject token exchange, LiteLLM container resolve hostname ของ LAN-only identity provider ไม่ได้ และสุดท้าย bug ที่เล็กแต่เจ็บมาก: `GENERIC_USERINFO_ENDPOINT` ดันชี้ไปที่ `token` endpoint

สิ่งที่ได้ไม่ใช่แค่ config LiteLLM ให้ถูก แต่คือการเห็น tech debt ชัดขึ้น:

- public route กับ LAN-only route ยังไม่มี boundary ที่เขียนไว้ชัดพอ
- split DNS มี assumption ที่คนจำได้ แต่ระบบไม่ได้บอกเอง
- reverse-proxy auth กับ OIDC ถูกมองเหมือนเป็น auth flow แบบเดียวกัน ทั้งที่ไม่ใช่
- forwarded-header behavior ขึ้นกับ proxy trust ที่ต้องตั้งให้ explicit
- debug container โดยคิดว่ามี command พื้นฐานครบ ทั้งที่ image minimal มาก
- config ที่ดู “เกือบถูก” ก็ยังพังได้ถ้าผิด endpoint

ปลายทางที่ต้องการยังเหมือนเดิม:

```text
Public services
  -> https://litellm.umi4.life/v1/...
  -> LiteLLM API keys

Admin browser on LAN/VPN
  -> https://litellm.umi4.life/ui
  -> LiteLLM OIDC login
  -> LAN-only Authelia
```

แต่ story จริงไม่ใช่ “วิธีตั้ง LiteLLM” อย่างเดียว

story จริงคือ เราตั้ง Hermes Dashboard แล้วเจอ tech debt ใน homelab infra พัง Traefik/Authelia แบบได้ข้อมูล แล้วค่อย ๆ แก้ปมจน public API/private control plane กลายเป็น design ที่ตั้งใจ ไม่ใช่ของที่บังเอิญใช้ได้

---

## Step 1: Dashboard change เล็ก ๆ เปิด assumption แรก

ปัญหาแรกตรงไปตรงมา: Hermes Dashboard รันอยู่ที่

```text
127.0.0.1:9119
```

จากใน VM มันใช้ได้ แต่ browser เครื่องอื่นใน LAN เข้าไม่ได้ เพราะ `localhost` คือใน VM เอง

ทางแก้คือให้ dashboard listen ที่:

```text
0.0.0.0:9119
```

![Hermes Dashboard หลังเปิดให้เข้าจาก LAN ได้ ข้อมูล recent sessions ถูก redacted แล้ว](./images/hermes-dashboard-redacted.png)

หลังจากนั้นก็เพิ่ม watchdog แบบเงียบ ๆ: ถ้าปกติไม่ต้องพูดอะไร ถ้า dashboard start ไม่ขึ้นค่อยแจ้งเตือน

---

## Step 2: Stack ต้องมี boundary ระหว่าง public กับ private จริง ๆ

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

เหตุผลคือเรื่อง security โดยตรง: service ไหน ๆ ก็ใช้ local LLM ผ่าน API key ได้ แต่ไม่ควรมีใคร config gateway ได้ ถ้า browser ไม่ได้ต่อ LAN/VPN และผ่าน Authelia SSO ที่ตั้งไว้

ดังนั้นอาการ “เข้า LiteLLM UI จากข้างนอกไม่ได้” ไม่ได้เป็น bug เสมอไป สำหรับ admin UI มันคือ desired failure mode: API public ได้ แต่ control plane ต้อง private

![Route ที่ตอบ 404 ตอนกำลังไล่ debug routing](./images/404-homepage.png)

นี่เป็น pattern ที่ตั้งใจ: API ใช้ public ได้ แต่ control plane อยู่ใน LAN

![Traefik dashboard พร้อม router table โดย redacted รายละเอียด service inventory แล้ว](./images/traefik-dashboard-redacted.png)

---

## Step 3: OIDC เปิดให้เห็น split-DNS debt

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

จุดสำคัญคือ LiteLLM container เองต้องเรียก Authelia ได้ด้วย ไม่ใช่แค่ browser เข้าได้ ถ้า container resolve hostname ของ issuer ไม่ได้ จะเห็น error ประมาณนี้:

```text
httpx.ConnectError: [Errno -2] Name or service not known
```

อันนี้ไม่ใช่ LDAP ไม่ใช่ password แต่เป็น server-side OIDC exchange ที่ LiteLLM หา `auth.umi4.life` ไม่เจอ

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

## Step 4: Traefik/forwarded headers ทำให้ HTTPS trust ต้อง explicit

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

ตอน proxy setting ถูกแล้ว UI config จะเริ่มบอก public URL ถูกต้อง:

```json
{
  "proxy_base_url": "https://litellm.umi4.life",
  "auto_redirect_to_sso": true,
  "admin_ui_disabled": false,
  "sso_configured": true
}
```

หลังจากแก้แล้ว `/ui` redirect ไป `/ui/` ด้วย 307 เป็นเรื่องปกติ ไม่ใช่ bug

---

## Step 5: Authelia ทำให้ issuer assumption ที่ผิดโผล่ออกมา

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

## Step 6: Minimal container ทำให้วิธี debug เดิมใช้ไม่ได้

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

## Step 7: Final boss คือ endpoint ผิดหนึ่งบรรทัด

หลังจากแก้ proxy, DNS, HTTPS และ Authelia client แล้ว LiteLLM ยังพังที่ callback:

```text
GET /sso/callback?code=... -> 500 Internal Server Error
```

ตอนเห็นใน browser มันเหมือน Authelia/OIDC ยังพังอยู่ แต่จริง ๆ LiteLLM รับ code กลับมาได้แล้ว และไปตายในขั้นหลังจากนั้น

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

## Workflow สุดท้ายที่ได้

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

---

## บทเรียนจาก incident นี้

บทเรียนหลักไม่ใช่ค่า config ค่าเดียว แต่คือ homelab มี contract หลายอย่างที่ยังไม่ได้เขียนไว้ชัด พอมันพังเลยต้องไล่เดาจากอาการ

สิ่งที่ incident นี้บังคับให้เห็นคือ:

1. **Listener scope สำคัญ**: `127.0.0.1` ใน VM ไม่ใช่ LAN access
2. **Public route กับ private control plane ต้องถูก label ชัด ๆ**: ถ้าเข้าจากข้างนอกไม่ได้โดยตั้งใจ ต้องเขียนไว้ว่าเป็น desired failure mode ไม่ใช่ปล่อยให้ดูเหมือน outage
3. **Reverse-proxy auth ไม่เหมือน OIDC**: forward-auth ใช้ได้ ไม่ได้แปลว่า OIDC จะใช้ได้ เพราะ OIDC มีทั้ง browser-side และ backend-side call
4. **Split DNS เป็น infrastructure ไม่ใช่ความทรงจำ**: ถ้า `auth.umi4.life` เป็น LAN-only ทั้ง browser และ container ต้อง resolve ได้แบบ deterministic
5. **Proxy trust ต้อง explicit**: `PROXY_BASE_URL` กับ `FORWARDED_ALLOW_IPS: "*"` เป็นตัวกำหนดว่า callback จะเป็น `https://` หรือพัง
6. **Minimal container เปลี่ยนวิธี debug**: ถ้าไม่มี `getent` ต้องใช้ `docker exec -i ... python` หรือ tool อื่นที่มีจริงใน image
7. **Endpoint ที่เกือบถูกก็ยังผิด**: `/api/oidc/token` กับ `/api/oidc/userinfo` อยู่ใกล้กันมาก แต่ทำงานคนละขั้นของ flow

## สิ่งที่ควร improve รอบหน้า

Version 2 ของ workflow นี้ควรทำให้ design ที่ตั้งใจพังยากขึ้น:

- document ทุก hostname ว่าเป็น `public API`, `public app`, หรือ `LAN-only control plane`
- เก็บ split-DNS records และ Docker `extra_hosts`/network exception ไว้ใกล้ service config
- มี smoke-test script เล็ก ๆ สำหรับ service ที่ expose: public API check, LAN UI check, auth callback check
- เก็บ known-good OIDC snippet สำหรับ Authelia client และ LiteLLM env vars
- ใช้ watchdog/script ที่ reusable แทน command manual ยาว ๆ
- เขียน expected failure modes ไว้ โดยเฉพาะเคสที่ public UI access ควร fail by design

ข้อสุดท้ายสำคัญมาก เพราะ “เข้า admin UI จากข้างนอกไม่ได้” ฟังเหมือน outage จนกว่า architecture จะบอกว่ามันคือ lock ที่ตั้งใจใส่ไว้

Public data plane. Private control plane. รอบหน้าขอ spooky assumption น้อยกว่านี้หน่อย
