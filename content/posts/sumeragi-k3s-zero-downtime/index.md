+++
banner = ''
cover = ''
date = '2026-08-16T00:00:00+07:00'
draft = true
translationKey = 'sumeragi-k3s-zero-downtime'
title = "I Migrated an Arcade Server to k3s, Then Tested the Rollout by Playing a Credit"
subtitle = 'Two replicas, two workers, and nowhere to put the third pod — plus the raw-TCP reality that "HA" does not mean what you think.'
description = 'Migrating a bemani arcade server (raw AimeDB TCP, billing TLS, ALL.Net HTTP) from Docker Compose to k3s + Argo CD: a rollout deadlock, a PDB that refused a second eviction, and a score that survived a mid-play deployment.'
tags = ["k3s", "kubernetes", "argo-cd", "gitops", "proxmox", "tcp", "arcade", "docker", "homelab", "zero-downtime", "frp", "cgnat"]
categories = ["homelab", "kubernetes", "private-server"]
mermaid = true
+++

My final integration test was not `curl`. It was playing a credit while Kubernetes replaced the backend underneath me, then checking whether my score still existed.

It did. Here's how I got there — and the deadlock that nearly made the whole thing pointless.

---

## Why this exists

I run a bemani-style arcade server — Sumeragi, a fork of the community ARTEMiS project — for my rhythm-game cabinets. It had been a Docker Compose box for months, and it worked. The migration was as much about learning as about uptime.

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

The cluster comes from the `tsukishiro-iac` repo: **Terraform** provisions the Proxmox VMs (one k3s server, two agents), and **Ansible** bootstraps them into k3s with the bundled Traefik and ServiceLB disabled and the server tainted control-plane-only. It's a *shared* platform on purpose — Sumeragi is the first tenant, not the cluster's identity. Future services get their own namespace, config/Secret boundary, and routing, and none of them inherit Sumeragi's raw-TCP edge path.

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

### The rollout deadlock

The first image rollout used what looked like the "safe" strategy:

```yaml
rollingUpdate:
  maxUnavailable: 0   # never go below 2 replicas
  maxSurge: 1         # create the replacement first
```

I had configured Kubernetes to keep two replicas alive while creating a third pod, then gave it exactly **two** places where a pod was legally allowed to exist — hard hostname anti-affinity, one pod per worker:

```yaml
podAntiAffinity:
  requiredDuringSchedulingIgnoredDuringExecution:
    - topologyKey: kubernetes.io/hostname
```

```text
worker 1 → old pod
worker 2 → old pod
surge pod → needs a third legal worker
scheduler → there is no third legal worker
maxUnavailable: 0 → and you may not delete an old pod first
```

No legal next state. Argo went `Degraded`, the new ReplicaSet sat `Pending`, and eventually `ProgressDeadlineExceeded` fired.

This was not a Kubernetes bug and not a flaky scheduler. **Kubernetes was behaving exactly correctly — the desired state itself was impossible on the available topology.** Every individual setting was reasonable; their composition had no solution.

The fix wasn't clever YAML. It was admitting the arithmetic:

```yaml
rollingUpdate:
  maxUnavailable: 1   # drain one pod first
  maxSurge: 0         # then place the replacement on the freed worker
```

Drain one old pod, free one real worker, place the replacement, repeat. The honest cost: the service briefly runs on one replica during the ~35s drain window. Never-below-two requires a third worker, which doesn't exist yet.

A note worth keeping: while the rollout was `Degraded`, the *old* pods were still serving traffic fine. Rollout health and serving health are different dimensions — dashboards just love collapsing them into one color.

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

## Part 4 — GitOps, and the parts YAML doesn't tell you

