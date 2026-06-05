---
title: Colophon
description: What powers umi4.life - stack, hosting, and credits.
date: 2026-06-05
lastmod: 2026-06-05
translationKey: colophon
draft: false
toc: false
comment: true
---

This page lists what runs the site and who deserves credit. I picked a static Hugo setup so the blog stays fast, cheap to host, and easy to version alongside the homelab repos it documents.

## Site generator & theme

| Component | Credit |
| --- | --- |
| [Hugo](https://gohugo.io/) | Static site generator |
| [hugo-theme-reimu](https://github.com/D-Sketon/hugo-theme-reimu) | Original theme by [D-Sketon](https://github.com/D-Sketon) ([MIT](https://github.com/D-Sketon/hugo-theme-reimu/blob/main/LICENSE)) |
| [Umi4Life/hugo-theme-reimu](https://github.com/Umi4Life/hugo-theme-reimu) | Personal fork (`setsuna` branch): Setsuna branding, layout tweaks, and site-specific customizations |

## Hosting & build

- **Deploy**: [GitHub Pages](https://pages.github.com/) via [GitHub Actions](https://github.com/Umi4Life/umi4.life/blob/master/.github/workflows/hugo.yaml)
- **Domain**: [umi4.life](https://umi4.life/)

## Features in use

- [Waline](https://waline.js.org/): comments (self-hosted at `waline.umi4.life`)
- [APlayer](https://github.com/DIYgod/APlayer) + [MetingJS](https://github.com/metowolf/MetingJS): sidebar music player
- [KaTeX](https://katex.org/): math rendering (when enabled on a page)
- [Busuanzi](https://busuanzi.ibruce.info/): visitor counters in the footer
- Material You dynamic theming, PJAX navigation, and the Reimu cursor/firework polish from the theme

## Content

Blog posts are written in Markdown, stored in this [Git repository](https://github.com/Umi4Life/umi4.life), and built with Hugo Extended. Post content is Hermes Agent-assisted and human-reviewed unless noted otherwise.

## License

Post content on this blog is licensed under [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) unless stated otherwise. The Reimu theme remains under its original MIT license.
