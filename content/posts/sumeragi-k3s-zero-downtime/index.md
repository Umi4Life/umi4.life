+++
banner = ''
cover = ''
date = '2026-08-16T00:00:00+07:00'
draft = true
translationKey = 'sumeragi-k3s-zero-downtime'
title = "I Migrated an Arcade Server to k3s, Then Tested the Rollout by Playing a Credit"
subtitle = 'Migrating a raw-TCP arcade server to k3s — and proving a player's session survives a live rollout.'
description = 'Migrating a raw-TCP rhythm-game arcade backend (SEGA ALL.Net, AimeDB, billing TLS) from Docker Compose to k3s + Argo CD — and proving a player's session survives a live rollout.'
tags = ["k3s", "kubernetes", "argo-cd", "gitops", "proxmox", "tcp", "arcade", "docker", "homelab", "zero-downtime", "frp", "cgnat"]
categories = ["homelab", "kubernetes", "private-server"]
mermaid = true
+++

My final integration test was not `curl`. It was playing a credit while Kubernetes replaced the backend underneath me, then checking whether my score still existed.

It did. Here's how I got there.

---

## Why this exists

I run a private network backend for rhythm-game arcade cabinets — Sumeragi, a fork of the community ARTEMiS project. It had been a Docker Compose box for months, and it worked. The migration was as much about learning as about uptime.

I could have used Docker Swarm and been done in a weekend. I didn't, on purpose: I wanted to **practice Kubernetes and distributed systems** — real pods, real rolling updates, real failure modes — and to learn **GitOps** as a discipline (declared state in Git, reviewable deploys, no more SSH-ing into a box to run `docker compose up`).

An arcade server is the ideal sandbox for that: real production traffic, real players (friends, mid-song), real consequences — and the only person who gets paged at 3am is me.

It also all runs on a **physical, self-hosted Proxmox homelab** — my own machine, my own VMs, my own private Git forge and container registry. No cloud, no managed Kubernetes. This is the box it lives on:

{{< gallery >}}
![The Proxmox homelab machine](./images/server-machine.jpg)
{{< /gallery >}}

*[TODO: insert server machine photo]*

---

## Part 1 — Prepping Sumeragi for k3s

The server already ran under Docker Compose and was reachable from cabinets — my ISP is CGNAT, so a VPS + FRP reverse tunnel provides the public entrypoint. (That networking earned its own scar early on: cab traffic must stay a transparent pipe — a Caddy `Via` header once broke `ALL.Net` auth even though the response matched a reference server byte-for-byte.)

The real prep for k3s wasn't networking, though. It was code. **Kubernetes was about to start sending `SIGTERM` to a process that had no idea how to stop gracefully.**

### How it worked before

One `python3 index.py` process launched several Uvicorn servers plus AimeDB through `asyncio.start_server`. Three things made that process k3s-hostile:

1. **AimeDB's server handle was dropped.** `asyncio.start_server()` returns an object with a `close()`, but the code never kept it — so there was no way to stop accepting new AimeDB connections while in-flight sessions finished.
2. **AimeDB wasn't in the shutdown path.** `index.py` tracked the Uvicorn tasks and, when one finished, cancelled the rest and exited. AimeDB ran outside that supervision entirely.
3. **Health was a single string.** `/` returned "Service OK" — no readiness, no "are all listeners actually up."

```python
# index.py (before) — the whole shutdown "strategy"
task_list = [asyncio.create_task(launch_main(cfg, ssl))]
if cfg.billing.standalone:
    task_list.append(asyncio.create_task(launch_billing(cfg)))
if cfg.aimedb.enable:
    AimedbServlette(cfg).start()      # ← not tracked, no handle kept

done, pending = await asyncio.wait(task_list, return_when=FIRST_COMPLETED)
for t in pending:
    t.cancel("Another service died, server is shutting down")
```

None of that matters for a single Compose box. For rolling updates — where a pod must go not-ready *before* it's drained, while a second replica keeps serving — it's the whole game.

### The change: a coordinated lifecycle

The core of the work was a new `LifecycleManager` — a tiny state machine:

```text
STARTING → READY → DRAINING
```

```python
class LifecycleManager:
    def begin_drain(self):
        if self._state != ServiceState.DRAINING:
            self._state = ServiceState.DRAINING
            self._shutdown_event.set()   # wake the shutdown monitor
```

