# 🌍 AfriPersonal: The Smart Telegram Job Matcher

## 📑 Table of Contents
1. [What is this Project? (Explained Simply)](#1-what-is-this-project-explained-simply)
2. [Why Build This? (Skills I Will Learn)](#2-why-build-this-skills-i-will-learn)
3. [How it Works (The System Flow)](#3-how-it-works-the-system-flow)
4. [The Tech Stack & Architecture](#4-the-tech-stack--architecture)
5. [Database Schema (The Brain)](#5-database-schema-the-brain)
6. [Environment Setup (.env)](#6-environment-setup-env)

---

## 1. What is this Project? (Explained Simply)

Imagine you are looking for gold in a fast-moving river. The river brings 1,000 rocks a day, and it's exhausting to check every single one. 

**AfriPersonal** is a robot you build to sit by the river for you. 
1. You tell the robot: *"I only want gold rocks, and they must be shaped like a square."*
2. The robot watches the river 24/7. 
3. It immediately throws away the mud and regular rocks.
4. When it finds a shiny rock, it uses a magnifying glass (AI) to check if it's perfectly square.
5. If it's a match, it puts the rock straight into your pocket.

**In tech terms:** It is a personal application that reads 1,000+ daily messages from noisy Telegram job channels. It throws away irrelevant jobs using keywords, uses AI to perfectly understand if a job matches your exact niche, and sends the perfect jobs straight to your Telegram DMs.

---

## 2. Why Build This? (Skills I Will Learn)

This isn't just a basic tutorial project; it solves a real-world data and automation problem. By building this, I will master:

*   **System Architecture:** How to build a system where a background worker and a web dashboard communicate using the same database.
*   **Telegram MTProto (`gramjs`):** How to programmatically control a Telegram user account (Userbot) rather than just a simple Bot API.
*   **Prompt Engineering & AI APIs:** How to talk to Large Language Models (LLMs like Groq/Llama3) programmatically and force them to return clean, structured JSON data.
*   **Database Design (Prisma / SQL):** How to design a multi-user schema where one system can evaluate data against many different user preferences at the same time.
*   **Node.js / Express:** Building REST APIs to manage user configurations dynamically.

---

## 3. How it Works (The System Flow)

The system works in a continuous, automated loop:

1. **The Catch:** The Telegram Worker sees a new message posted in `@ethio_job_channel`.
2. **The Fetch:** The server looks into the database and pulls up my personal profile (my keywords and my custom AI prompt).
3. **Stage 1 (The Bouncer):** The server checks if the job has basic words like "React" or "Developer". If no, it drops the message to save AI costs.
4. **Stage 2 (The AI Recruiter):** The server sends the job text and my custom prompt to the Groq AI API. The AI reads the context to see if it's a true match.
5. **The Delivery:** If the AI says `is_match: true`, the system forwards the job post and the AI's reasoning directly to my personal Telegram DM.

---

## 4. The Tech Stack & Architecture

The project is divided into 4 specific pieces that work together:

### 🖥️ 1. The Frontend (Dashboard)
*   **What it does:** A simple webpage where I can type in my keywords, write my AI prompt, and turn the bot on or off. 
*   **Tech:** HTML, TailwindCSS, and basic JavaScript to send data to the backend.

### ⚙️ 2. The Backend (Express API)
*   **What it does:** A Node.js web server that receives the data from the Frontend Dashboard and saves it into the database. It handles the `GET`, `POST`, and `PUT` requests for my profile settings.
*   **Tech:** Node.js, Express.js.

### 🗄️ 3. The Database (PostgreSQL)
*   **What it does:** The storage vault. It remembers my Telegram Chat ID, my target channels, my keywords, and my AI instructions.
*   **Tech:** PostgreSQL managed by Prisma ORM.

### 🤖 4. The Worker & AI (Telegram Bot / Groq)
*   **What it does:** The engine running in the background. It connects to Telegram, listens for messages, filters them against the Database rules, calls the AI, and sends DMs.
*   **Tech:** `gramjs` (Telegram connection), `axios` (API requests), and `Groq API` (Free AI).

---

## 5. Database Schema (The Brain)

We use a single `Watcher` table so the system knows exactly what to look for and where to send the results. 

```prisma
model Watcher {
  id               String   @id @default(uuid())
  userName         String   // e.g., "My Profile"
  targetChannel    String   // e.g., "@ethio_job_channel"
  telegramChatId   String   // Where the bot sends the DM (e.g., "123456789")
  keywords         String[] // e.g., ["react", "node", "frontend"]
  customPrompt     String   // e.g., "I am a mid-level React dev..."
  isActive         Boolean  @default(true)
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
}
