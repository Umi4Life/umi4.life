+++
date = '2026-06-04T00:00:22+07:00'
draft = false
translationKey = 'hermes-nas-storage'
title = 'Hermes NAS Storage สำหรับไฟล์ประกอบเอกสาร'
description = 'เมานต์ TrueNAS dataset ผ่าน NFS เพื่อให้ Hermes เก็บสื่อสำหรับบล็อกและเอกสารได้โดยไม่ทำให้ดิสก์ของ VM เต็ม'
tags = ["truenas", "nfs", "proxmox", "homelab", "hermes-agent", "documentation"]
categories = ["homelab"]
+++

> **หมายเหตุสำหรับผู้ดูแล:** IP ภายในและค่า UID/GID ในโพสต์นี้เป็น placeholder สำหรับบทความสาธารณะ ช่องในตารางใช้ marker แบบ `{NAS_IP}` — ให้แทนด้วยค่าของระบบคุณเองก่อน copy-paste

## เป้าหมาย

Hermes สร้างและจัดการเอกสารที่มักมีไฟล์ประกอบหลายแบบ เช่น:

- Screenshots
- รูปถ่าย
- Screen recordings
- รูปภาพที่ render แล้ว
- Diagram ที่ generate ขึ้นมา
- Media assets สำหรับบล็อก

ถ้าเก็บไฟล์เหล่านี้ไว้บน VM โดยตรง สุดท้ายจะกินพื้นที่ local disk และทำให้การจัดการ backup ซับซ้อนขึ้น

เป้าหมายคือให้ Hermes เข้าถึง storage กลางบน TrueNAS ได้ แต่ยังใช้งานจากฝั่ง agent เหมือนเป็น directory ปกติบนเครื่อง local

Workflow ที่ต้องการ:

```text
Hermes VM
    ↓
/mnt/truenas/hermes
    ↓ (NFS)
TrueNAS Dataset
/mnt/lamia/data/hermes
```

งานนี้ไม่ได้ตั้งใจให้เป็น NAS mount แบบ shared ทั่วไป Hermes เป็น writer เดียวของ dataset นี้ ดังนั้นผมเลือกใช้ Unix ownership แบบตรงไปตรงมา แทน ACL หรือ NFS identity mapping ส่วน subfolder `docs-media` ด้านล่างเป็น workaround ชั่วคราวเท่านั้น การตั้ง UID/GID ของ dataset ให้ตรงกับ service user ของ Hermes คือ fix ระยะยาวที่ตั้งใจไว้

---

## Environment

### Infrastructure

| Component | Value |
| --- | --- |
| Proxmox host | `tsukishiro` |
| TrueNAS VM | TrueNAS VM |
| TrueNAS IP | `{NAS_IP}` |
| Hermes VM IP | `{HERMES_VM_IP}` |

### Storage layout

| Role | Path |
| --- | --- |
| TrueNAS dataset | `/mnt/lamia/data/hermes` |
| NFS export | `{NAS_IP}:/mnt/lamia/data/hermes` |
| Hermes mount point | `/mnt/truenas/hermes` |
| Hermes user | `uid={HERMES_UID}(hermes)`, `gid={HERMES_GID}(hermes)` |

---

## ปัญหา

### Local VM storage ไม่เหมาะกับ media assets

เดิมที Hermes ทำงานทั้งหมดจาก storage ภายใน VM

สำหรับ application data และ source repositories ถือว่าเพียงพอ แต่ documentation assets โตเร็วได้มาก: รูปโปรเจกต์, screenshots, videos, exported renders, และ generated media ไฟล์พวกนี้เหมาะกับ NAS storage มากกว่า

### การ mount NFS ครั้งแรกไม่สำเร็จ

การ mount ครั้งแรก failed ด้วยข้อความ:

```text
mount: /mnt/truenas/hermes: fsconfig() failed: NFS: mount program didn't pass remote address.
```

อาการนี้ชี้ไปที่เครื่อง Hermes VM ยังขาด NFS client tooling ไม่ใช่ปัญหา TrueNAS export หรือการตั้งค่า NFS share ผิด เมื่อติดตั้ง `nfs-common` แล้วก็แก้ได้

### Dataset ownership ทำให้เขียนไฟล์ไม่ได้

