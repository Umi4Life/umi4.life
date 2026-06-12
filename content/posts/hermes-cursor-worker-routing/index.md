+++
date = '2026-06-12T01:20:00+07:00'
draft = false
translationKey = 'hermes-cursor-worker-routing'
title = 'I Tested Cursor CLI and Qwen as Coding Workers for Hermes'
description = 'A small Hermes routing experiment comparing pure GPT-5.5, a Cursor CLI VM, and a Qwen worker through LiteLLM. The tiny-task result was boring; the worker-pool question was not.'
tags = ["hermes-agent", "cursor", "qwen", "litellm", "ai-agents", "benchmark", "worker-routing", "homelab"]
categories = ["automation", "ai", "homelab"]
mermaid = false
weight = 2
+++

I started with a simple question: if Hermes is already running GPT-5.5 as the orchestrator, does it make sense to hand the typing to a separate worker drone?

Not a magical "AI saves all tokens" kind of question. A boring operational one.

If GPT-5.5 can plan and review while another agent writes code, maybe Hermes can stretch its useful work across more tasks. Or maybe the handoff overhead eats the whole benefit. The only way to find out was to measure it.

The version I actually care about is not "one worker makes one tiny edit faster." That is the least interesting form of delegation. The spicy version is a small worker pool: Hermes splits a project into clean lanes, multiple Cursor VMs work at the same time, and GPT-5.5 spends its expensive attention on planning, review, and repair instead of typing every file itself.

So I ran a small routing experiment with three modes:

1. GPT-5.5 coding directly.
2. GPT-5.5 orchestrating a Cursor CLI worker VM.
3. GPT-5.5 orchestrating a Qwen worker through LiteLLM.

The result was not the one-liner I wanted. It was more useful than that.

## The setup

Hermes stayed as the orchestrator. It owned the task, the tests, the measurements, and the final judgment.

The workers were treated as implementors only:

- Cursor CLI ran on a separate VM, pinned to Composer 2.5.
- Qwen ran through an existing LiteLLM route named `tsukishiro-qwen3-5-9b`.
- Both workers had to pass deterministic tests.
- Neither worker was allowed to modify the tests.

This distinction matters. I was not benchmarking "Cursor vs GPT-5.5" as products. I was testing a routing pattern:

```text
Hermes / GPT-5.5 = planner and reviewer
Worker VM / local model = implementation lane
Tests = judge
```

That is closer to how I would actually use this in a homelab agent system.

## The experiment before this: Gemma and the empty CRUD backend

Before the Cursor test, I had already tried a similar routing idea with a local Gemma worker.

That experiment used a small Python stdlib CRUD backend. The service needed endpoints like:

```text
GET    /health
GET    /notes
POST   /notes
GET    /notes/{id}
PUT    /notes/{id}
DELETE /notes/{id}
```

The comparison was:

```text
B1 = pure GPT-5.5 implements the CRUD backend
B2 = GPT-5.5 writes the plan, Gemma implements it
```

The result was blunt:

| Mode | Session before | Session after | Delta | Time | Tests |
| --- | ---: | ---: | ---: | ---: | --- |
| Pure GPT-5.5 | 86% | 85% | -1pp | 6.82s | Pass |
| GPT-5.5 planner + Gemma | 85% | 84% | -1pp | 166.48s | Fail |

Gemma did not produce bad CRUD code. It produced no visible code at all.

Attempt one consumed the full 4096 completion-token budget and returned:

```text
finish_reason: length
reasoning_content_len: 11020
visible content length: 0
```

The retry consumed 8192 completion tokens and returned:

```text
finish_reason: length
reasoning_content_len: 19467
visible content length: 0
```

That result shaped the rest of this work. A worker route is not useful just because it is reachable, local, or theoretically cheap. It has to emit artifacts. Tests need something to judge.

This is why the Cursor result mattered. Cursor was not fast, but it produced files and passed tests. That is a different class of worker.

