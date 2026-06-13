# Flowlist

A local-first productivity app that turns a goal into a layered roadmap:

**Goal → AI roadmap → nested tasks → focus session → progress**

## Run locally

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5173`. Data is stored in the browser with
`localStorage`, while AI requests go through the local Node server.

## OpenAI setup

Copy `.env.example` to `.env`, then add a server-side API key:

```bash
OPENAI_API_KEY=your_api_key_here
OPENAI_ROADMAP_MODEL=gpt-5.4-mini
OPENAI_SUBTASK_MODEL=gpt-5.4-mini
```

The key is never bundled into frontend code. Without it, Flowlist displays a
friendly message and uses its nested mock roadmap generator.

The two model settings are separate so roadmap planning and subtask generation
can be evaluated and upgraded independently. Both default to the lower-cost
mini model; this workflow does not currently run a multi-agent system.

## Production build

```bash
npm run build
npm run preview
```

## Roadmap sources and import

- Curated local knowledge sources are retrieved with keyword matching before AI
  generation. The `retrieveRoadmapContext` interface can later be replaced with
  embeddings or a vector database.
- Markdown and plain-text imports support headings, bullets, nested bullets,
  and checked or unchecked task lists.
