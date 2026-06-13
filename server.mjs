import "dotenv/config";
import express from "express";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isProduction = process.env.NODE_ENV === "production";
const port = Number(process.env.PORT || 5173);
const app = express();

app.use(express.json({ limit: "1mb" }));

const LeafSchema = z.object({
  title: z.string().min(1).max(160),
  description: z.string().max(500).nullable(),
  estimatedMinutes: z.number().int().min(5).max(180).nullable(),
  children: z.array(z.string()).max(0),
});

const ModuleSchema = z.object({
  title: z.string().min(1).max(160),
  description: z.string().max(500).nullable(),
  estimatedMinutes: z.number().int().min(5).max(10000).nullable(),
  children: z.array(LeafSchema).min(1).max(10),
});

const AreaSchema = z.object({
  title: z.string().min(1).max(160),
  description: z.string().max(500).nullable(),
  estimatedMinutes: z.number().int().min(5).max(30000).nullable(),
  children: z.array(ModuleSchema).min(1).max(8),
});

const RoadmapSchema = z.object({
  title: z.string().min(1).max(160),
  items: z.array(AreaSchema).min(1).max(10),
});

const SubtasksSchema = z.object({
  items: z.array(LeafSchema).min(2).max(12),
});

const ImportedLeafSchema = z.object({
  title: z.string().min(1).max(160),
  description: z.string().max(1000).nullable(),
  estimatedMinutes: z.number().int().min(5).max(180).nullable(),
  status: z.enum(["not_started", "in_progress", "completed"]),
  children: z.array(z.string()).max(0),
});

const ImportedModuleSchema = z.object({
  title: z.string().min(1).max(160),
  description: z.string().max(1000).nullable(),
  estimatedMinutes: z.number().int().min(5).max(10000).nullable(),
  status: z.enum(["not_started", "in_progress", "completed"]),
  children: z.array(ImportedLeafSchema).min(1).max(16),
});

const ImportedAreaSchema = z.object({
  title: z.string().min(1).max(160),
  description: z.string().max(1000).nullable(),
  estimatedMinutes: z.number().int().min(5).max(30000).nullable(),
  status: z.enum(["not_started", "in_progress", "completed"]),
  children: z.array(ImportedModuleSchema).min(1).max(12),
});

const ImportedRoadmapSchema = z.object({
  title: z.string().min(1).max(160),
  items: z.array(ImportedAreaSchema).min(1).max(16),
});

const roadmapSystemPrompt = `You design practical learning and project roadmaps.
Return a three-layer roadmap: major areas, modules, then actionable leaf tasks.
Leaf tasks must be concrete, incremental, and generally fit 25-90 minutes.
Never use vague leaf tasks such as "Learn JavaScript". Use an observable action.
Parent estimates may represent several hours. Use clear, accessible language.
Match complexity to the user's current level, available weekly time, timeline,
and requested detail. Avoid jargon and unnecessary steps for beginners.`;

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const roadmapModel =
  process.env.OPENAI_ROADMAP_MODEL ||
  process.env.OPENAI_MODEL ||
  "gpt-5.4-mini";
const subtaskModel =
  process.env.OPENAI_SUBTASK_MODEL ||
  process.env.OPENAI_MODEL ||
  "gpt-5.4-mini";

function sourceContext(retrievedContext) {
  if (!Array.isArray(retrievedContext) || !retrievedContext.length) return "";
  return `\nTrusted reference snippets:\n${retrievedContext
    .slice(0, 3)
    .map((entry) => `- ${entry.title}: ${entry.snippet}`)
    .join("\n")}`;
}

app.get("/api/health", (_request, response) => {
  response.json({
    ok: true,
    aiConfigured: Boolean(openai),
    models: { roadmap: roadmapModel, subtasks: subtaskModel },
  });
});

