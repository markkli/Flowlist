import type { GeneratedRoadmap, GeneratedRoadmapItem } from "./types";

const task = (
  title: string,
  estimatedMinutes: number,
  description?: string,
): GeneratedRoadmapItem => ({
  title,
  description,
  estimatedMinutes,
  children: [],
});

const module = (
  title: string,
  children: GeneratedRoadmapItem[],
  description?: string,
): GeneratedRoadmapItem => ({
  title,
  description,
  estimatedMinutes: children.reduce(
    (total, child) => total + (child.estimatedMinutes ?? 0),
    0,
  ),
  children,
});

const software = module(
  "Software Engineering",
  [
    module("JavaScript / TypeScript", [
      task("Practice variables and data types", 25),
      task("Write functions and explore scope", 50),
      task("Transform arrays and objects", 50),
      task("Build an async API request", 50),
    ]),
    module("Git and testing", [
      task("Practice a feature branch workflow", 25),
      task("Write focused unit tests", 50),
      task("Refactor one module for clarity", 50),
    ]),
  ],
  "Build practical coding habits for reliable product development.",
);

const aiEngineering = [
  software,
  module(
    "Backend and Data",
    [
      module("API development", [
        task("Design a small REST resource", 50),
        task("Implement request validation", 50),
        task("Add error handling and tests", 50),
      ]),
      module("Databases", [
        task("Model a relational schema", 50),
        task("Practice joins and indexes", 50),
        task("Add persistence to a small API", 90),
      ]),
    ],
    "Learn to build and persist production-shaped services.",
  ),
  module(
    "LLM Applications",
    [
      module("LLM APIs", [
        task("Send a structured model request", 50),
        task("Validate structured output", 50),
        task("Add retries and error states", 50),
      ]),
      module("RAG systems", [
        task("Chunk a small reference document", 50),
        task("Implement keyword retrieval", 50),
        task("Ground a response with retrieved context", 90),
      ]),
    ],
    "Build reliable model-powered workflows with grounded context.",
  ),
  module("AI Product Projects", [
    module("Ship an end-to-end copilot", [
      task("Define one narrow user workflow", 25),
      task("Build the core model interaction", 90),
      task("Add evaluation examples", 50),
      task("Deploy and test with three users", 90),
    ]),
  ]),
];

const product = [
  module("Product Definition", [
    module("Scope the MVP", [
      task("Write the user and problem statement", 25),
      task("Define the smallest successful outcome", 25),
      task("Map the primary user flow", 50),
    ]),
  ]),
  module("Build the Core Experience", [
    module("Foundation", [
      task("Define the core data model", 50),
      task("Build local persistence", 50),
      task("Implement the primary workflow", 90),
    ]),
    module("Interface", [
      task("Build the main screen", 90),
      task("Add empty and error states", 50),
      task("Complete an accessibility pass", 50),
    ]),
  ]),
  module("Validate and Launch", [
    module("Early feedback", [
      task("Test the full workflow yourself", 50),
      task("Run three user sessions", 90),
      task("Fix the highest-impact friction", 90),
    ]),
  ]),
];

const learning = [
  module("Plan the Learning Path", [
    module("Baseline and outcomes", [
      task("Audit your current knowledge", 25),
      task("Define a practical capstone", 25),
      task("Schedule the first week of practice", 25),
    ]),
  ]),
  module("Build Core Skills", [
    module("Foundations", [
      task("Study the first core concept", 50),
      task("Complete a targeted exercise set", 50),
      task("Explain the concept from memory", 25),
    ]),
    module("Applied practice", [
      task("Build one small example", 50),
      task("Debug a deliberately broken example", 50),
      task("Document the patterns you used", 25),
    ]),
  ]),
  module("Demonstrate Mastery", [
    module("Capstone", [
      task("Outline the capstone implementation", 25),
      task("Build the first working version", 90),
      task("Test and refine the result", 90),
    ]),
  ]),
];

export function generateMockRoadmap(
  goal: string,
  context = "",
): GeneratedRoadmap {
  const input = `${goal} ${context}`.toLowerCase();
  const items = /(ai|llm|rag|machine learning|backend)/.test(input)
    ? aiEngineering
    : /(build|mvp|app|product|launch)/.test(input)
      ? product
      : learning;

  return { title: goal, items };
}

export function generateMockSubtasks(title: string): GeneratedRoadmapItem[] {
  const input = title.toLowerCase();
  if (/(javascript|typescript)/.test(input)) {
    return [
      task("Practice variables and data types", 25),
      task("Write functions and explore scope", 50),
      task("Transform arrays and objects", 50),
      task("Manipulate the DOM", 50),
      task("Build an async API request", 50),
      task("Add TypeScript types to a small module", 90),
      task("Build a small todo app", 90),
    ];
  }

  return [
    task(`Define the outcome for ${title}`, 25),
    task(`Complete the first ${title} exercise`, 50),
    task(`Build a small ${title} example`, 50),
    task(`Review and document ${title}`, 25),
  ];
}
