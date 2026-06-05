+++
date = '2026-06-05T17:28:00+07:00'
draft = false
translationKey = 'gemma-vision-router'
title = 'Reducing GPT Vision Calls with a Fail-Closed Gemma Router'
description = 'A Hermes vision-routing experiment using local Gemma through LiteLLM as a first-pass image triage layer, with GPT/Codex escalation for empty, OCR-heavy, or risky cases.'
tags = ["hermes-agent", "litellm", "gemma", "local-llm", "vision", "benchmark", "routing", "homelab"]
categories = ["automation", "ai", "homelab"]
mermaid = true
+++

# Reducing GPT Vision Calls with a Fail-Closed Gemma Router

> Can a local multimodal model reduce GPT/Codex vision usage without making the assistant unreliable?

## Summary

I tested whether a local Gemma multimodal model, served through LiteLLM, could act as a first-pass image interpretation helper for my Hermes/Sky Feather assistant.

The goal was not to replace GPT-5.5/Codex vision entirely. The goal was more practical:

> Can Gemma handle routine image descriptions, while escalating uncertain, text-heavy, or high-risk images back to GPT?

The answer is: **yes, but only with a conservative router.**

In a clean 20-image benchmark:

```text
GPT-only baseline:     20 GPT/Codex vision calls
Gemma-first router:   20 Gemma calls + 12 GPT/Codex escalations
GPT calls avoided:     8 / 20 = 40%
Gemma empty outputs:   5 / 20 = 25%
```

Gemma was useful for low-stakes visual triage, but it also produced empty visible output for several images. That makes it unsafe as a standalone vision backend.

> Gemma can reduce GPT vision pressure, but the router must fail closed.

---

## The Problem

Hermes Agent runs inside my Discord workflow and uses premium model quota for reasoning, coding, tool orchestration, and vision analysis.

Vision tasks are especially expensive from a quota-management perspective. Some image requests are genuinely worth sending to the strongest model: screenshots, hardware labels, OCR, UI state, diagrams, debugging evidence, or anything with operational consequences.

But many images are simpler:

- “What is in this photo?”
- “Describe this image.”
- “Is this a useful blog asset?”
- “Does this look like a hardware setup, diagram, screenshot, or meme?”
- “Give me enough context to decide whether to inspect further.”

Those do not always need GPT-5.5/Codex.

The obvious idea was to use a local multimodal model as a cheap helper. In my case, that meant:

```text
Gemma4 26B, via the local LiteLLM route
```

The risky assumption was:

> If Gemma can describe images reasonably well, maybe it can replace GPT vision for routine cases.

That assumption needed testing.

Mou… “seems fine” is not a benchmark.

---

## Why I Narrowed the Scope

Before this benchmark, I originally wanted Gemma4 26B to act as a broader fallback model for Hermes/Sky Feather.

That was too ambitious for the first production use case. In one Discord gateway session, Gemma failed assistant-identity preservation and identified itself as the backend model instead of Sky Feather, with responses like:

```text
I am Gemma 4, a large language model developed by Google DeepMind.
```

Later qualification showed the issue was more nuanced. Raw LiteLLM, Postman, and fresh Hermes CLI tests passed when given a clear identity instruction:

```text
I am Sky Feather in this session.
```

The suspicious parts were the dirty Discord gateway session and ambiguous model-switch wording such as:

```text
Adjust your self-identification accordingly
```

The better operational wording was:

```text
Backend model/provider changed to Gemma4 26B. Assistant identity remains Sky Feather.
```

So I did not conclude that Gemma could never preserve the assistant identity. I concluded that using it as a full fallback agent had too many session, prompt, and gateway risks for the first deployment.

That changed the goal:

```text
Not: Gemma replaces the main assistant.
But: Gemma performs bounded image triage for the main assistant.
```

That narrower scope is what this benchmark tests.

---

## Experiment Goal

The experiment was designed around a practical routing question:

> If every image goes to Gemma first, how many GPT/Codex calls can be avoided while still escalating risky cases?

The desired behavior was:

```text
Discord image upload
→ Hermes receives image
→ Gemma vision pass through LiteLLM
→ Router validates output
   ├─ low-risk + usable output → return Gemma result
   └─ empty / OCR-heavy / risky → escalate to GPT/Codex
→ Route decision logged
```

The benchmark was not trying to prove exact dollar or quota savings. The visible Codex quota meter is coarse, and Hermes orchestration itself consumes quota. So the clean metric was **call pressure**, not exact accounting.

The main thing I wanted to measure was:

```text
How many GPT vision calls can safely be skipped?
```

---

## Dataset

The benchmark used a fixed local dataset of 20 images.

Verified dataset state:

```text
Dataset root: /home/hermes/vision-benchmark-images/
Manifest:     /home/hermes/vision-benchmark-images/manifest.json

Images:       20
Total size:   9,014,292 bytes
Missing:      0
Hash errors:  0
```

The images covered a mix of realistic assistant inputs: art, memes, hardware photos, text-bearing images, and ambiguous/quality-sensitive cases.

I did not formally label categories in this run, which is one limitation of the benchmark. The dataset was intentionally workflow-shaped rather than a standardized public evaluation set.

The same prompt was used for image interpretation:

```text
Describe this image accurately. Include:
1. main subject or scene,
2. important objects/details,
3. background/context,
4. all visible text you can read,
5. any ambiguity or uncertainty.

Avoid unsupported guesses. Keep it concise but complete.
```

### Images and recognition outputs

