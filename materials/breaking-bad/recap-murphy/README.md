# 墨菲一口气解说 · 本地研究素材

这是做本游戏时收集的解说研究，不是剧方剧本。

来源：[一口气24小时看完《绝命毒师》+《续命之徒》【墨菲】](https://www.bilibili.com/video/BV1QN4y1B7Xu)

原先在桌面 `黑客松/转录/`，2026-08-13 收进本仓库。

## 怎么用

先读 `语言风格与剧本结构.md`。
那是从 P01–P06 ASR 里抽出来的口播骨架：冷开、按集循环、彩蛋附录、季末升华。

`transcripts/` 是 Stepfun ASR 原文，给人对照，不进产品检索、不进 embedding、不当角色台词。

## 不要拿来做什么

这不是 Sony / AMC 对白。
不要把全文塞进 `buildContextPrompt` 或知识图。
角色说话仍走 `SOURCES.md` 里的短规则和自写 `voice_rules`。

## 音频

转写时的 m4a 不在这个目录。
工作副本还在本机 `~/Documents/transcripts/2026-08-06_murphy-bb-p0*`。
脚本若要重跑 ASR，先把音频放回 `audio/`，再跑 `transcripts/run_asr_rest.sh`。
