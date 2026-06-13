export type ItemStatus = "not_started" | "in_progress" | "completed";
export type RoadmapSource = "ai_generated" | "manual" | "imported" | "rag";

export type Goal = {
  id: string;
  title: string;
  description?: string;
  notes?: string;
  createdAt: string;
};

export type RoadmapItem = {
  id: string;
  goalId: string;
  parentId?: string | null;
  title: string;
  description?: string;
  estimatedMinutes?: number;
  status: ItemStatus;
  orderIndex: number;
  depth: number;
  isLeaf: boolean;
  source?: RoadmapSource;
};

export type FocusSession = {
  id: string;
  goalId: string;
  roadmapItemId: string;
  itemTitle: string;
  itemPath?: string;
  startedAt: string;
  endedAt: string;
  plannedMinutes: number;
  actualMinutes: number;
  completed: boolean;
  reflectionNote?: string;
};

export type KnowledgeSource = {
  id: string;
  title: string;
  sourceType: "curated" | "imported" | "manual";
  content: string;
  createdAt: string;
};

export type RetrievedContext = {
  sourceId: string;
  title: string;
  snippet: string;
  score: number;
};

export type GeneratedRoadmapItem = {
  title: string;
  description?: string;
  estimatedMinutes?: number;
  status?: ItemStatus;
  children: GeneratedRoadmapItem[];
};

export type GeneratedRoadmap = {
  title: string;
  items: GeneratedRoadmapItem[];
};

export type RoadmapGenerationPreferences = {
  currentLevel: "beginner" | "intermediate" | "advanced";
  timeline: "1 month" | "3 months" | "6 months" | "No deadline";
  weeklyHours: number;
  detailLevel: "high-level" | "balanced" | "detailed";
  additionalContext: string;
};

export type FlowlistData = {
  goals: Goal[];
  items: RoadmapItem[];
  sessions: FocusSession[];
  knowledgeSources: KnowledgeSource[];
};