app.post("/api/roadmaps/generate", async (request, response) => {
  const goal = String(request.body?.goal || "").trim();
  const preferences = request.body?.preferences || {};
  if (!goal) return response.status(400).json({ error: "Goal is required." });

  if (!openai) {
    return response.status(503).json({
      error: "OPENAI_API_KEY is not configured.",
      code: "AI_NOT_CONFIGURED",
    });
  }

  try {
    const result = await openai.responses.parse({
      model: roadmapModel,
      input: [
        { role: "system", content: roadmapSystemPrompt },
        {
          role: "user",
          content: `Goal: ${goal}
Current level: ${String(preferences.currentLevel || "beginner")}
Target timeline: ${String(preferences.timeline || "No deadline")}
Weekly time available: ${Number(preferences.weeklyHours || 5)} hours
Desired detail: ${String(preferences.detailLevel || "balanced")}
Additional context: ${String(preferences.additionalContext || "None")}
Build a roadmap that is realistic within this time budget. Use fewer, broader
modules for high-level detail and more leaf tasks for detailed plans.${sourceContext(request.body?.retrievedContext)}`,
        },
      ],
      text: { format: zodTextFormat(RoadmapSchema, "flowlist_roadmap") },
    });
    if (!result.output_parsed) throw new Error("Model returned no roadmap.");
    response.json({ data: result.output_parsed, mode: "openai" });
  } catch (error) {
    console.error("Roadmap generation failed:", error);
    response.status(502).json({ error: "OpenAI roadmap generation failed." });
  }
});

app.post("/api/roadmaps/import", async (request, response) => {
  const goal = String(request.body?.goal || "").trim();
  const text = String(request.body?.text || "").trim();
  if (!goal || !text) {
    return response.status(400).json({ error: "Goal and roadmap text are required." });
  }
  if (!openai) {
    return response.status(503).json({
      error: "OPENAI_API_KEY is not configured.",
      code: "AI_NOT_CONFIGURED",
    });
  }

  try {
    const result = await openai.responses.parse({
      model: roadmapModel,
      input: [
        {
          role: "system",
          content: `Clean messy roadmap notes into a useful three-level roadmap.
Headings become areas or modules. Checkboxes and concise bullets become tasks.
Preserve checked checkboxes as completed and unchecked boxes as not_started.
Long prose, explanations, links, and resources belong in descriptions; never
turn them into standalone tasks. Remove duplicates and cryptic fragments.
Preserve concise checkbox titles and do not invent extra work or expand one
checkbox into several tasks. If the source has only an area and its tasks,
place those original tasks beneath one neutral module such as "Core tasks".
Leaf tasks should be concrete and usually take 25-90 minutes.`,
        },
        {
          role: "user",
          content: `Goal: ${goal}\n\nRaw roadmap notes:\n${text.slice(0, 30000)}`,
        },
      ],
      text: {
        format: zodTextFormat(
          ImportedRoadmapSchema,
          "flowlist_imported_roadmap",
        ),
      },
    });
    if (!result.output_parsed) throw new Error("Model returned no roadmap.");
    response.json({ data: result.output_parsed, mode: "openai" });
  } catch (error) {
    console.error("Roadmap import cleanup failed:", error);
    response.status(502).json({ error: "OpenAI import cleanup failed." });
  }
});

app.post("/api/roadmaps/subtasks", async (request, response) => {
  const itemTitle = String(request.body?.itemTitle || "").trim();
  const depth = Number(request.body?.depth || 1);
  if (!itemTitle) {
    return response.status(400).json({ error: "Roadmap item is required." });
  }
  if (depth >= 3) {
    return response.status(400).json({ error: "Maximum roadmap depth reached." });
  }
  if (!openai) {
    return response.status(503).json({
      error: "OPENAI_API_KEY is not configured.",
      code: "AI_NOT_CONFIGURED",
    });
  }

  try {
    const result = await openai.responses.parse({
      model: subtaskModel,
      input: [
        {
          role: "system",
          content:
            "Break a roadmap topic into concrete, non-overlapping tasks. Each task should fit a 25-90 minute focus session. Return leaf tasks only.",
        },
        {
          role: "user",
          content: `Goal: ${String(request.body?.goal || "")}\nTopic: ${itemTitle}\nDescription: ${String(request.body?.itemDescription || "None")}${sourceContext(request.body?.retrievedContext)}`,
        },
      ],
      text: { format: zodTextFormat(SubtasksSchema, "flowlist_subtasks") },
    });
    if (!result.output_parsed) throw new Error("Model returned no subtasks.");
    response.json({ data: result.output_parsed.items, mode: "openai" });
  } catch (error) {
    console.error("Subtask generation failed:", error);
    response.status(502).json({ error: "OpenAI subtask generation failed." });
  }
});

if (isProduction) {
  app.use(express.static(path.join(__dirname, "dist")));
  app.use((_request, response) => {
    response.sendFile(path.join(__dirname, "dist", "index.html"));
  });
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
}

app.listen(port, "127.0.0.1", () => {
  console.log(
    `Flowlist running at http://127.0.0.1:${port} (${
      openai
        ? `roadmap: ${roadmapModel}, subtasks: ${subtaskModel}`
        : "mock AI fallback"
    })`,
  );
});
