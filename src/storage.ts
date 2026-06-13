import type {
  FlowlistData,
  FocusSession,
  KnowledgeSource,
  RoadmapItem,
} from "./types";

const STORAGE_KEY = "flowlist-data-v2";
const LEGACY_STORAGE_KEY = "flowlist-data-v1";

const defaultKnowledgeSources: KnowledgeSource[] = [
  {
    id: "curated-ai-engineering",
    title: "Practical AI Engineering Foundations",
    sourceType: "curated",
    createdAt: "2026-01-01T00:00:00.000Z",
    content:
      "AI engineering roadmaps should cover software engineering, APIs, backend services, databases, machine learning foundations, LLM APIs, retrieval augmented generation, evaluation, deployment, observability, and small end-to-end AI products.",
  },
  {
    id: "curated-backend",
    title: "Backend Development Foundations",
    sourceType: "curated",
    createdAt: "2026-01-01T00:00:00.000Z",
    content:
      "Backend learning should progress through HTTP and APIs, one server framework, relational data modeling, SQL, authentication, testing, caching, queues, system design, deployment, and observability. Each module should include implementation practice.",
  },
  {
    id: "curated-learning",
    title: "Actionable Learning Roadmaps",
    sourceType: "curated",
    createdAt: "2026-01-01T00:00:00.000Z",
    content:
      "Break broad learning goals into major areas, concrete modules, and tasks that produce evidence of understanding. Prefer exercises, explanations, debugging practice, and small projects over vague tasks such as learn or study.",
  },
];

const emptyData: FlowlistData = {
  goals: [],
  items: [],
  sessions: [],
  knowledgeSources: defaultKnowledgeSources,
};

type LegacyItem = Omit<
  RoadmapItem,
  "parentId" | "depth" | "isLeaf" | "source"
> & {
  estimatedMinutes: number;
};

type LegacySession = Omit<
  FocusSession,
  "roadmapItemId" | "itemPath"
> & {
  checklistItemId?: string;
  roadmapItemId?: string;
};

function normalizeData(parsed: Partial<FlowlistData>): FlowlistData {
  const items = Array.isArray(parsed.items)
    ? parsed.items.map((item) => {
        const candidate = item as RoadmapItem;
        return {
          ...candidate,
          parentId: candidate.parentId ?? null,
          depth: Number.isInteger(candidate.depth) ? candidate.depth : 1,
          isLeaf:
            typeof candidate.isLeaf === "boolean" ? candidate.isLeaf : true,
          source: candidate.source ?? "manual",
        };
      })
    : [];

  const sessions = Array.isArray(parsed.sessions)
    ? (parsed.sessions as LegacySession[]).map((session) => ({
        ...session,
        roadmapItemId:
          session.roadmapItemId ?? session.checklistItemId ?? "unknown",
      }))
    : [];

  return {
    goals: Array.isArray(parsed.goals) ? parsed.goals : [],
    items,
    sessions,
    knowledgeSources: Array.isArray(parsed.knowledgeSources)
      ? parsed.knowledgeSources
      : defaultKnowledgeSources,
  };
}

function migrateLegacy(): FlowlistData | null {
  const stored = localStorage.getItem(LEGACY_STORAGE_KEY);
  if (!stored) return null;

  const parsed = JSON.parse(stored) as {
    goals?: FlowlistData["goals"];
    items?: LegacyItem[];
    sessions?: LegacySession[];
  };

  return normalizeData({
    goals: parsed.goals ?? [],
    items: (parsed.items ?? []).map((item) => ({
      ...item,
      parentId: null,
      depth: 1,
      isLeaf: true,
      source: "manual",
    })),
    sessions: (parsed.sessions ?? []).map((session) => ({
      ...session,
      roadmapItemId:
        session.roadmapItemId ?? session.checklistItemId ?? "unknown",
    })) as FocusSession[],
    knowledgeSources: defaultKnowledgeSources,
  });
}

export function loadData(): FlowlistData {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return normalizeData(JSON.parse(stored));

    const migrated = migrateLegacy();
    if (migrated) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
      return migrated;
    }

    return emptyData;
  } catch {
    return emptyData;
  }
}

export function saveData(data: FlowlistData) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}
