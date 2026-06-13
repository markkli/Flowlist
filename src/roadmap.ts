import type {
  GeneratedRoadmapItem,
  ItemStatus,
  RoadmapItem,
  RoadmapSource,
} from "./types";

export const MAX_ROADMAP_DEPTH = 3;

export const createId = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

export function getChildren(items: RoadmapItem[], parentId: string | null) {
  return items
    .filter((item) => (item.parentId ?? null) === parentId)
    .sort((a, b) => a.orderIndex - b.orderIndex);
}

export function getDescendantLeaves(
  items: RoadmapItem[],
  itemId?: string,
): RoadmapItem[] {
  const roots = itemId
    ? getChildren(items, itemId)
    : getChildren(items, null);
  const leaves: RoadmapItem[] = [];

  const visit = (item: RoadmapItem) => {
    const children = getChildren(items, item.id);
    if (!children.length) {
      leaves.push(item);
      return;
    }
    children.forEach(visit);
  };

  roots.forEach(visit);
  return leaves;
}

export function getItemProgress(items: RoadmapItem[], item: RoadmapItem) {
  const children = getChildren(items, item.id);
  if (!children.length) return item.status === "completed" ? 100 : 0;
  const leaves = getDescendantLeaves(items, item.id);
  if (!leaves.length) return 0;
  return Math.round(
    (leaves.filter((leaf) => leaf.status === "completed").length /
      leaves.length) *
      100,
  );
}

export function getGoalProgress(items: RoadmapItem[]) {
  const leaves = getDescendantLeaves(items);
  const completed = leaves.filter((item) => item.status === "completed").length;
  return {
    progress: leaves.length ? Math.round((completed / leaves.length) * 100) : 0,
    completed,
    total: leaves.length,
  };
}

export function getItemPath(
  goalTitle: string,
  items: RoadmapItem[],
  itemId: string,
) {
  const path: string[] = [];
  let current = items.find((item) => item.id === itemId);
  const seen = new Set<string>();

  while (current && !seen.has(current.id)) {
    path.unshift(current.title);
    seen.add(current.id);
    current = current.parentId
      ? items.find((item) => item.id === current?.parentId)
      : undefined;
  }

  return [goalTitle, ...path].join(" > ");
}

export function flattenGeneratedItems(
  goalId: string,
  generated: GeneratedRoadmapItem[],
  source: RoadmapSource,
  parentId: string | null = null,
  depth = 1,
  existingSiblingCount = 0,
): RoadmapItem[] {
  const result: RoadmapItem[] = [];

  generated.forEach((node, index) => {
    const itemId = createId();
    const children =
      depth < MAX_ROADMAP_DEPTH && Array.isArray(node.children)
        ? node.children
        : [];
    result.push({
      id: itemId,
      goalId,
      parentId,
      title: node.title.trim(),
      description: node.description?.trim() || undefined,
      estimatedMinutes:
        typeof node.estimatedMinutes === "number"
          ? Math.max(5, Math.round(node.estimatedMinutes))
          : undefined,
      status: node.status ?? "not_started",
      orderIndex: existingSiblingCount + index,
      depth,
      isLeaf: children.length === 0,
      source,
    });
    result.push(
      ...flattenGeneratedItems(
        goalId,
        children,
        source,
        itemId,
        depth + 1,
      ),
    );
  });

  return result;
}

export function syncParentMetadata(items: RoadmapItem[]) {
  const childIds = new Set(
    items
      .map((item) => item.parentId)
      .filter((parentId): parentId is string => Boolean(parentId)),
  );

  return items.map((item) => {
    const isLeaf = !childIds.has(item.id);
    if (isLeaf) return { ...item, isLeaf };
    const progress = getItemProgress(items, item);
    const status: ItemStatus =
      progress === 100
        ? "completed"
        : progress > 0
          ? "in_progress"
          : "not_started";
    return { ...item, isLeaf, status };
  });
}