หลังจาก mount NFS สำเร็จ Hermes อ่าน share ได้ แต่เขียนที่ export root โดยตรงไม่ได้ นี่ไม่ใช่ปัญหา UID ของ Hermes เพราะ service account เป็น `{HERMES_UID}:{HERMES_GID}` อยู่แล้ว แต่ export root บน TrueNAS ยังเป็น `root:root` พร้อม mode `755` จึง block การเขียนที่ `/mnt/truenas/hermes`

Permissions ของ dataset บน export root:

```text
owner=root:root
mode=755
```

Hermes user:

```text
uid={HERMES_UID}
gid={HERMES_GID}
```

ผลคือ Hermes สร้างไฟล์ที่ `/mnt/truenas/hermes` ไม่ได้

การสร้าง subdirectory ที่เขียนได้แบบชั่วคราวช่วยปลดล็อกการเขียนได้ทันที:

```text
/mnt/truenas/hermes/docs-media
owner=hermes:hermes
mode=775
```

แค่นี้เพียงพอให้ทำงานต่อได้ แต่ผมไม่อยากมี writable island ซ้อนอยู่ข้างในเป็นถาวร fix ที่ดีกว่าคือแก้ ownership ที่ dataset root บน TrueNAS ไม่ใช่อยู่ใน `docs-media` ตลอดไป

---

## วิธีแก้

### ติดตั้ง NFS client support

```bash
sudo apt-get update
sudo apt-get install -y nfs-common
```

### สร้าง mount point

```bash
sudo mkdir -p /mnt/truenas/hermes
```

### Mount TrueNAS dataset

```bash
sudo mount -t nfs -o vers=4,_netdev \
  {NAS_IP}:/mnt/lamia/data/hermes \
  /mnt/truenas/hermes
```

หลัง mount:

```bash
findmnt /mnt/truenas/hermes
```

```text
TARGET              SOURCE                               FSTYPE
/mnt/truenas/hermes {NAS_IP}:/mnt/lamia/data/hermes     nfs4
```

### ทำให้ mount อยู่ถาวรหลัง reboot

เพิ่มลงใน `/etc/fstab` บน Hermes VM:

```fstab
{NAS_IP}:/mnt/lamia/data/hermes  /mnt/truenas/hermes  nfs4  defaults,_netdev,vers=4  0  0
```

Apply และ verify:

```bash
sudo mount -a
findmnt /mnt/truenas/hermes
```

systemd `.mount` unit ก็ทำงานลักษณะเดียวกันได้ แต่บน Hermes VM ผมใช้ fstab เมื่อมี entry นี้แล้ว mount จะยังอยู่หลัง reboot

### ตั้งค่า NFS share

การตั้งค่า TrueNAS NFS share:

```text
Path: /mnt/lamia/data/hermes
Read Only: false
Authorized Host: {HERMES_VM_IP}
```

การจำกัด share ให้เฉพาะ IP ของ Hermes VM ช่วยลด exposure ที่ไม่จำเป็นบน LAN

### เหตุผลที่เลือก align UID/GID

มีทางเลือกอื่นที่พิจารณาแล้ว เช่น NFS Mapall User/Group, writable subfolders (`docs-media`), ACL exceptions, และการปรับ root-squash แบบแรง ๆ

สำหรับ dataset `/mnt/lamia/data/hermes` ที่ dedicated ให้ Hermes และมี Hermes เป็น writer เดียว การตั้ง dataset ownership ให้ตรงกับ `{HERMES_UID}:{HERMES_GID}` เป็นทางเลือกที่ดีกว่า เพราะ:

- File ownership ยังสื่อความหมายบน client (`ls`, backups, audits)
- ไม่ต้องมี Mapall rule ที่ map ทุก client user ไปเป็น account เดียวบน NAS
- ไฟล์ที่ Hermes สร้างจะแสดงเป็น `hermes:hermes` โดยไม่ต้องมี NFS mapping เพิ่ม
- Debug ง่ายกว่าไม่ต้องไล่ว่าทำไมไฟล์ถึงโผล่มาเป็น `nobody`

Setup นี้สมมติว่า NFS export รักษา semantics ของ client UID/GID ไว้ — ไม่มี mapall หรือ root-squash behavior ที่ rewrite Hermes ไปเป็น account อื่นที่ไม่เกี่ยวข้อง

