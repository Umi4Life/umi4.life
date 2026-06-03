+++
date = '2026-06-04T00:00:22+07:00'
draft = false
translationKey = 'hermes-nas-storage'
title = 'Hermes NAS Storage for Documentation Assets'
description = 'Mounting a TrueNAS dataset over NFS so Hermes can store blog and documentation media without filling the VM disk.'
tags = ["truenas", "nfs", "proxmox", "homelab", "hermes-agent", "documentation"]
categories = ["homelab"]
+++

> **Operator note:** Internal IPs and UID/GID values in this post are placeholders for a public write-up. Substitute your own environment before running commands.

## Goal

Hermes generates and manages documentation that frequently includes:

- Screenshots
- Photos
- Screen recordings
- Rendered images
- Generated diagrams
- Blog media assets

Storing these files directly on the VM would eventually consume local disk space and complicate backup management.

The goal was to provide Hermes with access to centralized TrueNAS storage while allowing the agent to interact with it as a normal local directory.

Desired workflow:

```text
Hermes VM
    ↓
/mnt/truenas/hermes
    ↓ (NFS)
TrueNAS Dataset
/mnt/lamia/data/hermes
```

---

## Environment

### Infrastructure


| Component    | Value            |
| ------------ | ---------------- |
| Proxmox Host | tsukishiro       |
| TrueNAS VM   | TrueNAS VM       |
| TrueNAS IP   | `<NAS_IP>`       |
| Hermes VM IP | `<HERMES_VM_IP>` |


### Storage layout

TrueNAS dataset:

```text
/mnt/lamia/data/hermes
```

NFS export:

```text
<NAS_IP>:/mnt/lamia/data/hermes
```

Hermes mount point:

```text
/mnt/truenas/hermes
```

Hermes user:

```text
uid=<HERMES_UID>(hermes)
gid=<HERMES_GID>(hermes)
```

---

## Problem

### Local VM storage was not suitable for media assets

Hermes originally operated entirely from local VM storage.

While this was sufficient for application data and source repositories, documentation assets can accumulate quickly:

- Project photos
- Screenshots
- Videos
- Exported renders
- Generated media

These files are better suited to NAS storage.

---

### Initial NFS mount failed

The first mount attempt failed with:

```text
mount: /mnt/truenas/hermes: fsconfig() failed: NFS: mount program didn't pass remote address.
```

The root cause was that the Hermes VM did not have NFS client tooling installed.

---

### Permission mismatch

After the NFS mount succeeded, Hermes could read the share but could not write directly to the export root.

Dataset permissions:

```text
owner=root:root
mode=755
```

Hermes user:

```text
uid=<HERMES_UID>
gid=<HERMES_GID>
```

This prevented Hermes from creating files at:

```text
/mnt/truenas/hermes
```

A temporary writable subdirectory was created:

```text
/mnt/truenas/hermes/docs-media
```

with:

```text
owner=hermes:hermes
mode=775
```

This worked but was not the desired long-term solution.

---

## Solution

### Install NFS client support

Install required NFS tooling on the Hermes VM:

```bash
sudo apt-get update
sudo apt-get install -y nfs-common
```

---

### Create mount point

```bash
sudo mkdir -p /mnt/truenas/hermes
```

---

### Mount TrueNAS dataset

```bash
sudo mount -t nfs -o vers=4,_netdev \
  <NAS_IP>:/mnt/lamia/data/hermes \
  /mnt/truenas/hermes
```

Verify:

```bash
findmnt /mnt/truenas/hermes
```

Expected output:

```text
TARGET              SOURCE                               FSTYPE
/mnt/truenas/hermes <NAS_IP>:/mnt/lamia/data/hermes     nfs4
```

---

### Configure NFS share

TrueNAS NFS share configuration:

```text
Path: /mnt/lamia/data/hermes
Read Only: false
Authorized Host: <HERMES_VM_IP>
```

Restricting the share to the Hermes VM IP reduces unnecessary exposure on the LAN.

---

### Align dataset ownership

Instead of relying on writable subfolders or NFS user mapping, the entire dataset was designated as Hermes-managed storage.

On TrueNAS:

```bash
sudo chown -R <HERMES_UID>:<HERMES_GID> /mnt/lamia/data/hermes
sudo chmod -R 775 /mnt/lamia/data/hermes
```

Resulting ownership:

```text
owner=hermes
group=hermes
uid=<HERMES_UID>
gid=<HERMES_GID>
mode=775
```

This allows Hermes to interact with the dataset using normal user permissions without requiring sudo.

---

## Verification

### Verify mount

```bash
findmnt /mnt/truenas/hermes
```

Expected:

```text
TARGET              SOURCE
/mnt/truenas/hermes <NAS_IP>:/mnt/lamia/data/hermes
```

---

### Verify effective permissions

```bash
stat -c \
'path=%n owner=%U:%G uid=%u gid=%g mode=%a type=%F' \
/mnt/truenas/hermes
```

Expected:

```text
path=/mnt/truenas/hermes
owner=hermes:hermes
uid=<HERMES_UID> gid=<HERMES_GID>
mode=775
type=directory
```

---

### Write test

```bash
sudo -u hermes bash -c '
echo "hermes nas test" > /mnt/truenas/hermes/test.txt
'
```

---

### Read test

```bash
sudo -u hermes cat /mnt/truenas/hermes/test.txt
```

Expected:

```text
hermes nas test
```

---

### Delete test

```bash
sudo -u hermes rm /mnt/truenas/hermes/test.txt
```

Result:

```text
Write:  OK
Read:   OK
Delete: OK
```

Hermes can fully manage files without elevated privileges.

---

## Final state


| Item            | Value                                             |
| --------------- | ------------------------------------------------- |
| TrueNAS Dataset | `/mnt/lamia/data/hermes`                          |
| NFS Export      | `<NAS_IP>:/mnt/lamia/data/hermes`                 |
| Hermes Mount    | `/mnt/truenas/hermes`                             |
| Dataset Owner   | `<HERMES_UID>:<HERMES_GID>`                       |
| Permissions     | `775`                                             |
| Access Mode     | Read/Write                                        |
| Intended Usage  | Blog media, screenshots, videos, generated assets |


---

## Result

Hermes now has direct access to NAS-backed storage through:

```text
/mnt/truenas/hermes
```

All documentation assets can be stored on the NAS rather than consuming VM root disk space.

This provides:

- Centralized storage
- Easier backup management
- Reduced VM disk usage
- Normal-user file access
- A dedicated location for documentation and blog assets

---

## Lessons learned

### Always verify the mount before testing writes

A mount point directory can exist even when the NFS mount itself has failed.

Before performing any verification:

```bash
findmnt /mnt/truenas/hermes
```

Confirm that the source is the TrueNAS export and not a local directory.

---

### UID/GID alignment is simpler than permission workarounds

For a dedicated application dataset:

```text
Hermes user: <HERMES_UID>:<HERMES_GID>
Dataset:     <HERMES_UID>:<HERMES_GID>
```

is cleaner than:

- Writable subfolders
- Root-owned exports
- ACL exceptions
- NFS user remapping

---

### Dedicated datasets reduce ACL complexity

Giving Hermes ownership of an isolated dataset is low risk because the dataset is reserved exclusively for documentation assets.

This avoids complex ACL management while preserving clear ownership semantics.

---

## Final status

Hermes NAS media storage is operational.

Preferred storage path for documentation assets:

```text
/mnt/truenas/hermes
```

