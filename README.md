# ToneMatrixEX 🎶

[🇬🇧 Skip to English Version](#english-version)

<div align="center">
  <img src="QQ20260805-034132.jpg" width="72%" alt="ToneMatrixEX">
  
  <h3>
    <a href="https://pkmnya.github.io/ToneMatrixEX/">👉 点此在线体验 (Play Online) 👈</a>
  </h3>
</div>

> 一个受 André Michelle 的 **ToneMatrix** 启发的 Web Grid Sequencer。
> 既可以随手玩旋律，也可以作为 Suno、Udio 等 AI 音乐工具的 Motif Generator。

---

## 关于项目

ToneMatrixEX 最初只是想复刻 ToneMatrix 那种「点几下就能听到旋律」的乐趣，但后来慢慢演变成了一个更适合现代 AI 音乐创作的小工具。

很多时候，直接给 AI 输入 Prompt，旋律和节奏都会比较随机。如果先用 ToneMatrixEX 快速画出一个简单的 Motif，再导出音频作为参考输入，就能给 AI 一个更明确的节奏和旋律方向。

它不是 DAW，也不是专业编曲软件，而是一个适合快速记录灵感、生成旋律种子的工具。

> 本项目部分代码在 Gemini 的辅助下完成。

---

## 功能

* 🎵 基于 **Tone.js**，拥有稳定的音频调度和多种合成器音色
* 💾 内置 **MP3 导出**（lamejs），方便直接用于 AI 工作流
* 💬 集成 **Waline 评论系统**，方便交流和分享作品
* ⚡ 使用 **Vite + TypeScript** 构建，开发体验简单流畅

---

## 一个比较有趣的玩法

我自己比较常用的一种工作流：

```
ToneMatrixEX
        │
        ├── 画一个简单 Motif
        │
        ├── 导出 MP3
        │
        ▼
Suno / Udio
        │
        ▼
AI 扩展完整编曲
```

很多时候，一个只有几秒钟的旋律，就足够成为整首歌的起点。

不同的 Prompt 会把同一个 Motif 演变成完全不同的风格，例如：

* EDM / Future Bass
* Kawaii Bass
* Lo-fi Hip Hop
* Cinematic Horror
* Epic Orchestral
* Synthwave
* Ambient

虽然底层旋律相同，但 AI 往往会给出截然不同的编曲和氛围。

---

## 本地开发

安装依赖：

```bash
npm install
```

启动开发服务器：

```bash
npm run dev
```

构建生产版本：

```bash
npm run build
```

---

## 技术栈

* Vite
* TypeScript
* Tone.js
* lamejs
* Waline

---

## License

本项目采用 **GPL-3.0** 协议开源。

你可以自由使用、修改和分发本项目，但任何基于本项目修改后的版本，同样需要以 GPL 协议开源。

<br>
<br>

---

<h1 id="english-version">ToneMatrixEX 🎶</h1>

[🇨🇳 返回中文版本](#tonematrixex-)

> A Web Grid Sequencer inspired by André Michelle's **ToneMatrix**.
> It can be used both to casually play with melodies, and as a Motif Generator for AI music tools like Suno and Udio.

### [👉 Click here to Play Online 👈](https://pkmnya.github.io/ToneMatrixEX/)

---

## About The Project

Initially, ToneMatrixEX was just meant to recreate the fun of ToneMatrix where you "hear a melody with just a few clicks." However, it slowly evolved into a handy tool that is more suited for modern AI music creation.

Often, feeding text prompts directly into AI results in rather random melodies and rhythms. If you first use ToneMatrixEX to quickly draw a simple Motif and export the audio as a reference input, you can provide the AI with a much clearer rhythmic and melodic direction.

It is not a DAW, nor is it professional arrangement software. Rather, it is a tool suitable for quickly recording inspirations and generating melody seeds.

> Parts of this project were written with the assistance of Gemini.

---

## Features

* 🎵 Built on **Tone.js** with stable audio scheduling and diverse synthesizer patches.
* 💾 Built-in **MP3 Export** (lamejs), convenient for direct use in AI workflows.
* 💬 Integrated **Waline commenting system** for easy communication and sharing of creations.
* ⚡ Built with **Vite + TypeScript** for a smooth and simple development experience.

---

## A Rather Interesting Way to Play

A workflow that I personally use quite often:

```
ToneMatrixEX
        │
        ├── Draw a simple Motif
        │
        ├── Export MP3
        │
        ▼
Suno / Udio
        │
        ▼
AI expands into full arrangement
```

Many times, a melody of just a few seconds is enough to serve as the starting point for an entire song.

Different Prompts can evolve the exact same Motif into completely different styles, for example:

* EDM / Future Bass
* Kawaii Bass
* Lo-fi Hip Hop
* Cinematic Horror
* Epic Orchestral
* Synthwave
* Ambient

Even though the underlying melody is the same, the AI will often provide drastically different arrangements and atmospheres.

---

## Local Development

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

Build for production:

```bash
npm run build
```

---

## Tech Stack

* Vite
* TypeScript
* Tone.js
* lamejs
* Waline

---

## License

This project is open-sourced under the **GPL-3.0** license.

You are free to use, modify, and distribute this project, but any modified versions based on this project must also be open-sourced under the GPL license.