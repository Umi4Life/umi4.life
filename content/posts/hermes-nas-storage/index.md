+++
date = '2026-06-04T00:00:22+07:00'
draft = false
translationKey = 'hermes-nas-storage'
title = 'Hermes NAS Storage for Documentation Assets'
description = 'Mounting a TrueNAS dataset over NFS so Hermes can store blog and documentation media without filling the VM disk.'
tags = ["truenas", "nfs", "proxmox", "homelab", "hermes-agent", "documentation"]
categories = ["homelab"]
+++

> [!NOTE]
> Internal IPs and UID/GID values in this post are placeholders for a public write-up. Table cells use `{NAS_IP}`-style markers, substitute your own values before copy-paste.

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

This was not meant to be a general-purpose shared NAS mount. Hermes is the only writer for this dataset, so I preferred simple Unix ownership over ACL or NFS identity mapping. The `docs-media` subfolder (below) was a quick workaround; matching the dataset UID/GID to the Hermes service user is the deliberate long-term fix.

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

## Problem

### Local VM storage was not suitable for media assets

Hermes originally operated entirely from local VM storage.

While this was sufficient for application data and source repositories, documentation assets can accumulate quickly: project photos, screenshots, videos, exported renders, and generated media. These files are better suited to NAS storage.

### Initial NFS mount failed

The first mount attempt failed with:

```text
mount: /mnt/truenas/hermes: fsconfig() failed: NFS: mount program didn't pass remote address.
```

The failure pointed to missing NFS client tooling on the Hermes VM, not a TrueNAS export or NFS share misconfiguration. Installing `nfs-common` fixed it.

### Dataset ownership prevented writes

After the NFS mount succeeded, Hermes could read the share but could not write directly to the export root. This was not a Hermes UID problem, the service account was already `{HERMES_UID}:{HERMES_GID}`. The export root on TrueNAS was still `root:root` with mode `755`, which blocked writes at `/mnt/truenas/hermes`.

Dataset permissions on the export root:

```text
owner=root:root
mode=755
```

Hermes user:

```text
uid={HERMES_UID}
gid={HERMES_GID}
```

This prevented Hermes from creating files at `/mnt/truenas/hermes`.

A temporary writable subdirectory fixed writes immediately:

```text
/mnt/truenas/hermes/docs-media
owner=hermes:hermes
mode=775
```

That was enough to unblock work, but I did not want a permanent nested writable island. The better fix was ownership at the dataset root on TrueNAS, not living inside `docs-media` forever.

---

## Solution

### Install NFS client support

```bash
sudo apt-get update
sudo apt-get install -y nfs-common
```

### Create mount point

```bash
sudo mkdir -p /mnt/truenas/hermes
```

### Mount TrueNAS dataset

```bash
sudo mount -t nfs -o vers=4,_netdev \
  {NAS_IP}:/mnt/lamia/data/hermes \
  /mnt/truenas/hermes
```

After mount:

```bash
findmnt /mnt/truenas/hermes
```

```text
TARGET              SOURCE                               FSTYPE
/mnt/truenas/hermes {NAS_IP}:/mnt/lamia/data/hermes     nfs4
```

### Persist mount across reboot

Add to `/etc/fstab` on the Hermes VM:

```fstab
{NAS_IP}:/mnt/lamia/data/hermes  /mnt/truenas/hermes  nfs4  defaults,_netdev,vers=4  0  0
```

Apply and verify:

```bash
sudo mount -a
findmnt /mnt/truenas/hermes
```

A systemd `.mount` unit works the same way; fstab is what I used on the Hermes VM. The mount is reboot-persistent once this entry is in place.

### Configure NFS share

TrueNAS NFS share configuration:

```text
Path: /mnt/lamia/data/hermes
Read Only: false
Authorized Host: {HERMES_VM_IP}
```

Restricting the share to the Hermes VM IP reduces unnecessary exposure on the LAN.

### Why UID/GID alignment was chosen

Alternatives such as NFS Mapall User/Group, writable subfolders (`docs-media`), ACL exceptions, and aggressive root-squash tuning were considered.

For a dedicated `/mnt/lamia/data/hermes` dataset with Hermes as the only writer, matching dataset ownership to `{HERMES_UID}:{HERMES_GID}` was preferred because:

- File ownership stays meaningful on the client (`ls`, backups, audits).
- No Mapall rule that maps every client user to one NAS account.
- Files created by Hermes appear as `hermes:hermes` without extra NFS mapping.
- Easier to debug than wondering why a file shows up as `nobody`.

This setup assumes the NFS export preserves client UID/GID semantics, no mapall or root-squash behavior that rewrites Hermes to an unrelated account.

### Align dataset ownership

Instead of writable subfolders or NFS user mapping, the entire dataset was designated as Hermes-managed storage. This is the ownership model the Mapall alternative would have papered over.

On TrueNAS:

```bash
sudo chown -R {HERMES_UID}:{HERMES_GID} /mnt/lamia/data/hermes
sudo chmod -R 775 /mnt/lamia/data/hermes
```

`775` is blunt, but acceptable here because `/mnt/lamia/data/hermes` is isolated to Hermes-only documentation assets, not a general shared pool.

Ownership after alignment:

```text
owner=hermes
group=hermes
uid={HERMES_UID}
gid={HERMES_GID}
mode=775
```

Hermes can use the mount with normal user permissions and no sudo.

---

## Verification

### Mount and permissions

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

A mount-point directory can exist even when NFS failed, always confirm the source is the TrueNAS export before write tests.

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

## Result

Hermes now reads and writes documentation assets at `/mnt/truenas/hermes` on NAS-backed storage instead of the VM root disk. That keeps backups centralized and root disk usage down, with normal-user file access on a path reserved for Hermes output.

---

## Lessons learned

Before any write test, run `findmnt /mnt/truenas/hermes` and confirm the source is the NFS export, not an empty local directory left behind from a failed mount.

> [!TIP]
> The important constraint is isolation: Hermes owns `/mnt/lamia/data/hermes` because that dataset is only for Hermes-generated documentation and blog assets.

---

## Final status

Hermes NAS media storage is operational and reboot-persistent via `/etc/fstab` on the Hermes VM (see above). Preferred path for documentation assets:

```text
/mnt/truenas/hermes
```

## Related posts

{{< link path="posts/hermes-litellm-authelia-control-plane" cover="auto" >}}
{{< link path="posts/sky-feather-iac-hijack" cover="auto" >}}
{{< link path="posts/building-proxmox-homelab" cover="auto" >}}