The migration's second act was Argo CD. Desired state now lives in a dedicated repo — `acid` — whose shape is a trimmed-down [Project Ceylon](https://life.lmwn.com/ceylon-i-gitops-with-argocd-34aa5712f67c), a LINE MAN Wongnai GitOps series: I took App-of-Apps and committed image state, and deliberately left Jsonnet and Argo Rollouts on the shelf — automated rollback needs an observable failure signal, which raw-TCP AimeDB doesn't give me. Manual sync, a DMZ git mirror (the cluster can't reach the internal Forge), and PreSync migration jobs round it out. The Application itself is deliberately bare — no `syncPolicy` means no auto-sync, no prune, no self-heal:

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

That part worked — it's the *scars* that are worth writing down.

### Argo could not pull Git because its own playbook deleted its DNS

A sync failed with `lookup git-mirror.umi4.life: no such host`. Not Gitea, not TLS, not Argo. Two Ansible roles were both treating the same `kube-system/coredns-custom` ConfigMap as if each owned it. The Argo-UI role re-rendered the object and accidentally dropped the git-mirror forwarding rule.

The durable fix was architectural, not procedural: **one shared resource, one authoritative owner** (`k3s_server`), everyone else supplies inputs and stops rewriting it.

### "Run the migration before the rollout" — right. "Exec into the current pod" — wrong.

My first migration runbook was conveniently dumb:

```bash
kubectl exec deploy/artemis -- python3 dbutils.py upgrade
```

Before sync, the running pod has the **old image**, so it contains the **old migration files**. If the new release introduces a migration, the old pod literally does not contain it. The correct sequence is: build the new image → run the migration *from that new image* → only then roll the Deployment.

The GitOps answer was an Argo **PreSync Job** that runs `dbutils.py upgrade` from the candidate digest before the pods roll — a failed migration aborts the sync:

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

And to kill the "remember to update two image fields" failure mode, Kustomize injects **one pinned digest** into both the Job and the Deployment — the manifests reference a bare name, and one line resolves it everywhere:

```yaml
images:
  - name: registry.umi4.life/sumeragi
    digest: sha256:af9763fa031b0e594fcc8366ce05765906f66154810bd618740312b90f022340
```

### Show me the pods — no, not those pods

I asked Argo to show me the Sumeragi pods. The `AppProject` whitelist didn't include `Pod` or `ReplicaSet`, so the UI only showed the Deployment. After whitelisting them, it showed the pods — and every historical dead ReplicaSet too.

```yaml
revisionHistoryLimit: 1
```

Git is the rollback authority; I don't need ten revisions of `kubectl rollout undo` cluttering the tree.

### Not everything needs to become a Kubernetes Job

The game-data importer needs large asset files that already live on the old "arcades" VM (NAS → edge → that VM). That box still has Docker, direct database reachability, and the config. Rather than re-plumb gigabytes of data into k3s to make the architecture look purer, the importer stays a one-shot `docker run` on that VM.

Kubernetes is a tool, not a religion. Put a workload there when orchestration adds value; leave occasional data-heavy batch work where the data already lives.

---

## What this is *not*

I want this section as loud as the wins, because "HA" is a word people say when they mean "I feel better."

```text
one VPS relay / static IP
one MariaDB endpoint
one Proxmox host (all three VMs)
one k3s server (control plane)
abrupt TCP connection continuity
```

Three VMs on one Proxmox host buys rolling maintenance and per-VM resilience. It does not buy host, power, or storage HA. A two-replica deployment survives a single pod or worker loss; it does not survive the relay dying or the database deciding it's done.

And to be precise about what the play test proved: **a player's session survived operationally and the result persisted.** It did not prove the TCP socket never dropped, and it says nothing about abrupt node failure — a crash still requires a reconnect.

---

## What I'd change next

Roughly in priority order, distinguishing validated behavior from the remaining roadmap:

1. **A third worker** — the real fix for never-below-two rollouts (and, bluntly, the missing scheduling domain that caused the deadlock).
2. **A second physical Proxmox host** — real failure-domain separation instead of three VMs on one box.
3. **Database and relay HA** — the next availability ceilings once the app layer is sorted.
4. **Key rotation** — still pending after the committed-key cleanup.
5. **Encrypted GitOps for config/secrets** — runtime config is still an out-of-band Secret, not a reviewed Git change.
