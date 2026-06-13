import { generateMockRoadmap, generateMockSubtasks } from "./mockGenerator";
import type {
  GeneratedRoadmap,
  GeneratedRoadmapItem,
  RoadmapGenerationPreferences,
  RetrievedContext,
} from "./types";

type GenerationResult<T> = {
  data: T;
  mode: "openai" | "mock";
  message?: string;
};

async function request<T>(
  path: string,
  body: Record<string, unknown>,
  fallback: () => T,
): Promise<GenerationResult<T>> {
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`Generation failed (${response.status})`);
    return (await response.json()) as GenerationResult<T>;
  } catch {
    return {
      data: fallback(),
      mode: "mock",
      message: "AI server unavailable, using mock roadmap generator.",
    };
  }
}

export function generateRoadmap(
  goal: string,
  preferences: RoadmapGenerationPreferences,
  retrievedContext: RetrievedContext[],
) {
  return request<GeneratedRoadmap>(
    "/api/roadmaps/generate",
    { goal, preferences, retrievedContext },
    () => generateMockRoadmap(goal, preferences.additionalContext),
  );
}

export function generateSubtasks(
  goal: string,
  itemTitle: string,
  itemDescription: string,
  depth: number,
  retrievedContext: RetrievedContext[],
) {
  return request<GeneratedRoadmapItem[]>(
    "/api/roadmaps/subtasks",
    { goal, itemTitle, itemDescription, depth, retrievedContext },
    () => generateMockSubtasks(itemTitle),
  );
}

export async function cleanRoadmapImport(
  goal: string,
  text: string,
): Promise<GenerationResult<GeneratedRoadmap> | null> {
  try {
    const response = await fetch("/api/roadmaps/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goal, text }),
    });
    if (!response.ok) return null;
    return (await response.json()) as GenerationResult<GeneratedRoadmap>;
  } catch {
    return null;
  }
}