### Align dataset ownership

แทนที่จะใช้ writable subfolders หรือ NFS user mapping ทั้ง dataset ถูกกำหนดให้เป็น storage ที่ Hermes จัดการ นี่คือ ownership model ที่ทางเลือกแบบ Mapall จะเพียงแค่ซ่อนไว้

บน TrueNAS:

```bash
sudo chown -R {HERMES_UID}:{HERMES_GID} /mnt/lamia/data/hermes
sudo chmod -R 775 /mnt/lamia/data/hermes
```

`775` เป็นวิธีที่ค่อนข้างกว้าง แต่ยอมรับได้ในกรณีนี้ เพราะ `/mnt/lamia/data/hermes` ถูก isolate ไว้สำหรับ documentation assets ของ Hermes เท่านั้น ไม่ใช่ shared pool ทั่วไป

Ownership หลัง align:

```text
owner=hermes
group=hermes
uid={HERMES_UID}
gid={HERMES_GID}
mode=775
```

Hermes ใช้ mount นี้ได้ด้วยสิทธิ์ user ปกติ โดยไม่ต้องใช้ sudo

---

## Verification

### Mount และ permissions

```bash
findmnt /mnt/truenas/hermes
```

```text
TARGET              SOURCE
/mnt/truenas/hermes {NAS_IP}:/mnt/lamia/data/hermes
```

```bash
stat -c \
'path=%n owner=%U:%G uid=%u gid=%g mode=%a type=%F' \
/mnt/truenas/hermes
```

```text
path=/mnt/truenas/hermes
owner=hermes:hermes
uid={HERMES_UID} gid={HERMES_GID}
mode=775
type=directory
```

mount-point directory อาจมีอยู่ได้แม้ NFS mount จะ fail ดังนั้นก่อนทดสอบเขียนไฟล์ ให้ confirm เสมอว่า source เป็น TrueNAS export ไม่ใช่ directory local ว่าง ๆ ที่เหลือจาก mount ที่ไม่สำเร็จ

### Write, read, delete

```bash
sudo -u hermes bash -c '
echo "hermes nas test" > /mnt/truenas/hermes/test.txt
'
sudo -u hermes cat /mnt/truenas/hermes/test.txt
sudo -u hermes rm /mnt/truenas/hermes/test.txt
```

```text
hermes nas test
Write:  OK
Read:   OK
Delete: OK
```

---

## Final state

| Item | Value |
| --- | --- |
| TrueNAS dataset | `/mnt/lamia/data/hermes` |
| NFS export | `{NAS_IP}:/mnt/lamia/data/hermes` |
| Hermes mount | `/mnt/truenas/hermes` |
| Dataset owner | `{HERMES_UID}:{HERMES_GID}` |
| Permissions | `775` |
| Access mode | Read/Write |
| Intended usage | Blog media, screenshots, videos, generated assets |

---

## ผลลัพธ์

ตอนนี้ Hermes อ่านและเขียน documentation assets ที่ `/mnt/truenas/hermes` บน storage ที่ backed by NAS ได้แล้ว แทนที่จะใช้ root disk ของ VM ช่วยให้ backup รวมศูนย์มากขึ้น ลดการใช้พื้นที่ root disk และยังใช้ file access แบบ normal user บน path ที่สงวนไว้สำหรับ output ของ Hermes

---

## บทเรียนที่ได้

ก่อนทดสอบเขียนไฟล์ทุกครั้ง ให้รัน `findmnt /mnt/truenas/hermes` และ confirm ว่า source เป็น NFS export ไม่ใช่ directory local ว่าง ๆ ที่เหลือจาก mount ที่ล้มเหลว

ข้อจำกัดสำคัญคือ isolation: Hermes เป็น owner ของ `/mnt/lamia/data/hermes` เพราะ dataset นี้ใช้เฉพาะ documentation และ blog assets ที่ Hermes generate ขึ้นมาเท่านั้น

---

## สถานะสุดท้าย

Hermes NAS media storage ใช้งานได้แล้ว และ mount แบบ reboot-persistent ผ่าน `/etc/fstab` บน Hermes VM (ดูด้านบน) path ที่แนะนำสำหรับ documentation assets คือ:

```text
/mnt/truenas/hermes
```