- **Listener-aware readiness.** `/ready` returns 200 only once every required listener is actually running, and 503 during startup and drain.
- **`SIGTERM` means drain, not die.** On the signal, the process flips to `DRAINING`, stops accepting new connections everywhere, and lets established AimeDB sessions finish inside a 30-second in-process window (Kubernetes holds a 35-second grace period as the hard cutoff).
- **AimeDB is finally supervised.** The server object and its connection tasks are retained, so the drain knows what's actually in flight — and an unexpected listener failure now produces a nonzero exit instead of being swallowed.

A `service_manager` supervises every Uvicorn and AimeDB service through the same coordinated shutdown, with a ~500-line test suite pinning the behavior.

### The Python 3.9 landmine

The first version shipped a bug that only Python 3.9 (the container runtime) would surface: the shutdown `asyncio.Event()` was created at *module import time*, binding to whatever loop existed then — not the loop `asyncio.run()` creates later. The server would start, then immediately shut down:

```text
RuntimeError: Task got Future attached to a different loop
```

The fix was lazy initialization — create the event inside the running loop on first use:

```python
def _ensure_event(self):
    if self._shutdown_event is None:
        self._shutdown_event = asyncio.Event()   # created on the running loop
```

Plus a regression test that builds the manager on a foreign loop and proves it still works. Twenty tests, green.

This is the "prepping for k3s" no tutorial covers: teaching the *application* to cooperate with termination semantics, before you write a single line of YAML.

---

## Part 2 — Prepping the cluster: VMs as cattle

The application half was about teaching one process to drain. The cluster half was about turning three VMs into a *platform* instead of a sumeragi-shaped appliance.

First, the vocabulary. A k3s cluster has two kinds of nodes:

- **Server** — the control plane: the API server, scheduler, controller manager, and the cluster datastore. It decides *where* things run. Here the single server is tainted control-plane-only, so it runs no workloads.
- **Agent** (worker) — the machines that actually run the pods. The two sumeragi replicas land here, one per agent.

`tsukishiro-iac` provisions them in two layers: **Terraform** creates the Proxmox VMs, **Ansible** bootstraps them into k3s (bundled Traefik and ServiceLB disabled, the server tainted). The three VMs are spread across **two physical Proxmox nodes**, not one:

```text
tsukishiro   — k3s-server-1 (control plane) + k3s-agent-1
sakuraba-1   — k3s-agent-2
```

That spread matters: with one pod per worker, the two replicas already live on two separate physical hosts. And it's a *shared* platform on purpose — Sumeragi is the first tenant, not the cluster's identity. Future services get their own namespace, config/Secret boundary, and routing, and none of them inherit Sumeragi's raw-TCP edge path.

The one real IaC bug worth recording was a network default. The generic VM module applied one LAN bridge and gateway to every VM — fine until you try to place a VM in the DMZ, where "the LAN gateway" is the wrong answer. The fix was per-VM `bridge`/`ipv4_gateway` overrides:

```hcl
# before — every VM inherited the module's single default
bridge       = local.proxmox_defaults.bridge
ipv4_gateway = local.proxmox_defaults.ipv4_gateway

# after — each VM may override
bridge       = try(each.value.bridge, local.proxmox_defaults.bridge)
ipv4_gateway = try(each.value.ipv4_gateway, local.proxmox_defaults.ipv4_gateway)
```

```text
tsukishiro-iac   Terraform -> Proxmox VMs    Ansible -> k3s bootstrap
acid             in-cluster desired state, reconciled by Argo CD
```

That split — IaC owns the substrate, Git owns the continuously-reconciled desired state — is the boundary I keep coming back to. Provisioning is a prerequisite to the GitOps control plane, not part of it.

---

## Part 3 — The migration: "HA" is a word that needs precision

Most zero-downtime Kubernetes advice assumes HTTP: drain old pods, route to new ones, done. An arcade server is not that. AimeDB is raw encrypted TCP — a cabinet opens a connection and holds it open for the whole session. Load balancing is **per TCP connection, not per message**; there's no request/response boundary to hand off.

So the honest framing, which I spent two weeks proving:

- **Zero failed *new* connections during a controlled rollout:** achievable.
- **Established TCP sessions surviving a rollout:** only if old pods drain until those sessions close naturally.
- **Established TCP sessions surviving an abrupt pod/node/host failure:** impossible. The client reconnects.

