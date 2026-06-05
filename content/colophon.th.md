---
title: โคโลฟอน
description: อะไรขับเคลื่อน umi4.life - stack, hosting และ credits
date: 2026-06-05
lastmod: 2026-06-05
translationKey: colophon
draft: false
toc: false
comment: true
---

หน้านี้รวมสิ่งที่รันเว็บไซต์และใครควรได้รับเครดิต ผมเลือกใช้ Hugo แบบ static เพื่อให้บล็อกโหลดเร็ว โฮสต์ถูก และ version คู่กับ homelab repo ที่บล็อกนี้ document ได้ง่าย

## ตัวสร้างเว็บและธีม

| ส่วนประกอบ | เครดิต |
| --- | --- |
| [Hugo](https://gohugo.io/) | Static site generator |
| [hugo-theme-reimu](https://github.com/D-Sketon/hugo-theme-reimu) | ธีมต้นฉบับโดย [D-Sketon](https://github.com/D-Sketon) ([MIT](https://github.com/D-Sketon/hugo-theme-reimu/blob/main/LICENSE)) |
| [Umi4Life/hugo-theme-reimu](https://github.com/Umi4Life/hugo-theme-reimu) | Fork ส่วนตัว (branch `setsuna`): Setsuna branding, ปรับ layout และ customization เฉพาะเว็บนี้ |

## การโฮสต์และ build

- **Deploy**: [GitHub Pages](https://pages.github.com/) ผ่าน [GitHub Actions](https://github.com/Umi4Life/umi4.life/blob/master/.github/workflows/hugo.yaml)
- **โดเมน**: [umi4.life](https://umi4.life/)

## ฟีเจอร์ที่ใช้งาน

- [Waline](https://waline.js.org/): ระบบคอมเมนต์ (self-host ที่ `waline.umi4.life`)
- [APlayer](https://github.com/DIYgod/APlayer) + [MetingJS](https://github.com/metowolf/MetingJS): เครื่องเล่นเพลงใน sidebar
- [KaTeX](https://katex.org/): แสดงสูตรคณิต (เมื่อเปิดใช้ในหน้านั้น)
- [Busuanzi](https://busuanzi.ibruce.info/): ตัวนับผู้เข้าชมใน footer
- Material You dynamic theming, PJAX navigation และ Reimu cursor/firework จากธีม

## เนื้อหา

โพสต์บล็อกเขียนด้วย Markdown เก็บใน [Git repository](https://github.com/Umi4Life/umi4.life) นี้ และ build ด้วย Hugo Extended เนื้อหาโพสต์ได้รับความช่วยจาก Hermes Agent และมีการตรวจโดยมนุษย์ก่อนเผยแพร่ เว้นแต่จะระบุไว้เป็นอย่างอื่น

## License

เนื้อหาโพสต์ในบล็อกนี้อยู่ภายใต้ [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) เว้นแต่จะระบุไว้เป็นอย่างอื่น ธีม Reimu ยังคงอยู่ภายใต้ MIT license ต้นฉบับ
