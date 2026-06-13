import { createId, MAX_ROADMAP_DEPTH, syncParentMetadata } from "./roadmap";
import type { RoadmapItem } from "./types";

type Candidate = {
  title: string;
  level: number;
  completed: boolean;
  estimatedMinutes?: number;
  description?: string;
};

const estimatePattern =
  /\s*(?:[-–—]\s*)?(?:\(|\[)?(\d{1,3})\s*(?:min|minutes?)(?:\)|\])?\s*$/i;
const urlPattern = /(?:https?:\/\/|www\.)\S+/i;
const sentenceEndingPattern = /[.!?]\s*$/;

function cleanTitle(value: string) {
  const withoutMarkdown = value
    .replace(/^#+\s*/, "")
    .replace(/\s+#+$/, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .trim();
  const estimate = withoutMarkdown.match(estimatePattern);
  return {
    title: estimate
      ? withoutMarkdown.slice(0, estimate.index).trim()
      : withoutMarkdown,
    estimatedMinutes: estimate ? Number(estimate[1]) : undefined,
  };
}

function isTaskLikeBullet(text: string, isCheckbox: boolean) {
  if (isCheckbox) return true;
  if (urlPattern.test(text)) return false;
  if (text.length > 140) return false;
  const wordCount = text.split(/\s+/).length;
  if (wordCount > 18) return false;
  return !sentenceEndingPattern.test(text) || wordCount <= 10;
}

function looksLikePlainHeading(
  text: string,
  nextLine: string | undefined,
) {
  if (!text || text.length > 80 || urlPattern.test(text)) return false;
  if (sentenceEndingPattern.test(text)) return false;
  if (/^[-*+]\s+/.test(text)) return false;
  return Boolean(
    text.endsWith(":") ||
      nextLine?.match(/^\s*(?:[-*+]\s+|#{1,6}\s+)/) ||
      /^[A-Z][A-Za-z0-9/&+ -]{2,50}$/.test(text),
  );
}

function appendDescription(candidate: Candidate | undefined, text: string) {
  if (!candidate || !text.trim()) return;
  candidate.description = [candidate.description, text.trim()]
    .filter(Boolean)
    .join("\n");
}

export function parseRoadmapText(goalId: string, text: string) {
  const lines = text.split(/\r?\n/);
  const candidates: Candidate[] = [];
  let currentHeadingLevel = 0;
  let lastCandidate: Candidate | undefined;

  lines.forEach((raw, index) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    if (/^([-*_])\1{2,}$/.test(trimmed)) return;

    const heading = raw.match(/^\s*(#{1,6})\s+(.+)$/);
    const bullet = raw.match(/^(\s*)[-*+]\s+(?:\[([ xX])\]\s*)?(.+)$/);

    if (heading) {
      const cleaned = cleanTitle(heading[2]);
      if (!cleaned.title) return;
      currentHeadingLevel = Math.min(
        heading[1].length,
        MAX_ROADMAP_DEPTH,
      );
      lastCandidate = {
        ...cleaned,
        level: currentHeadingLevel,
        completed: false,
      };
      candidates.push(lastCandidate);
      return;
    }

    if (bullet) {
      const isCheckbox = bullet[2] !== undefined;
      const completed = bullet[2]?.toLowerCase() === "x";
      const content = bullet[3].trim();
      const indent = Math.floor(
        bullet[1].replace(/\t/g, "  ").length / 2,
      );

      if (!isTaskLikeBullet(content, isCheckbox)) {
        appendDescription(lastCandidate, content);
        return;
      }

      const cleaned = cleanTitle(content);
      if (!cleaned.title) return;
      const baseLevel = currentHeadingLevel || 1;
      lastCandidate = {
        ...cleaned,
        level: Math.min(
          baseLevel + (currentHeadingLevel ? 1 : 0) + indent,
          MAX_ROADMAP_DEPTH,
        ),
        completed,
      };
      candidates.push(lastCandidate);
      return;
    }

    if (urlPattern.test(trimmed)) {
      appendDescription(lastCandidate, trimmed);
      return;
    }

    if (looksLikePlainHeading(trimmed, lines[index + 1]?.trim())) {
      const cleaned = cleanTitle(trimmed.replace(/:$/, ""));
      lastCandidate = {
        ...cleaned,
        level: 1,
        completed: false,
      };
      currentHeadingLevel = 1;
      candidates.push(lastCandidate);
      return;
    }

    appendDescription(lastCandidate, trimmed.replace(/^>\s?/, ""));
  });

  if (!candidates.length) return [];

  const minimumLevel = Math.min(...candidates.map((line) => line.level));
  const stack = new Map<number, string>();
  const siblingCounts = new Map<string, number>();
  const items: RoadmapItem[] = [];

  candidates.forEach((line) => {
    const depth = Math.min(
      Math.max(line.level - minimumLevel + 1, 1),
      MAX_ROADMAP_DEPTH,
    );
    const parentId = depth > 1 ? stack.get(depth - 1) ?? null : null;
    const siblingKey = parentId ?? "root";
    const orderIndex = siblingCounts.get(siblingKey) ?? 0;
    siblingCounts.set(siblingKey, orderIndex + 1);

    const item: RoadmapItem = {
      id: createId(),
      goalId,
      parentId,
      title: line.title,
      description: line.description,
      estimatedMinutes:
        line.estimatedMinutes ??
        (depth === MAX_ROADMAP_DEPTH || line.completed ? 25 : undefined),
      status: line.completed ? "completed" : "not_started",
      orderIndex,
      depth,
      isLeaf: true,
      source: "imported",
    };
    items.push(item);
    stack.set(depth, item.id);
    for (let deeper = depth + 1; deeper <= MAX_ROADMAP_DEPTH; deeper += 1) {
      stack.delete(deeper);
    }
  });

  return syncParentMetadata(items);
}