Kubernetes was never going to "teleport" a socket. The goal was narrower and more honest: **a player's session survives a controlled deployment rollout.**

### Two replicas, and a PDB that said no

The two-replica setup had a `PodDisruptionBudget` requiring at least one healthy pod. I tested it through the eviction API, and the result is a better PDB explanation than the docs:

```text
2 healthy pods
→ evict one:            HTTP 201   (allowed)
→ evict the last one:   HTTP 429   (blocked — budget violated)
```

Kubernetes let me shoot one replica and physically refused to let me shoot the second. A PDB governs *voluntary* disruption; it can't stop a machine from dying abruptly. But it made the policy concrete.

### A config mistake, and a two-line fix

The first rollout deadlocked. I'd set the "keep both replicas, create a replacement" strategy — but on two workers with one pod per host, the surge pod had nowhere to schedule, and `maxUnavailable: 0` refused to evict an old pod to make room. Argo went `Degraded`, the new pod sat `Pending`.

```yaml
rollingUpdate:
  maxUnavailable: 1   # drain one pod, free its worker, then replace
  maxSurge: 0
```

That's the whole fix. Drain one pod, place the replacement on its worker, repeat. The honest cost is a brief one-replica window during the ~35s drain — never-below-two needs a third worker, which in my setup means a third physical machine (both existing hosts are already memory-constrained).

### The proof: play a credit during the rollout

All of the above is theory until someone's actually playing. So the test was: trigger a live rolling update **while a session was in progress**, and see what happens.

The result, straight from the client's history tab:

```text
WIN 988,550 · FULL BELL · PLATINUM SCORE 2,117/0
MAX COMBO 236 · CRITICAL 1.147 · BREAK 5 · HIT 9 · MISS 17
BELL 96/96 · MASTER
```

The score appeared in history — which reads from the backend → database — so it **wrote and read back clean** across the rollout. A full play, through the drain window, with the result persisted. Argo returned to `Synced / Healthy` with both pods on the new image.

That's the payoff. The cluster wasn't finished when Kubernetes turned green; it was finished when a real play still produced a score while the backend was being replaced.

**The one caveat I owe myself:** "score saved" is consistent with *either* a seamless connection *or* a clean client reconnect. Logs distinguish the two; I haven't yet correlated play timing against the AimeDB drain window to claim the stronger word, *seamless*. I'll say "survived and persisted" and leave "seamless" for a log-correlation follow-up.

---

## Part 4 — GitOps: introducing acid

The migration's second act was Argo CD — turning deploys from "SSH into the box" into "reviewed Git changes". The missing piece was a place to hold the *desired state*, so I made `acid`.

### What acid is

`acid` is the cluster's desired-state repository. Three repos, three jobs:

```text
sumeragi        the app       — source, tests, image build
tsukishiro-iac  the substrate — Proxmox VMs, k3s, Argo CD install
acid            the state     — what runs in the cluster, where, at which digest
```

The separation is the whole point: the app repo answers "how is this built?", the IaC repo answers "what does it run on?", and acid answers "what should actually be running right now?" That keeps deployment history independent of source commits, makes image promotion a reviewable diff, and lets Argo CD read acid without ever touching application source.