## V1: the smoke test

The first experiment was intentionally tiny. The task was a `slugify.py` file with tests.

Pure GPT-5.5 passed almost instantly:

```text
Pass: yes
Artifact/test execution time: 0.043s
Visible Session delta: 0pp
Visible Weekly delta: 0pp
```

Cursor also passed, but only after I fixed the benchmark harness. The first Cursor run was invalid because I used `/usr/bin/time`, and the Debian worker did not have it installed. That was not a Cursor failure. It was my harness being sloppy.

The corrected Cursor run used Python timestamps:

```text
Pass: yes
Cursor implementation time: 63.567s
Outer wall time: 69.539s
Visible Session delta: -1pp
Visible Weekly delta: 0pp
```

That told me two things.

First, Cursor CLI could work as a headless coding worker.

Second, using it for tiny tasks was probably silly. A one-minute worker handoff for a function GPT-5.5 can write directly in seconds is not a win.

V1 was useful, but not clean enough to trust. Smoke data is still data, but it should not be promoted into folklore. Run this as an experiment, not as folklore.

## V2: a slightly less tiny task

For V2, I made the task a bit larger but still bounded: implement `log_summary.py` with one public function:

```python
def summarize(lines: list[str]) -> dict:
    ...
```

The function had to parse log lines like this:

```text
2026-06-06T12:00:00Z level=INFO service=api latency_ms=42 message=ok
```

It needed to return level counts, service counts, p50/p95 latency, and the slowest services by average latency.

Before any measured run, Hermes created and froze the task and test files. Then it recorded SHA-256 checksums:

```text
d89c0a8af2c92e6eb631011759edd6848856bb8126b24d14aea4131ec24392d9  task/log_summary_task.md
f717d231ec7ce44de9c3c3cb0b9503cefa06bf98e36fdc11e0c35c3f32dfeb32  task/test_log_summary.py
```

Every run got the exact same `test_log_summary.py`. If a run's test checksum changed, the run would be invalid.

The run order was:

```text
A1 -> B1 -> C1 -> C2 -> B2 -> A2
```

Where:

```text
A = pure GPT-5.5
B = GPT-5.5 -> Cursor CLI VM
C = GPT-5.5 -> Qwen worker through LiteLLM
```

## Worker health before measurement

Cursor was healthy and pinned to the right model:

```text
CLI Version         2026.06.11-03-15-00-241fc09
Model               Composer 2.5
Subscription Tier   Enterprise
pong
```

Qwen was also healthy at the route level:

```json
{
  "ok": true,
  "finish_reason": "stop",
  "content": "model=tsukishiro-qwen3-5-9b\nstatus=pong",
  "content_len": 39,
  "reasoning_content_len": 0
}
```

That last field matters. Earlier local model experiments had a failure mode where the model spent all its budget in hidden reasoning and returned no visible code. This time Qwen produced visible output cleanly.

