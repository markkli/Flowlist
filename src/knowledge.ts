import type { KnowledgeSource, RetrievedContext } from "./types";

const stopWords = new Set([
  "a",
  "an",
  "and",
  "for",
  "from",
  "in",
  "of",
  "on",
  "the",
  "to",
  "with",
  "my",
  "build",
  "learn",
]);

function keywords(text: string) {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9+#.\s-]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 2 && !stopWords.has(word)),
  );
}

export function retrieveRoadmapContext(
  goalText: string,
  sources: KnowledgeSource[],
): RetrievedContext[] {
  const goalKeywords = keywords(goalText);

  return sources
    .map((source) => {
      const sourceKeywords = keywords(`${source.title} ${source.content}`);
      const matches = [...goalKeywords].filter((word) =>
        sourceKeywords.has(word),
      );
      return {
        sourceId: source.id,
        title: source.title,
        snippet: source.content.slice(0, 700),
        score: matches.length / Math.max(goalKeywords.size, 1),
      };
    })
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}