Inside acid: an `AppProject` (the resource whitelist), an `Application` with no `syncPolicy` — manual sync, no auto-sync, no prune, no self-heal — and the Kustomize manifests, all pinned to one immutable digest. Its shape is a trimmed-down [Project Ceylon](https://life.lmwn.com/ceylon-i-gitops-with-argocd-34aa5712f67c), a LINE MAN Wongnai GitOps series: I took App-of-Apps and committed image state, and deliberately left Jsonnet and Argo Rollouts out.

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: sumeragi
spec:
  project: acid
  source:
    repoURL: https://git-mirror.umi4.life/umi4life/acid.git
    path: applications/sumeragi
  # no syncPolicy → every sync is a human clicking the button
```

### Migrations, ordered correctly

The first thing acid had to get right was schema migrations. "Run the migration before the rollout" was correct — but my first idea, exec'ing into the current pod, was wrong:

```bash
kubectl exec deploy/sumeragi -- python3 dbutils.py upgrade   # wrong: old image
```

Before sync, that pod runs the **old image**, so it literally doesn't contain the new release's migration:

```text
before sync:  pod = old image → the new migration doesn't exist yet
after sync:   pod = new image → the app may start against the old schema
```

Neither timing works. The fix was an Argo **PreSync Job** that runs `dbutils.py upgrade` from the candidate image before the pods roll — a failed migration aborts the sync:

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: sumeragi-migrate
  annotations:
    argocd.argoproj.io/hook: PreSync
    argocd.argoproj.io/hook-delete-policy: HookSucceeded
spec:
  template:
    spec:
      containers:
        - name: migrate
          image: registry.umi4.life/sumeragi   # digest injected by Kustomize
          command: ["python3", "dbutils.py", "upgrade"]
```

And to kill the "remember to update two image fields" failure mode, Kustomize injects **one pinned digest** into both the Job and the Deployment:

```yaml
images:
  - name: registry.umi4.life/sumeragi
    digest: sha256:af9763fa031b0e594fcc8366ce05765906f66154810bd618740312b90f022340
```

### The scars

A few more things bit me along the way:

- **Two roles owned one CoreDNS ConfigMap.** A sync failed with `lookup git-mirror.umi4.life: no such host` because two Ansible roles both rewrote the same `coredns-custom` object, and one clobbered the other's rule. One shared resource, one authoritative owner.
- **Showing the pods showed the graveyard.** `kubectl` reported two healthy pods; Argo showed only a `Deployment`. The `AppProject` whitelist didn't include `Pod` or `ReplicaSet`, so I added them — and Argo immediately rendered every historical ReplicaSet it had ever retained. `revisionHistoryLimit: 1`; Git is the rollback history, Kubernetes doesn't need a graveyard.
- **Deleting a committed key is not rotating it.** Cleanup found private TLS keys committed to the Sumeragi repo. Removing them from the current tree fixed the layout, but it did **not** make them secret again — Git history still has them. Deletion is cleanup; rotation is remediation. Rotation remains on the list.

### Not everything belongs in Kubernetes

Migrating the app to k3s raised an obvious follow-up: the game-data importer should become a Kubernetes Job, right?

The importer (`read.py`) ingests a large game-asset collection. Those assets already live at `/srv/arcade-assets` on the old arcades VM, which also already has Docker, direct MariaDB reachability, the Sumeragi config, and a seat in the right DMZ. Making it a Job would mean exposing or re-plumbing that asset storage into the cluster just to run an occasional batch job.

So the importer stayed where the data already lives: a one-shot `docker run --rm` of the same Sumeragi image on the arcades VM.

Migrating the application to Kubernetes did not make the old VM obsolete. It clarified what the VM's job actually was.

### The whole flow, in one picture

The release system ends up as one path:

```text
Sumeragi source
   → build + push image
   → immutable digest
   → acid PR (reviewed)
   → manual Argo sync
   → PreSync migration (candidate image)
   → drain + replace replica 1
   → drain + replace replica 2
```

Before, a deploy was `docker compose pull` + `docker compose up`. After, it's a reviewed Git change flowing through a migration gate into a controlled drain rollout.

---

## What this is *not*

I want this section as loud as the wins, because "HA" is a word people say when they mean "I feel better."

```text
one VPS relay / static IP
one MariaDB endpoint
one k3s server (single-node control plane)
abrupt TCP connection continuity
```

The three VMs already span two physical Proxmox nodes, and the two replicas sit on separate hosts — so a single physical-host failure doesn't take down both application replicas. But losing the host that runs `k3s-server-1` also removes the single control plane, and the relay and database remain single-point.

And to be precise about what the play test proved: **a player's session survived operationally and the result persisted.** It did not prove the TCP socket never dropped, and it says nothing about abrupt node failure — a crash still requires a reconnect.

---

## What I'd change next

Roughly in priority order, distinguishing validated behavior from the remaining roadmap:

1. **A third worker — a third machine, in my case.** Never-below-two rollouts need a third scheduling domain, and both current Proxmox nodes are already memory-constrained. That's horizontal scaling for this homelab, not a universal Kubernetes requirement.
2. **Control-plane HA** — a second and third k3s server (embedded etcd), so the API/scheduler isn't a single node.
3. **Database and relay HA** — the next availability ceilings once the app layer is sorted.
4. **Key rotation** — still pending after the committed-key cleanup.
5. **Encrypted GitOps for config/secrets** — runtime config is still an out-of-band Secret, not a reviewed Git change.