![Now, let's begin the experiment](/images/hermes-cursor-worker-routing/kamen-rider-build-experiment.png)

## Results

Here is the measured table:

| Run | Mode | Result | Session delta | Weekly delta | Wall time | Implementation/helper time | Attempts | Repairs |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| A1 | Pure GPT-5.5 | PASS | -1pp | -1pp | 27.099s | 27.063s | 1 | 0 |
| B1 | Cursor CLI VM | PASS | 0pp | 0pp | 65.654s | 58.802s | 1 | 0 |
| C1 | Qwen worker | FAIL | -1pp | 0pp | 55.490s | 14.340s + 14.792s repair | 2 | 1 |
| C2 | Qwen worker | FAIL | 0pp | 0pp | 29.212s | 14.322s + 14.816s repair | 2 | 1 |
| B2 | Cursor CLI VM | PASS | 0pp | 0pp | 63.941s | 57.134s | 1 | 0 |
| A2 | Pure GPT-5.5 | PASS | -1pp | 0pp | 24.228s | 24.194s | 1 | 0 |

Do not read the quota deltas as exact token usage. The `codex-usage` meter exposes coarse percentage movement. A `0pp` movement does not mean "used zero tokens", and a `-1pp` movement does not mean "used exactly one percent".

The Cursor runs showing 0pp movement are encouraging, but I would not treat them as proof of token savings because the meter is coarse and the orchestration session still consumes context.

The safer reading is:

- Pure GPT-5.5 moved the visible Session meter by -1pp in both measured runs.
- Cursor moved it by 0pp in both measured runs.
- Qwen moved it by -1pp once and 0pp once.
- Weekly movement was mostly flat, except A1, which showed -1pp.

This is useful telemetry. It is not billing data.

## The boring winner for small tasks: pure GPT-5.5

For this task size, pure GPT-5.5 was the best path.

It passed both runs on the first attempt and finished in about 24-27 seconds. Cursor also passed, but took about a minute per run. Qwen produced worker responses faster than Cursor, but that did not matter because both Qwen runs failed the same semantic edge case.

If the task is small and self-contained, the routing overhead dominates. Just let GPT-5.5 do it.

That sounds obvious in hindsight. It is still worth measuring because agent systems make it very easy to add clever routing that feels sophisticated and quietly makes everything worse.

## The interesting part: Cursor passed twice

Cursor did not win on latency. But it passed every deterministic test, twice, on the first implementation attempt.

That changes the question.

The question is no longer:

```text
Should I use Cursor CLI VM to make one tiny task faster?
```

The answer is probably no.

The better question is:

```text
Can I run multiple Cursor CLI VMs as parallel implementation lanes?
```

That is much more interesting.

A one-minute handoff is bad if there is only one small task. But if Hermes can split a larger project into independent chunks, the handoff cost stops being a toll booth and starts looking more like worker startup time. Three Cursor workers can run at the same time:

```text
cursor-cli-vm-1 -> backend endpoint
cursor-cli-vm-2 -> frontend component
cursor-cli-vm-3 -> migration and tests
```

Hermes stays in the role it is good at: decomposition, prompts, acceptance criteria, review, tests, and merge decisions.

The workers do the typing. Tiny orange-and-white drone squad energy, but with tests instead of vibes.

That is the architecture I care about now.

The win condition is not that a Cursor VM beats GPT-5.5 in a straight sprint. It probably will not, at least not on small tasks. The win condition is that two or three reliable Cursor lanes finish independent chunks while Hermes keeps the global state in one place:

```text
Hermes:
  write the task graph
  freeze tests and acceptance criteria
  assign independent lanes
  review diffs
  run integration tests
  merge or reject

Cursor VM pool:
  implement lane A
  implement lane B
  implement lane C
```

That changes the economics. A single slow worker is a curiosity. A pool of slow-but-reliable workers can turn wall-clock time into the thing being optimized, while the expensive orchestrator spends fewer turns on repetitive implementation detail. That is the operator dream: not "AI magic," just a boring little build farm for code edits.

There are obvious traps. The lanes have to be genuinely independent. The tests have to be strong enough to catch local mistakes. Hermes has to own the final integration pass, because three green worker branches can still combine into one very silly red build. But those are engineering problems, not reasons to ignore the shape.

## Qwen was healthy, but not good enough for this task

Qwen's result was more nuanced.

The LiteLLM route worked. The worker returned visible code. It did not get stuck in hidden reasoning. Qwen produced worker responses faster than Cursor, but that did not matter because both Qwen runs failed the same semantic edge case.

But it failed the same semantic edge case twice.

Qwen did not fail loudly. It failed politely, which is worse for an implementation worker.

The benchmark said:

```text
Use only lines that contain valid integer latency_ms for latency calculations.
```

The intended meaning was:

```text
If a line has valid level/service but missing or invalid latency, count it for level/service totals, but exclude it from latency math.
```

Qwen interpreted it as:

```text
If latency is missing or invalid, ignore the whole line.
```

That caused the tests to fail. One repair attempt did not fix it.

This is exactly why tests matter. The code looked plausible. It ran. It even passed most cases. But it got the boundary rule wrong.

For now, I would not use this Qwen route as the sole implementation worker for edge-case-heavy coding tasks. I would still use it for smaller slices, extraction, summarization, or places where GPT-5.5 can cheaply review and patch the result.

## Two harness bugs, two useful scars

Both experiments had harness mistakes.

V1 used `/usr/bin/time`, which was missing on the worker.

V2 initially tried this with Cursor:

```bash
cursor-headless --prompt-file prompt.txt
```

Cursor CLI 2026.06 did not support that option:

```text
error: unknown option '--prompt-file'
```

The fixed pattern was:

```bash
cursor-headless --force --sandbox disabled --output-format text "$(cat prompt.txt)"
```

That is not a glamorous finding, but it is the kind that makes the next run less painful. The harness is part of the experiment. If the harness is wrong, the benchmark is noise.

## What I learned

My current routing rule is:

```text
Small, bounded task:
  use GPT-5.5 directly

Medium task with strong tests:
  Cursor CLI worker is viable, especially if it can run in parallel with other workers

Small helper task or draft implementation:
  Qwen can be useful, but verify hard and expect semantic edge cases

Large multi-part project:
  split into worker lanes, but keep Hermes as reviewer and test owner
```

The Cursor result is the one I keep thinking about. Not because it was fast. It was not. Because it was reliable enough to suggest a different scaling shape.

Instead of trying to make one agent faster, maybe the better move is to make Hermes better at assigning work to many slower-but-reliable workers.

That is a very homelab-shaped bet. Do not buy one giant mythical worker. Rack a few boring ones, give each a narrow job, and make the supervisor ruthless about tests.

## What I would test next

The next experiment should not be another tiny function.

It should be a real parallel worker test:

```text
one repo
three independent issues
one pure GPT-5.5 sequential baseline
one Cursor VM sequential run
two Cursor VMs in parallel
three Cursor VMs in parallel
```

Measure:

- total wall-clock time
- pass/fail per lane
- repair count
- merge conflicts
- review time
- visible quota movement
- how annoying the orchestration becomes

That last metric is subjective, but important. A system that saves quota while making the human babysit five agents is not a good system.

The test I want is not "can three Cursor VMs look busy?" Busy workers are easy. The useful test is whether Hermes can keep the work coordinated without turning review into a tiny distributed-systems incident. If the parallel run cuts wall-clock time, keeps repairs low, and does not bury the operator in merge noise, then the worker-pool idea graduates from cute lab trick to infrastructure candidate.

## Caveats

This was a small benchmark. It does not prove Cursor is always worth using. It does not prove Qwen is bad. It does not prove GPT-5.5 is always better.

It also does not measure exact tokens or exact cost. The quota meter is coarse, and the active Hermes session still spends tokens on orchestration, tool calls, logs, and reports.

The only honest conclusion is narrower:

```text
For this small deterministic coding task, pure GPT-5.5 was the best route.

Cursor CLI was slower but reliable. That makes it more interesting as a parallel worker lane than as a tiny-task accelerator.

Qwen was fast and route-healthy, but failed the same semantic edge case twice. For now, it should be treated as an experimental implementation worker that needs narrower task selection or stronger GPT-5.5 review before being trusted for coding.
```

So the rule for now is simple: let GPT-5.5 handle tiny deterministic edits directly. Save worker delegation for tasks large enough that the handoff overhead has something to amortize against.

No quota bonfire this time. Just boring measurements.

The tiny-task routing idea is probably dead. The worker-pool idea is very much alive. Cursor did not prove that delegation is faster by itself. It proved something more useful: a headless Cursor VM can be reliable enough to deserve a lane in a parallel run.

That is the next chart I want to write.