The benchmark images are shown together with the recorded model outputs in [Model Output Comparison](#model-output-comparison), so the article does not repeat the same image set in multiple places.

---

## Experiment Design

I ran two windows.

### Window A: GPT-only baseline

Every image went directly to GPT/Codex vision.

```text
20 images
→ 20 GPT/Codex vision calls
```

This established the baseline behavior and artifact set.

### Window B: Gemma-first router

Every image went to Gemma first.

Then the router decided whether the image could stop at Gemma or needed GPT escalation.

```text
20 images
→ 20 Gemma calls
→ 12 GPT/Codex escalations
→ 8 images handled by Gemma only
```

Escalation happened for two reasons:

1. The image was judged risky based on OCR or quality needs.
2. Gemma returned empty visible output.

---

## Result Artifacts

The clean result directory was:

```text
/home/hermes/vision-benchmark-results/2026-06-05-clean-ab-windowed-v2
```

The important output files were:

```text
gpt_only_outputs.jsonl
gemma_first_outputs.jsonl
b_routes.jsonl
gpt_escalation_outputs.jsonl
quota_snapshots.jsonl
window2_verification.json
engineering-notes.md
```

Verification passed:

```text
verification_passed: true
```

Record counts:

```text
gpt_only_outputs.jsonl:        20
gemma_first_outputs.jsonl:     20
b_routes.jsonl:                20
gpt_escalation_outputs.jsonl:  12
quota_snapshots.jsonl:          4
```

Status counts:

```text
GPT-only baseline:
- ok: 20

Gemma-first:
- ok: 15
- failed_empty_response: 5

GPT escalations:
- ok: 12
```

Router outcome:

```text
gemma_only:       8
gemma_then_gpt:  12
```

---

## Main Result

The Gemma-first router avoided 8 of 20 GPT/Codex vision calls, or 40% of the baseline GPT vision call pressure.

That is useful. It means a local helper can reduce premium vision pressure for routine image interpretation.

But the failure mode was also significant:

```text
5 / 20 Gemma calls returned empty visible output
```

That is not a small edge case. It is 25% of the benchmark set.

The important detail is that these were not always clean transport failures. The local route could complete with successful-looking metadata and token usage, while still producing no usable assistant text.

That means this cannot be treated as:

```text
LiteLLM request succeeded
→ model output is usable
```

The router has to inspect the actual visible content.

---

## Model Output Comparison

Escalation reason legend:

- `—`: no escalation; Gemma output was accepted.
- `empty_gemma_response`: Gemma returned no usable visible text, so the router escalated to GPT/Codex.
- `ocr_or_quality_risk`: the router escalated because the image looked OCR-heavy, text-sensitive, screenshot/UI-like, hardware-label-heavy, or otherwise risky for Gemma-only handling.

The original route log used the longer internal label `v2_policy_ocr_or_quality_risk_from_prior_scored_regular_workload`; this post shortens it to `ocr_or_quality_risk` for readability.

This section consolidates the benchmark image set, route decision, and recorded model interpretations into one place. The earlier standalone image gallery and wide comparison table were removed because they repeated the same information and rendered poorly on mobile.

Each image card keeps the full recorded text from the benchmark logs. Empty Gemma outputs are shown explicitly rather than repaired by hand.

### Image 1: `image_01.jpeg`

{{< gallery >}}
![Benchmark image 1: image_01.jpeg](./images/image_01.jpeg)
{{< /gallery >}}


- **Route:** `gemma_only`
- **Escalation reason:** `—`

#### GPT/Codex baseline description

```text
A plush anime-style doll sits on a bed or soft surface. It has pale lavender-gray hair, a small black hat with purple rose decorations, a black-and-white outfit with a large bow, and striped stockings. The background shows gray curtains, bedding/pillows, a dark headboard, and partial anime character art on pillows/posters. Visible text is limited to cropped Japanese characters on the red/white art at the upper right; the exact text is not fully readable. Some background character details are cropped.
```

#### Gemma-first description

```text
**Main subject or scene:**
A plush toy of an anime-style character with lavender hair, sitting upright on a white, wrinkled surface (likely a bed).

**Important objects/details:**
* **Plushie features:** The character has large, dark eyes and lavender hair styled in pigtails. It wears a black hair accessory decorated with a purple rose. The outfit is black and white with ruffles and a black bow at the neck. The legs are wrapped in grey and black striped or bandage-like fabric.
* **Surroundings:** To the left and right of the plushie are pillows featuring anime-style illustrations. In the top right corner, a portion of another anime-style print or poster is visible, showing a character in red.

**Background/context:**
The scene is set indoors,
```

### Image 2: `image_02.jpeg`

{{< gallery >}}
![Benchmark image 2: image_02.jpeg](./images/image_02.jpeg)
{{< /gallery >}}


- **Route:** `gemma_then_gpt`
- **Escalation reason:** `ocr_or_quality_risk`

#### GPT/Codex baseline description

```text
An anime-style woman in a black suit stands in an office or classroom-like room holding a tablet. A large speech bubble says, "Sensei, stop assigning static IP addresses inside the DHCP range." Her badge reads "70", "WinRAR", and "STAFF". The background includes large windows, blue sky, books, a desk, and office supplies. No major ambiguity besides the fictional/stylized nature of the scene.
```

#### Gemma-first description

```text
An anime-style illustration of a woman with a stern expression.

1.  **Main subject**: A woman with long black hair, red eyes, and a serious facial expression. She is wearing a black blazer over a white turtleneck.
2.  **Important objects/details**:
    *   She is holding a white tablet in her left hand.
    *   On her left wrist, she wears a black watch.
    *   A white name tag is pinned to her blazer, which reads "**70 WinRAR STAFF**".
    *   A white speech bubble next to her contains the text: "**Sensei, stop assigning static IP addresses inside the DHCP range.**"
3.  **Background/context**: An office setting. Behind her is a window showing a clear blue sky. To the right, a desk is visible with a stack of books, a blue organizer, and some pens.
4.  **Visible text**:
    *   "Sensei, stop assigning static IP addresses inside the DHCP range."
    *   "70 WinRAR STAFF"
5.  **Ambiguity/uncertainty**: The specific identity of the character is not provided.
```

#### GPT/Codex escalation description

```text
Anime-style image of a stern-looking woman in a black suit holding a tablet in an office/classroom-like setting. She has long black hair, red eyes, a white turtleneck, a staff badge, and stands in front of windows, a desk, books, and stationery. Visible text in the speech bubble reads: 'Sensei, stop assigning static IP addresses inside the DHCP range.' Her badge reads 'WinRAR' and 'STAFF' with a stylized '70' or similar mark above it. Some small badge/logo details are too small to read with certainty.
```

### Image 3: `image_03.png`

{{< gallery >}}
![Benchmark image 3: image_03.png](./images/image_03.png)
{{< /gallery >}}


- **Route:** `gemma_then_gpt`
- **Escalation reason:** `ocr_or_quality_risk`

#### GPT/Codex baseline description

```text
A full-body anime character illustration on a dark/transparent-looking background with a tall red rectangle at the right edge. The character has pale hair with colorful streaks, a dark hat, oversized teal cardigan, short skirt/shorts, tall black socks, chunky shoes with yellow laces, and a large white fluffy tail or scarf ending in a rainbow sloth-like face. I do not see readable text. The red/black edges may be an artifact or cropped design element.
```

#### Gemma-first description

```text
An anime-style female character is the main subject, set against a solid black background.

**Important objects/details:**
* **Character Appearance:** She has white hair with rainbow-colored streaks and green eyes. She is wearing a grey and black plaid beret.
* **Clothing:** Her outfit consists of an oversized teal cardigan with white stripes on the cuffs, a white collared shirt, a dark tie, and a dark plaid skirt. A large, fluffy white and grey fur stole is draped over her shoulders. Attached to or part of this stole is a large, colorful sloth-like head with rainbow-colored fur around its face.
```

#### GPT/Codex escalation description

```text
Full-body anime character illustration on a mostly black/transparent background. The character has pale hair with colored streaks, a black plaid beret, teal oversized cardigan, short skirt, black knee socks, yellow-laced shoes, and a large fluffy white tail-like accessory ending in a rainbow-colored sloth face. A large red rectangle with narrow colored stripes appears behind/right of the character, likely a graphic artifact or background block. No clearly readable text is visible.
```

### Image 4: `image_04.jpeg`

{{< gallery >}}
![Benchmark image 4: image_04.jpeg](./images/image_04.jpeg)
{{< /gallery >}}


- **Route:** `gemma_only`
- **Escalation reason:** `—`

#### GPT/Codex baseline description

```text
A close-up photo of a tabby-and-white cat sitting on a reddish-brown wooden floor. The cat has green eyes, white chest/muzzle/legs, tabby markings on the head and back, and a collar with a bell. The framing crops the top and lower parts slightly, but the cat is the clear subject. No visible text. Background is mainly wood flooring with a dark strip near the top.
```

#### Gemma-first description

```text
A domestic cat is the main subject, sitting upright on a wooden floor.

**Important objects/details:**
* The cat has a white and grey tabby coat, with white fur on its chest, face, and legs, and grey tabby markings on its head, back, and sides.
* It has green eyes and is looking towards the camera.
* The cat is wearing a collar with a small, silver-colored bell attached.

**Background/context:**
* The cat is sitting on a dark brown wooden floor with visible planks.
* The background is simple and out of focus.

**Visible text:**
* There is no visible text in the image.

**Ambiguity or uncertainty:**
* The specific breed of the cat cannot be determined.
```

### Image 5: `image_05.jpeg`

{{< gallery >}}
![Benchmark image 5: image_05.jpeg](./images/image_05.jpeg)
{{< /gallery >}}


- **Route:** `gemma_only`
- **Escalation reason:** `—`

#### GPT/Codex baseline description

```text
A chibi-style digital drawing of a pale/white-haired girl standing with one hand near her mouth. She wears a dark gray-green school-uniform-like outfit with a bow, pleated skirt, tall socks/boots, and oversized shoes; a small purple blob-like creature with sleepy eyes sits beside her. The background is plain white. Faint watermark text across the body appears to read "@mt_LOO" or similar, but it is partially transparent and uncertain.
```

#### Gemma-first description

```text
This image features a single chibi-style anime character against a plain white background.

1.  **Main subject:** A young girl with long, flowing white hair and reddish-brown eyes. She is posed thoughtfully with one hand near her chin.
2.  **Important objects/details:**
    *   The character wears a dark grey or black school uniform, including a blazer, a pleated skirt with white stripes, dark socks, and dark shoes.
    *   A small, white, triangular hair clip is visible in her hair.
    *   To the left of the character, there is a small, dark purple, oval-shaped object or creature with eyes.
3.  **Background/context:** The background is solid white, with no other environmental context.
4.  **Visible text:** The watermark "@muf_oo" is visible on the character's blazer.
5.  **Ambiguity/uncertainty:** The identity of the small purple object is unclear; it could be a small pet, a spirit, or a decorative element.
```

### Image 6: `image_06.jpeg`

{{< gallery >}}
![Benchmark image 6: image_06.jpeg](./images/image_06.jpeg)
{{< /gallery >}}


- **Route:** `gemma_only`
- **Escalation reason:** `—`

#### GPT/Codex baseline description

```text
An anime-style illustration of a pale-haired girl wearing an ornate blue-white outfit and a large decorative hat. She is smiling slightly and raising one gloved hand upward; the clothing includes lace, floral/rose decorations, beads, a blue pendant, and dangling cross-like ornaments. The background is plain white. I do not see visible readable text.
```

#### Gemma-first description

```text
An anime-style illustration of a girl with long, pale blue or white hair.

* **Main subject:** A girl with a slight smile, pale eyes, and long, straight, light-colored hair, dressed in an ornate, Victorian-inspired outfit.
* **Important objects/details:** She wears a large, wide-brimmed hat decorated with white roses and dark blue or black lace trim. Her clothing is a white, highly detailed garment featuring intricate dark lace patterns, scalloped edges, and white rose accents. One arm is raised with a finger pointing upward, wearing a dark-colored glove. Small, dark-colored ornaments hang from her hat or clothing.
* **Background/context:** The background is a solid, plain white.
* **Visible text:** None.
* **Ambiguity or uncertainty:** The dark color of the
```

### Image 7: `image_07.jpeg`

{{< gallery >}}
![Benchmark image 7: image_07.jpeg](./images/image_07.jpeg)
{{< /gallery >}}


- **Route:** `gemma_then_gpt`
- **Escalation reason:** `ocr_or_quality_risk`

#### GPT/Codex baseline description

```text
A meme-like drawing of a blonde anime girl with blue eyes and a flower crown holding a sign in front of a grassy/wooded background. A gray figure or shadow stands behind her near a tree. The sign reads: "Fun Fact! You can't look up while your tongue is out"; the lower line is partly cropped but still inferable. No other clear text is visible.
```

#### Gemma-first description

```text
An anime-style illustration of a young girl holding a sign.

* **Main subject or scene:** A young girl with long blonde hair and blue eyes, wearing a crown of brown flowers, holding a white rectangular sign.
* **Important objects/details:** The girl has a small smile and is looking directly forward. Her hands are visible at the bottom corners of the sign.
* **Background/context:** A soft-focus, painterly background depicting a natural setting with green, white, and light orange/pink tones, suggesting a meadow or park. A dark, vertical shape, likely a tree trunk, is visible on the right.
* **Visible text:** "Fun Fact! You can't look up while your tongue is out"
* **Ambiguity or uncertainty:** The background is blurry, making the exact landscape difficult to identify. The bottom edge of the sign is slightly cut off.
```

#### GPT/Codex escalation description

```text
Hand-drawn meme-style image of a blonde anime girl with blue eyes and a flower crown holding a sign outdoors near a tree. The sign reads: 'Fun Fact! You can't look up while your tongue is out'. The scene is lightly sketched/painted with a grassy background. The lower part of the sign is close to the crop edge, but the sentence is still readable.
```

### Image 8: `image_08.jpeg`

{{< gallery >}}
![Benchmark image 8: image_08.jpeg](./images/image_08.jpeg)
{{< /gallery >}}


- **Route:** `gemma_then_gpt`
- **Escalation reason:** `ocr_or_quality_risk`

#### GPT/Codex baseline description

```text
A work-in-progress electronics or arcade-controller-like circular panel is lying on a bed with a cream plaid blanket. The assembly has a large circular ring, many red/blue/black wires, copper contacts or pads around the ring, tape/adhesive, zip ties, and loose red wiring on the right. A small white tag near the lower right appears to read "DNG" or similar, but it is unclear. Background includes bedding and a blue tool at the right.
```

#### Gemma-first description

```text
An image of an electronic or DIY project component resting on a bed.

1.  **Main subject or scene:** A large, square white panel with a circular transparent center, featuring an intricate black geometric pattern and numerous connected wires, lying on a bed.
2.  **Important objects/details:**
    *   **The panel:** A white, square board with a circular cutout in the middle. Around the perimeter of this circle, there is a ring of small, translucent components.
    *   **Wiring:** A large, tangled bundle of red, black, and white wires is connected to the components around the circle and extends toward the right side of the frame.
    *   **Pattern:** A black, maze-
```

#### GPT/Codex escalation description

```text
Photo of a large circular electronics/mechanical assembly lying on a cream plaid blanket. The ring has many small copper/silver contact pads or modules around it, with red, blue, black, and white wires routed around the circumference and bundled on the right. A blue-handled tool is at the right edge, and part of a character pillow is visible at the left. No meaningful readable text is visible; some tiny labels on parts may be present but are not legible.
```

### Image 9: `image_09.jpeg`

{{< gallery >}}
![Benchmark image 9: image_09.jpeg](./images/image_09.jpeg)
{{< /gallery >}}


- **Route:** `gemma_then_gpt`
- **Escalation reason:** `empty_gemma_response`

#### GPT/Codex baseline description

```text
A close-up of a hand holding a white PCB in a cluttered electronics workspace. The board appears to be a controller/keyboard-style PCB with many labeled switch or connector footprints and a USB-C port. Readable labels include "Maji Pico Lite", "USB1", "BT1", "BT2", "BT3", "BT4", "BT5", "BT6", "BT7", "AUX2", "AUX3", "AUX4", "SWCLK", many GPIO/GND labels such as "GP0"-style markings, "3V3", "VREF", "AGND", "RUN", "U1", and partial long numeric strings. Some tiny silkscreen text is too small or cropped to read reliably.
```

#### Gemma-first description

```text
_No visible model output recorded._
```

#### GPT/Codex escalation description

```text
Close-up photo of a white custom keyboard PCB held in front of a cluttered electronics workspace. The PCB has a USB-C port, many labeled switch/diode footprints, and a small sheep/mascot graphic near a stained or flux-marked area. Visible text includes 'Mai Pico Lite', 'USB1', labels such as AUX1/AUX2/AUX3/AUX4, BT1/BT2/BT3/BT4/BT5/BT6/BT7/BT8, MPR1/MPR2/MPR3/MPR4, SWCLK, GND, GP0–GP28, RUN, AGND, VREF, 3V3, and diode/capacitor labels like D13/D14/D15/D18/D19 and '100n'. Some labels are partially cut off or blurred.
```

### Image 10: `image_10.jpeg`

{{< gallery >}}
![Benchmark image 10: image_10.jpeg](./images/image_10.jpeg)
{{< /gallery >}}


- **Route:** `gemma_then_gpt`
- **Escalation reason:** `empty_gemma_response`

#### GPT/Codex baseline description

```text
A PC hardware build scene with an open small-form-factor case or frame on a desk mat. A large triple-fan graphics card is installed, with additional fans visible above it and braided cables routed through the chassis. The desk mat has green grid labels including "MK-000011", "MK-000012", "MK-000013", "MK-000014", "MK-000015", "MK-000016", "MK-000017", and other partial markings. The graphics card side shows "GEFORCE RTX" and "GAMING"/branding partially visible. A power-supply label with small warning/specification text is present but too small to read fully.
```

#### Gemma-first description

```text
_No visible model output recorded._
```

#### GPT/Codex escalation description

```text
Photo of a PC build/test bench area. On the right is an open computer case with multiple fans and a graphics card visible; black sleeved cables and a power supply occupy the lower right. The surface underneath is a green/purple cutting mat or desk mat with printed grid-like labels. Visible text includes 'MX0132', 'MK-000012', '01010', 'MX0133', 'MK-000013', 'MX0134', 'MK-000014', 'MX0135', 'MK-000015', 'MX0136', 'MK-000016', and partial 'MX0137/MK-000017'. A label on the PSU/case contains Chinese and other tiny certification text, but most is too small to read accurately.
```

### Image 11: `image_11.jpeg`

{{< gallery >}}
![Benchmark image 11: image_11.jpeg](./images/image_11.jpeg)
{{< /gallery >}}


- **Route:** `gemma_only`
- **Escalation reason:** `—`

#### GPT/Codex baseline description

```text
A partially assembled 3D-printer/CNC-style frame is shown, apparently rotated sideways in the photo. Visible parts include black and blue aluminum extrusions, clear panels, brackets, a spool of turquoise filament feeding into the mechanism, and another black frame beside it. It is sitting on or near a wooden tabletop/floor. No clearly readable text is visible. The exact machine model is uncertain from this crop.
```

#### Gemma-first description

```text
An image showing a partially assembled 3D printer frame next to a completed 3D printer.

1.  **Main subject or scene:** A rectangular frame made of black aluminum extrusions, likely part of a 3D printer under construction, sitting on a wooden workbench next to a fully enclosed 3D printer.
2.  **Important objects/details:**
    *   **Unfinished frame:** A structure made of black T-slot aluminum extrusions with light green/mint-colored 3D-printed corner pieces at the base.
    *   **Enclosed 3D printer:** Located on the left, featuring a transparent enclosure and black structural components. A spool of
```

### Image 12: `image_12.jpeg`

{{< gallery >}}
![Benchmark image 12: image_12.jpeg](./images/image_12.jpeg)
{{< /gallery >}}


- **Route:** `gemma_then_gpt`
- **Escalation reason:** `ocr_or_quality_risk`

#### GPT/Codex baseline description

```text
A disassembled hardware or machine assembly lies on a wooden floor beside a cabinet/wall. Visible parts include a black metal/plastic frame, wiring harnesses, red/yellow/black wires, a silver power-supply-like metal box, pink straps, connectors, and green-handled pliers. Small warning/spec labels are present on the power-supply-like part, but the text is too small/blurred to read reliably. The exact device is uncertain.
```

#### Gemma-first description

```text
This image shows a collection of disassembled electronic components and hardware lying on a wooden floor.

1.  **Main subject or scene:** A pile of various electronic parts, including metal chassis pieces, a power supply, and wiring, scattered on a polished wooden floor.
2.  **Important objects/details:**
    *   A large, black metal component, possibly part of a computer case or chassis.
    *   A silver power supply unit (PSU) with several colored wires (yellow, red, and black) extending from it.
    *   A green printed circuit board (PCB) with various electronic components.
    *   Numerous black, red, and yellow cables and wires.
    *   A pinkish-red strap or ribbon and a black strap.
```

#### GPT/Codex escalation description

```text
Photo of a partially disassembled machine or electronics/mechanical assembly on a wooden floor. It shows black metal/plastic frame parts, motors or hinges, wiring harnesses, a gray power-supply-like module, connectors, and loose tools including pliers. Pink straps or bands are looped near the top/right, and a large beige/gray panel is at the side. Some small labels are visible on components, but the text is too small or blurred to read confidently.
```

### Image 13: `image_13.jpeg`

{{< gallery >}}
![Benchmark image 13: image_13.jpeg](./images/image_13.jpeg)
{{< /gallery >}}


- **Route:** `gemma_then_gpt`
- **Escalation reason:** `empty_gemma_response`

#### GPT/Codex baseline description

```text
A close-up of a white PCB populated with small black switches and white LEDs, likely part of a keyboard/controller. It has an anime-style face illustration, a QR code, and multiple silkscreen labels. Readable or partly readable text includes "Made by Zekamashi/Umi4Life", "v2", "5zf60_0001", component labels such as "D11", "D12", "D13", "D14", "D15", "D17", "D18", "D19", "C19", and "100n". Some small text is blurred/cropped and cannot be read confidently.
```

#### Gemma-first description

```text
_No visible model output recorded._
```

#### GPT/Codex escalation description

```text
Close-up photo of a white PCB with many hot-swap switch sockets, SMD components, and diode/capacitor labels. There is a small anime-style face graphic printed near the top center and a QR code on the right. Visible text includes 'Made by Zekamashi/Umi4Life' or similar (partially blurred), 'v2', 'D13', 'D14', 'D15', 'D17', 'D18', 'D19', 'C18', 'C19', and repeated '100n' capacitor markings. Under the QR code is '5zf60_0001' or similar; exact characters are slightly blurred.
```

### Image 14: `image_14.jpeg`

{{< gallery >}}
![Benchmark image 14: image_14.jpeg](./images/image_14.jpeg)
{{< /gallery >}}


- **Route:** `gemma_only`
- **Escalation reason:** `—`

#### GPT/Codex baseline description

```text
A black NVIDIA-style graphics card is resting on a table. The side shroud clearly reads "GEFORCE RTX" in white letters, with a blower-style fan opening and PCIe connector visible. Background objects include a patterned box, a black case or wallet-like item, and window light/reflections. No other clear text is visible.
```

#### Gemma-first description

```text
This image features a graphics card as the main subject.

* **Main subject:** A black NVIDIA GeForce RTX graphics card.
* **Important objects/details:** The card has a glossy black shroud with a visible cooling fan behind a circular grille. A gold-colored PCIe connector is visible at the top left edge.
* **Background/context:** The card is resting on a dark, smooth surface, likely a table. In the background, there is a reflection of a window with blinds on a reflective surface, along with some colorful patterned objects and a dark green box.
* **Visible text:** "GEFORCE RTX"
* **Ambiguity:** The specific model of the GeForce RTX graphics card cannot be determined from the visible information.
```

### Image 15: `image_15.jpeg`

{{< gallery >}}
![Benchmark image 15: image_15.jpeg](./images/image_15.jpeg)
{{< /gallery >}}


- **Route:** `gemma_only`
- **Escalation reason:** `—`

#### GPT/Codex baseline description

```text
A very blurry close-up of a hand holding a black electrical or mechanical component with multiple metal screw terminals/lugs. The background appears to be an electronics or machine work area with pink straps, wires, tools, and a gray/metal box, but most details are out of focus. There may be molded markings on the black component, but no text is reliably readable. The exact part type is uncertain due to blur.
```

#### Gemma-first description

```text
A hand is holding a black electrical power inlet (likely an IEC C14 type) in front of a wooden surface.

* **Main subject:** A person's hand holding a black plastic electrical component with three metal terminals.
* **Important objects/details:** The component features three silver-colored metal connection points arranged in a triangular pattern. The hand is gripping the component between the thumb and fingers.
* **Background/context:** The background is a wooden surface with several out-of-focus objects, including pink/red colored wires and other electronic parts.
* **Visible text:** The text "10A 250V
```

### Image 16: `image_16.jpeg`

{{< gallery >}}
![Benchmark image 16: image_16.jpeg](./images/image_16.jpeg)
{{< /gallery >}}


- **Route:** `gemma_then_gpt`
- **Escalation reason:** `ocr_or_quality_risk`

#### GPT/Codex baseline description

```text
A rendered product-style image of a black USB dongle or adapter with a USB-A plug on the right and a beige label with a QR code. Readable label text includes "PART NO.", "000-0000-000X", "SERIAL NO.", "A02E-00X0000", and "SDVX ST IH". The background is plain white. It may be a 3D render rather than a physical photo.
```

#### Gemma-first description

```text
This image features a single electronic device, likely a USB flash drive or similar peripheral, set against a plain white background.

1.  **Main subject:** A black, rectangular electronic device with a USB Type-A connector at one end.
2.  **Important objects/details:** The device has a matte black finish with some structural ridges. A white rectangular label is affixed to the top surface, containing a Data Matrix barcode and several lines of printed text.
3.  **Background/context:** The object is isolated on a solid, seamless white background.
4.  **Visible text:**
    *   PART NO.
    *
```

#### GPT/Codex escalation description

```text
Rendered product-style image of a black USB dongle or cartridge-like device with a USB-A connector. A beige label on top includes a QR code and printed fields. Visible text reads 'PART NO.' with '000-0000-000X' or similar, 'SERIAL NO.' with 'A02E-00X0000', and 'SDVX STH'. Some zero/X characters are ambiguous because of resolution and perspective.
```

### Image 17: `image_17.jpeg`

{{< gallery >}}
![Benchmark image 17: image_17.jpeg](./images/image_17.jpeg)
{{< /gallery >}}


- **Route:** `gemma_then_gpt`
- **Escalation reason:** `empty_gemma_response`

#### GPT/Codex baseline description

```text
A smartphone screenshot of a dark-themed rh3d.xyz page showing a 3D model of a box-frame 3D printer. The phone status bar shows "20:27", "4G", and battery "60". Page text includes "rh3d.xyz", "MODEL: VIRTU E3", "FULLSCREEN", "Thank you :)", "page rev 0.82", and a lower copyright line beginning "Copyright © 2026 Radek Honc. E3NG, VIRTU and V-ION by RH3D are...". Some top text is cropped and faint; lower copyright text is partially cut off.
```

#### Gemma-first description

```text
_No visible model output recorded._
```

#### GPT/Codex escalation description

```text
Mobile screenshot of the rh3d.xyz site showing a 3D model viewer for a 3D printer. The model is labeled 'MODEL: VIRTU E3' with a 'FULLSCREEN' button. The page shows a cube/view icon, 'page rev 0.82', and footer text beginning 'Copyright © 2026 Radek Honc. E3NG, VIRTU and V-ION by RH3D are ...'. At the top, the phone status bar shows 20:27, 4G, and 60% battery, and nearby text includes 'rh3d.xyz', 'Thank you :)', and a faint cropped note ending 'Patreon), please keep it for yourself.' Some footer text is cropped off.
```

### Image 18: `image_18.jpeg`

{{< gallery >}}
![Benchmark image 18: image_18.jpeg](./images/image_18.jpeg)
{{< /gallery >}}


- **Route:** `gemma_then_gpt`
- **Escalation reason:** `empty_gemma_response`

#### GPT/Codex baseline description

```text
A rack-mounted or portable networking/computing setup inside a black rack/case. The front module has an orange panel with multiple Ethernet/USB ports and cables plugged in; a small display is visible on the left, and a switch or router sits above it. Readable text includes "001" on a top label and "rocstor" on the lower rack/case. The network switch label appears to include "2.5G" and "PoE", but much of the small text is too small to read confidently.
```

#### Gemma-first description

```text
_No visible model output recorded._
```

#### GPT/Codex escalation description

```text
Photo of a rack-mounted or small lab network/server setup inside a rack. An orange-front modular unit has several Ethernet/USB ports and cables connected; above it is a switch labeled '8-Port 2.5G PoE Switch with 2*10G SFP+' or similar. A small display on the orange unit shows status text, and a label at top reads '001'. The rack/base branding at the bottom appears to read 'rocstor'. Port labels and small screen details are too small to read fully.
```

### Image 19: `image_19.jpeg`

{{< gallery >}}
![Benchmark image 19: image_19.jpeg](./images/image_19.jpeg)
{{< /gallery >}}


- **Route:** `gemma_then_gpt`
- **Escalation reason:** `ocr_or_quality_risk`

#### GPT/Codex baseline description

```text
A computer or server case sits on a shelf against a wood-paneled wall, with two wall outlets above it and black power cords plugged in. The case has a black mesh front, wood-tone trim, a glowing circular power button, status LEDs, USB/front-panel ports, and a decorative sticker showing a small anime figure and a house/building. The sticker includes stylized text and Japanese/Chinese-looking characters, but the exact wording is not fully readable. A cardboard box rests partly on top of the case.
```

#### Gemma-first description

```text
A black computer tower is the main subject, sitting on a light-colored wooden surface.

**Important objects/details:**
* **Computer Case:** A black tower with a mesh front panel and a horizontal strip with a wood-grain texture. A sticker depicting a building with a windmill is on the front. A blue light is visible near one of the front ports.
* **Items on/around the case:** A plain cardboard box sits on top of the computer. To the left is a pink, fabric-like object, and to the right is a small, yellow object.
* **Electrical:** Two white wall outlets are mounted on the wall above the case. One has a power cable plugged into
```

#### GPT/Codex escalation description

```text
Photo of a desktop/tower PC on a table beneath two wall outlet plates. One plug is in the left outlet and a loose cable is plugged into the right plate; a cardboard piece rests on top of the PC. The PC front has a lit power button, green status LEDs, front USB/audio ports, and a decorative sticker featuring an anime character and a house/watermill scene. The sticker includes stylized text and Japanese/Chinese characters, but they are too small/blurred to read confidently. No other clear text is visible.
```

### Image 20: `image_20.jpeg`

{{< gallery >}}
![Benchmark image 20: image_20.jpeg](./images/image_20.jpeg)
{{< /gallery >}}


- **Route:** `gemma_only`
- **Escalation reason:** `—`

#### GPT/Codex baseline description

```text
A sashimi platter on a boat or near open water. It includes a fish head and body section, translucent sliced raw fish arranged over shredded daikon, cucumber slices fanned in two groups, lemon slices, and wasabi on the right. The basket/tray rim and blue-green water are visible in the background. No visible text. The exact fish species is uncertain from the image alone.
```

#### Gemma-first description

```text
**Main subject or scene:** A platter of sashimi, featuring a fish head and slices of white fish, presented on a woven tray.

**Important objects/details:**
* **Sashimi:** Numerous slices of translucent white fish are arranged in the center, resting on a bed of shredded white radish (daikon).
* **Fish head:** A whole fish head is positioned at the top of the platter.
* **Garnishes:** Sliced cucumbers are arranged in a fan shape; lemon wedges are on the left side; and a small dollop of wasabi is in the bottom right corner.
* **Platter:** The food is served on a round, woven bamboo or wicker tray.

**Background/context:** The tray is set against a background of blue, rippled water, suggesting an outdoor setting near the sea or ocean.

**Visible text:** None.

**Ambiguity or uncertainty:** The specific species of the fish is not identifiable with certainty.
```

---

## What Went Wrong

The most important operational failure was empty Gemma output.

From the engineering notes:

```text
Several Gemma-first calls returned no visible response_text even though
the LiteLLM request completed.
```

The failed image indices were:

```text
9, 10, 13, 17, 18
```

The resolution was to mark those records explicitly:

```text
status: failed_empty_response
```

Then the router escalated those images to GPT/Codex.

This matters because many orchestration layers treat a completed API call as success. For a vision router, that is insufficient. The content itself has to pass validation.

A weaker implementation might have treated successful request metadata as success and returned an empty or useless answer to the user. That would make the assistant feel flaky.

Interesting. The model did not merely make a bad judgment. It sometimes failed to produce visible output at all.

That is a different class of failure.

---

## Quota Caveat

Quota snapshots were captured before and after each window.

| Snapshot | Session | Weekly |
|---|---|---|
| `A_before` | Session: 95% remaining (5% used) | Weekly: 57% remaining (43% used) |
| `A_after` | Session: 83% remaining (17% used) | Weekly: 55% remaining (45% used) |
| `A_delta` | **+12 pp** used (5% → 17%) | **+2 pp** used (43% → 45%) |
| `B_before` | Session: 75% remaining (25% used) | Weekly: 54% remaining (46% used) |
| `B_after` | Session: 68% remaining (32% used) | Weekly: 53% remaining (47% used) |
| `B_delta` | **+7 pp** used (25% → 32%) | **+1 pp** used (46% → 47%) |

However, I do **not** interpret these as exact per-call cost accounting.

Hermes itself was running inside the active Codex-backed session. Tool orchestration, verification, message handling, and summarization can all move the same quota meter.

So I treat the quota snapshots as supporting context, not as the primary result.

The safest interpretation is:

```text
The experiment measured GPT/Codex call pressure reduction,
not exact quota savings.
```

The clean operational number is:

```text
GPT-only:          20 GPT/Codex vision calls
Gemma-first route: 12 GPT/Codex vision calls

Avoided: 8 GPT/Codex vision calls
```

That is the result worth keeping.

---

## Limitations

This benchmark was intentionally small. It used 20 images, which is enough to test the routing workflow but not enough to make broad claims about Gemma's vision quality.

The dataset was also based on realistic Hermes inputs rather than a standardized public benchmark. That makes the result more useful for my workflow, but less comparable to other model evaluations.

The image categories were not formally labeled before the run. That means I can discuss the dataset qualitatively, but I should not pretend to have precise category counts.

Finally, the router measured avoided GPT/Codex calls, not exact quota or cost savings. The visible quota meter is too coarse, and the surrounding Hermes/Codex session can consume quota independently of image interpretation.

---

## What We Learned

### 1. Gemma is useful as a first-pass visual triage model

For simple, low-stakes image descriptions, Gemma can produce enough information to avoid calling GPT.

This is useful for assistant workflows where the first question is only:

```text
Is this image worth escalating?
```

or:

```text
Give me a rough description.
```

### 2. Gemma is not reliable enough as the only vision model

The empty-output failure mode is too common to ignore.

A local helper that returns empty content 25% of the time cannot be the final authority unless the task is extremely low risk and the UI handles failure gracefully.

### 3. The router matters more than the model

The useful system is not:

```text
Replace GPT with Gemma
```

The useful system is:

```text
Gemma first
GPT when needed
strict escalation rules
auditable routing
```

The router is what makes the system safe.

### 4. OCR and exact text should escalate

Images involving text are high-risk for weaker vision models.

This includes:

- screenshots
- UI state
- forms
- labels
- badges
- serial numbers
- hardware markings
- PCB labels
- documents
- diagrams with small text
- anything requiring exact transcription

These should go to GPT/Codex unless the user explicitly accepts rough interpretation.

### 5. Successful request metadata is not enough

The system must validate visible assistant content.

This check is mandatory:

```text
if response_text is empty:
    mark failed_empty_response
    escalate to GPT
```

Without this, the assistant may silently return useless results.

---

## Recommended Routing Policy

The conservative policy is:

```text
Use Gemma first for low-stakes image understanding.

Escalate to GPT/Codex if:
- Gemma output is empty
- Gemma says it is uncertain
- Gemma omits visible text
- the image contains OCR/tiny text
- the image is a screenshot or UI
- the image contains labels, forms, badges, serial numbers, PCBs, or documents
- the user asks for exact transcription or diagnosis
- the result has operational, security, financial, or safety impact
```

The route record should be explicit:

```json
{
  "image_index": 9,
  "route": "gemma_then_gpt",
  "escalation_reason": "empty_gemma_response"
}
```

This makes later debugging possible.

---

## Future Improvements

### 1. Add automatic image classification before routing

Before sending an image to Gemma, classify the image type:

```text
screenshot
document
hardware photo
PCB
meme
anime/art
diagram
general photo
```

Some categories should bypass Gemma entirely.

For example:

```text
screenshot/document/PCB/OCR-heavy
→ GPT directly
```

while:

```text
general photo/art/simple object
→ Gemma first
```

### 2. Add confidence and completeness checks

Gemma output should be checked for signs of uncertainty:

```text
unclear
cannot read
not sure
possibly
appears to be
text is too small
```

Some uncertainty is honest and useful. But for exact-answer tasks, uncertainty should trigger escalation.

### 3. Track latency and local resource cost

This benchmark focused mostly on routing and call pressure.

A future version should record:

- Gemma latency
- GPT latency
- local GPU/CPU load
- memory pressure
- timeout frequency
- retry frequency
- output token counts
- empty-output rate by image category

The local model is not “free” if it is slow, unstable, or blocks the host.

### 4. Score image outputs more formally

The current benchmark was enough to decide routing policy, but future evaluation could score each model on:

```text
main subject accuracy
important detail coverage
OCR correctness
hallucination control
usefulness
```

A simple 0–3 rubric per category would make model comparison cleaner.

### 5. Test more local vision models

Gemma was good enough to justify the architecture, but not good enough to fully trust.

Future candidates could be tested through the same harness:

```text
local model
→ same 20-image dataset
→ same prompt
→ same router rules
→ same verification checks
```

The benchmark now has a reusable structure.

### 6. Make the router production-safe

A production version should include:

- hard timeout
- retry once on empty output
- fail closed to GPT
- structured route logs
- secret redaction
- per-image audit trail
- model/version metadata
- escalation reason
- final answer provenance

The user-facing assistant should know whether an answer came from:

```text
Gemma only
Gemma + GPT escalation
GPT directly
```

That makes debugging much easier.

---

## Final Conclusion

The experiment did not prove that Gemma can replace GPT vision.

It proved something more useful:

> A local multimodal model can reduce GPT vision calls when used as a conservative first-pass triage layer.

In this benchmark, Gemma-first routing avoided 40% of GPT/Codex vision calls.

But Gemma also returned empty visible output on 25% of images, so the safe design is not replacement. It is escalation.

The architecture I would keep is:

```text
Gemma for cheap first-pass perception.
GPT/Codex for exact, risky, text-heavy, or failed cases.
Router fails closed.
Every decision is logged.
```

That is less flashy than “local model replaces premium model.”

But it is much more operationally honest.

And operationally honest systems are the ones that survive contact with real workflows.
