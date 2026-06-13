import {
  ArrowRight,
  BrainCircuit,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Clock3,
  Coffee,
  FileInput,
  FolderTree,
  History,
  ListChecks,
  NotebookPen,
  Pause,
  Pencil,
  Play,
  Plus,
  Save,
  Sparkles,
  Square,
  Target,
  TimerReset,
  Trash2,
  WandSparkles,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  cleanRoadmapImport,
  generateRoadmap,
  generateSubtasks,
} from "./api";
import { retrieveRoadmapContext } from "./knowledge";
import { parseRoadmapText } from "./markdown";
import {
  createId,
  flattenGeneratedItems,
  getChildren,
  getGoalProgress,
  getItemPath,
  getItemProgress,
  MAX_ROADMAP_DEPTH,
  syncParentMetadata,
} from "./roadmap";
import { loadData, saveData } from "./storage";
import type {
  FlowlistData,
  FocusSession,
  Goal,
  ItemStatus,
  RoadmapItem,
  RoadmapGenerationPreferences,
} from "./types";

const FOCUS_SECONDS = 25 * 60;
const BREAK_SECONDS = 5 * 60;

type Dialog =
  | "goal"
  | "editGoal"
  | "generate"
  | "addItem"
  | "editItem"
  | "import"
  | null;

type FocusState = {
  goalId: string;
  itemId: string;
  startedAt: string;
  phase: "focus" | "break";
  secondsLeft: number;
  isRunning: boolean;
  focusSecondsElapsed: number;
  focusCompleted: boolean;
  review: boolean;
};

const formatTimer = (seconds: number) => {
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
};

const formatDate = (date: string) =>
  new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(
    new Date(date),
  );

const formatSessionDate = (date: string) =>
  new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(date));

function App() {
  const [data, setData] = useState<FlowlistData>(loadData);
  const [selectedGoalId, setSelectedGoalId] = useState(
    () => loadData().goals[0]?.id ?? "",
  );
  const [dialog, setDialog] = useState<Dialog>(null);
  const [dialogParentId, setDialogParentId] = useState<string | null>(null);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [showHistory, setShowHistory] = useState(false);
  const [focus, setFocus] = useState<FocusState | null>(null);
  const [toast, setToast] = useState("");

  useEffect(() => saveData(data), [data]);

  useEffect(() => {
    if (!selectedGoalId && data.goals[0]) setSelectedGoalId(data.goals[0].id);
    if (
      selectedGoalId &&
      !data.goals.some((goal) => goal.id === selectedGoalId)
    ) {
      setSelectedGoalId(data.goals[0]?.id ?? "");
    }
  }, [data.goals, selectedGoalId]);

  useEffect(() => {
    const goalItems = data.items.filter((item) => item.goalId === selectedGoalId);
    const parentIds = goalItems
      .filter((item) => getChildren(goalItems, item.id).length > 0)
      .filter((item) => item.depth === 1)
      .map((item) => item.id);
    setExpandedIds(new Set(parentIds));
  }, [selectedGoalId]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(""), 4200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    if (!focus?.isRunning || focus.review) return;
    const interval = window.setInterval(() => {
      setFocus((current) => {
        if (!current?.isRunning || current.review) return current;
        if (current.secondsLeft > 1) {
          return {
            ...current,
            secondsLeft: current.secondsLeft - 1,
            focusSecondsElapsed:
              current.phase === "focus"
                ? current.focusSecondsElapsed + 1
                : current.focusSecondsElapsed,
          };
        }
        if (current.phase === "focus") {
          notify(
            "Focus block complete",
            "Nice work. Your five-minute break has started.",
          );
          setToast("Focus complete. Your 5-minute break is running.");
          return {
            ...current,
            phase: "break",
            secondsLeft: BREAK_SECONDS,
            focusSecondsElapsed: FOCUS_SECONDS,
            focusCompleted: true,
          };
        }
        notify("Break complete", "Ready when you are to log your progress.");
        setToast("Break complete. Take a moment to log your progress.");
        return { ...current, secondsLeft: 0, isRunning: false, review: true };
      });
    }, 1000);
    return () => window.clearInterval(interval);
  }, [focus?.isRunning, focus?.review]);

  const selectedGoal = data.goals.find((goal) => goal.id === selectedGoalId);
  const selectedItems = useMemo(
    () => data.items.filter((item) => item.goalId === selectedGoalId),
    [data.items, selectedGoalId],
  );
  const goalProgress = getGoalProgress(selectedItems);

  const mutateGoalItems = (
    updater: (items: RoadmapItem[]) => RoadmapItem[],
  ) => {
    setData((current) => {
      const goalItems = current.items.filter(
        (item) => item.goalId === selectedGoalId,
      );
      const otherItems = current.items.filter(
        (item) => item.goalId !== selectedGoalId,
      );
      return {
        ...current,
        items: [...otherItems, ...syncParentMetadata(updater(goalItems))],
      };
    });
  };

  const updateItem = (itemId: string, updates: Partial<RoadmapItem>) => {
    mutateGoalItems((items) =>
      items.map((item) =>
        item.id === itemId ? { ...item, ...updates } : item,
      ),
    );
  };

  const updateGoal = (updates: Partial<Goal>) => {
    setData((current) => ({
      ...current,
      goals: current.goals.map((goal) =>
        goal.id === selectedGoalId ? { ...goal, ...updates } : goal,
      ),
    }));
  };

  const deleteItem = (itemId: string) => {
    const ids = new Set([itemId]);
    let changed = true;
    while (changed) {
      changed = false;
      selectedItems.forEach((item) => {
        if (item.parentId && ids.has(item.parentId) && !ids.has(item.id)) {
          ids.add(item.id);
          changed = true;
        }
      });
    }
    mutateGoalItems((items) => items.filter((item) => !ids.has(item.id)));
    setExpandedIds((current) => {
      const next = new Set(current);
      ids.forEach((id) => next.delete(id));
      return next;
    });
  };

  const addItem = (
    title: string,
    estimatedMinutes: number | undefined,
    parentId: string | null,
  ) => {
    const parent = selectedItems.find((item) => item.id === parentId);
    const depth = parent ? parent.depth + 1 : 1;
    if (depth > MAX_ROADMAP_DEPTH) return;
    const siblings = getChildren(selectedItems, parentId);
    const item: RoadmapItem = {
      id: createId(),
      goalId: selectedGoalId,
      parentId,
      title,
      estimatedMinutes,
      status: "not_started",
      orderIndex: siblings.length,
      depth,
      isLeaf: true,
      source: "manual",
    };
    mutateGoalItems((items) => [...items, item]);
    if (parentId) {
      setExpandedIds((current) => new Set(current).add(parentId));
    }
  };

  const toggleItem = (item: RoadmapItem) => {
    if (getChildren(selectedItems, item.id).length) return;
    updateItem(item.id, {
      status: item.status === "completed" ? "not_started" : "completed",
    });
  };

  const startFocus = async (item: RoadmapItem) => {
    if (getChildren(selectedItems, item.id).length) return;
    if ("Notification" in window && Notification.permission === "default") {
      await Notification.requestPermission();
    }
    if (item.status === "not_started") {
      updateItem(item.id, { status: "in_progress" });
    }
    setFocus({
      goalId: item.goalId,
      itemId: item.id,
      startedAt: new Date().toISOString(),
      phase: "focus",
      secondsLeft: FOCUS_SECONDS,
      isRunning: true,
      focusSecondsElapsed: 0,
      focusCompleted: false,
      review: false,
    });
  };

  const finishSession = (
    status: ItemStatus | null,
    reflectionNote: string,
  ) => {
    if (!focus || !selectedGoal) return;
    const item = data.items.find((candidate) => candidate.id === focus.itemId);
    if (!item) {
      setFocus(null);
      return;
    }
    if (status) updateItem(item.id, { status });

    const session: FocusSession = {
      id: createId(),
      goalId: focus.goalId,
      roadmapItemId: focus.itemId,
      itemTitle: item.title,
      itemPath: getItemPath(selectedGoal.title, selectedItems, item.id),
      startedAt: focus.startedAt,
      endedAt: new Date().toISOString(),
      plannedMinutes: 25,
      actualMinutes: Math.round(focus.focusSecondsElapsed / 60),
      completed: focus.focusCompleted,
      reflectionNote: reflectionNote.trim() || undefined,
    };
    setData((current) => ({
      ...current,
      sessions: [session, ...current.sessions],
    }));
    setFocus(null);
    setToast("Focus session saved.");
  };

  const openAddDialog = (parentId: string | null = null) => {
    setDialogParentId(parentId);
    setDialog("addItem");
  };

  return (
    <div className="app-shell">
      <Sidebar
        goals={data.goals}
        items={data.items}
        selectedGoalId={selectedGoalId}
        showHistory={showHistory}
        onSelectGoal={(goalId) => {
          setSelectedGoalId(goalId);
          setShowHistory(false);
        }}
        onNewGoal={() => setDialog("goal")}
        onShowHistory={() => setShowHistory(true)}
      />

      <main className="main-panel">
        <Topbar
          title={showHistory ? "Session history" : selectedGoal?.title}
          onNewGoal={() => setDialog("goal")}
        />
        {showHistory ? (
          <HistoryView
            sessions={data.sessions}
            goals={data.goals}
            onSelectGoal={(goalId) => {
              setSelectedGoalId(goalId);
              setShowHistory(false);
            }}
          />
        ) : selectedGoal ? (
          <GoalView
            goal={selectedGoal}
            items={selectedItems}
            progress={goalProgress}
            expandedIds={expandedIds}
            onToggleExpanded={(itemId) =>
              setExpandedIds((current) => {
                const next = new Set(current);
                if (next.has(itemId)) next.delete(itemId);
                else next.add(itemId);
                return next;
              })
            }
            onGenerate={() => setDialog("generate")}
            onImport={() => setDialog("import")}
            onAddItem={openAddDialog}
            onGenerateChildren={(item) => {
              setDialogParentId(item.id);
              setDialog("generate");
            }}
            onToggle={toggleItem}
            onUpdate={updateItem}
            onEditGoal={() => setDialog("editGoal")}
            onUpdateGoal={updateGoal}
            onEditItem={(item) => {
              setEditingItemId(item.id);
              setDialog("editItem");
            }}
            onDeleteItem={(item) => {
              if (
                window.confirm(
                  `Delete “${item.title}” and all of its child items?`,
                )
              ) {
                deleteItem(item.id);
              }
            }}
            onStart={startFocus}
          />
        ) : (
          <EmptyState onCreate={() => setDialog("goal")} />
        )}
      </main>

      {dialog === "goal" && (
        <GoalDialog
          onClose={() => setDialog(null)}
          onCreate={(title, description) => {
            const goal: Goal = {
              id: createId(),
              title,
              description: description || undefined,
              notes: "",
              createdAt: new Date().toISOString(),
            };
            setData((current) => ({
              ...current,
              goals: [...current.goals, goal],
            }));
            setSelectedGoalId(goal.id);
            setShowHistory(false);
            setDialog(null);
          }}
        />
      )}

      {dialog === "editGoal" && selectedGoal && (
        <GoalDialog
          goal={selectedGoal}
          onClose={() => setDialog(null)}
          onCreate={(title, description) => {
            updateGoal({
              title,
              description: description || undefined,
            });
            setDialog(null);
            setToast("Goal details updated.");
          }}
        />
      )}

      {dialog === "generate" && selectedGoal && (
        <GenerateDialog
          goal={selectedGoal}
          parent={selectedItems.find((item) => item.id === dialogParentId)}
          onClose={() => {
            setDialog(null);
            setDialogParentId(null);
          }}
          onGenerate={async (preferences) => {
            const parent = selectedItems.find(
              (item) => item.id === dialogParentId,
            );
            const retrieved = retrieveRoadmapContext(
              `${selectedGoal.title} ${parent?.title ?? ""} ${preferences.additionalContext}`,
              data.knowledgeSources,
            );
            if (parent) {
              const result = await generateSubtasks(
                  selectedGoal.title,
                  parent.title,
                  parent.description ?? "",
                  parent.depth,
                  retrieved,
                )
              const siblings = getChildren(selectedItems, parent.id);
              const additions = flattenGeneratedItems(
                selectedGoal.id,
                result.data,
                result.mode === "openai" && retrieved.length
                  ? "rag"
                  : "ai_generated",
                parent.id,
                parent.depth + 1,
                siblings.length,
              );
              mutateGoalItems((items) => [...items, ...additions]);
              setExpandedIds((current) => new Set(current).add(parent.id));
              setToast(
                result.message ??
                  `${additions.length} actionable subtasks added with ${result.mode === "openai" ? "OpenAI" : "the mock generator"}.`,
              );
            } else {
              const result = await generateRoadmap(
                selectedGoal.title,
                preferences,
                retrieved,
              );
              const additions = flattenGeneratedItems(
                selectedGoal.id,
                result.data.items,
                result.mode === "openai" && retrieved.length
                  ? "rag"
                  : "ai_generated",
                null,
                1,
                getChildren(selectedItems, null).length,
              );
              mutateGoalItems((items) => [...items, ...additions]);
              setExpandedIds(
                new Set(
                  additions
                    .filter((item) => item.depth < 3 && !item.isLeaf)
                    .map((item) => item.id),
                ),
              );
              setToast(
                result.message ??
                  `Nested roadmap added with ${result.mode === "openai" ? "OpenAI" : "the mock generator"}.`,
              );
            }
            setDialog(null);
            setDialogParentId(null);
          }}
        />
      )}

      {dialog === "editItem" && selectedGoal && editingItemId && (
        <EditItemDialog
          item={selectedItems.find((item) => item.id === editingItemId)}
          hasChildren={selectedItems.some(
            (item) => item.parentId === editingItemId,
          )}
          onClose={() => {
            setDialog(null);
            setEditingItemId(null);
          }}
          onSave={(updates) => {
            updateItem(editingItemId, updates);
            setDialog(null);
            setEditingItemId(null);
            setToast("Roadmap item updated.");
          }}
        />
      )}

      {dialog === "addItem" && selectedGoal && (
        <AddItemDialog
          parent={selectedItems.find((item) => item.id === dialogParentId)}
          onClose={() => {
            setDialog(null);
            setDialogParentId(null);
          }}
          onAdd={(title, minutes) => {
            addItem(title, minutes, dialogParentId);
            setDialog(null);
            setDialogParentId(null);
          }}
        />
      )}

      {dialog === "import" && selectedGoal && (
        <ImportDialog
          goal={selectedGoal}
          onClose={() => setDialog(null)}
          onPreview={async (text) => {
            const cleaned = await cleanRoadmapImport(selectedGoal.title, text);
            let imported = cleaned
              ? flattenGeneratedItems(
                  selectedGoal.id,
                  cleaned.data.items,
                  "imported",
                )
              : parseRoadmapText(selectedGoal.id, text);
            const root = imported.length === 1
              ? undefined
              : imported.find(
                  (item) =>
                    !item.parentId &&
                    item.title.toLowerCase() === selectedGoal.title.toLowerCase(),
                );
            if (root) {
              imported = imported
                .filter((item) => item.id !== root.id)
                .map((item) =>
                  item.parentId === root.id
                    ? { ...item, parentId: null, depth: 1 }
                    : item.parentId
                      ? { ...item, depth: Math.max(1, item.depth - 1) }
                      : item,
                );
            }
            return {
              items: syncParentMetadata(imported),
              mode: cleaned ? "openai" as const : "heuristic" as const,
            };
          }}
          onImport={(previewItems) => {
            let imported = previewItems;
            const rootOffset = getChildren(selectedItems, null).length;
            let rootIndex = rootOffset;
            imported = imported.map((item) =>
              !item.parentId ? { ...item, orderIndex: rootIndex++ } : item,
            );
            mutateGoalItems((items) => [...items, ...imported]);
            setExpandedIds(
              new Set(
                imported
                  .filter((item) =>
                    imported.some((child) => child.parentId === item.id),
                  )
                  .map((item) => item.id),
              ),
            );
            setDialog(null);
            setToast(`${imported.length} roadmap items imported.`);
          }}
        />
      )}

      {focus && (
        <FocusOverlay
          focus={focus}
          item={data.items.find((item) => item.id === focus.itemId)}
          path={
            selectedGoal
              ? getItemPath(selectedGoal.title, selectedItems, focus.itemId)
              : ""
          }
          onPause={() =>
            setFocus((current) =>
              current ? { ...current, isRunning: false } : current,
            )
          }
          onResume={() =>
            setFocus((current) =>
              current ? { ...current, isRunning: true } : current,
            )
          }
          onStop={() =>
            setFocus((current) =>
              current ? { ...current, isRunning: false, review: true } : current,
            )
          }
          onFinish={finishSession}
        />
      )}

      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          {toast}
        </div>
      )}
    </div>
  );
}

function notify(title: string, body: string) {
  if ("Notification" in window && Notification.permission === "granted") {
    new Notification(title, { body });
  }
}

function Sidebar({
  goals,
  items,
  selectedGoalId,
  showHistory,
  onSelectGoal,
  onNewGoal,
  onShowHistory,
}: {
  goals: Goal[];
  items: RoadmapItem[];
  selectedGoalId: string;
  showHistory: boolean;
  onSelectGoal: (id: string) => void;
  onNewGoal: () => void;
  onShowHistory: () => void;
}) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark"><Check size={17} strokeWidth={3} /></div>
        <span>Flowlist</span>
      </div>
      <button className="new-goal-button" onClick={onNewGoal}>
        <Plus size={17} /> New goal
      </button>
      <div className="sidebar-section">
        <p className="sidebar-label">Goals</p>
        <nav className="goal-nav">
          {goals.map((goal) => {
            const stats = getGoalProgress(
              items.filter((item) => item.goalId === goal.id),
            );
            return (
              <button
                className={`goal-nav-item ${
                  !showHistory && selectedGoalId === goal.id ? "active" : ""
                }`}
                key={goal.id}
                onClick={() => onSelectGoal(goal.id)}
              >
                <span className="goal-nav-icon"><Target size={16} /></span>
                <span className="goal-nav-copy">
                  <span>{goal.title}</span>
                  <span className="mini-progress">
                    <span style={{ width: `${stats.progress}%` }} />
                  </span>
                </span>
                <span className="goal-percentage">{stats.progress}%</span>
              </button>
            );
          })}
          {!goals.length && <p className="sidebar-empty">Your goals will live here.</p>}
        </nav>
      </div>
      <div className="sidebar-bottom">
        <button
          className={`sidebar-link ${showHistory ? "active" : ""}`}
          onClick={onShowHistory}
        >
          <History size={17} /> Session history
        </button>
        <div className="local-badge"><span /> Saved locally on this Mac</div>
      </div>
    </aside>
  );
}

function Topbar({
  title,
  onNewGoal,
}: {
  title?: string;
  onNewGoal: () => void;
}) {
  return (
    <header className="topbar">
      <div className="window-dots" aria-hidden="true"><span /><span /><span /></div>
      <p>{title || "Flowlist"}</p>
      <button className="topbar-add" onClick={onNewGoal} aria-label="New goal">
        <Plus size={18} />
      </button>
    </header>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <section className="empty-state">
      <div className="empty-art">
        <div className="empty-art-card card-one"><Circle size={15} /><span /></div>
        <div className="empty-art-card card-two"><CheckCircle2 size={15} /><span /></div>
        <Sparkles className="empty-sparkle" size={24} />
      </div>
      <p className="eyebrow">A calmer way to make progress</p>
      <h1>Turn an ambitious goal into your next clear step.</h1>
      <p className="empty-description">
        Build a layered roadmap, then work through it one focused task at a time.
      </p>
      <button className="primary-button large" onClick={onCreate}>
        Create your first goal <ArrowRight size={17} />
      </button>
    </section>
  );
}

function GoalView({
  goal,
  items,
  progress,
  expandedIds,
  onToggleExpanded,
  onGenerate,
  onImport,
  onAddItem,
  onGenerateChildren,
  onToggle,
  onUpdate,
  onEditGoal,
  onUpdateGoal,
  onEditItem,
  onDeleteItem,
  onStart,
}: {
  goal: Goal;
  items: RoadmapItem[];
  progress: ReturnType<typeof getGoalProgress>;
  expandedIds: Set<string>;
  onToggleExpanded: (id: string) => void;
  onGenerate: () => void;
  onImport: () => void;
  onAddItem: (parentId?: string | null) => void;
  onGenerateChildren: (item: RoadmapItem) => void;
  onToggle: (item: RoadmapItem) => void;
  onUpdate: (id: string, updates: Partial<RoadmapItem>) => void;
  onEditGoal: () => void;
  onUpdateGoal: (updates: Partial<Goal>) => void;
  onEditItem: (item: RoadmapItem) => void;
  onDeleteItem: (item: RoadmapItem) => void;
  onStart: (item: RoadmapItem) => void;
}) {
  const roots = getChildren(items, null);

  return (
    <div className="goal-view">
      <section className="goal-header">
        <div>
          <p className="eyebrow"><CalendarDays size={13} /> Started {formatDate(goal.createdAt)}</p>
          <h1>{goal.title}</h1>
          {goal.description && <p className="goal-description">{goal.description}</p>}
        </div>
        <button className="secondary-button" onClick={onEditGoal}>
          <Pencil size={14} /> Edit goal
        </button>
      </section>
      <section className="progress-card">
        <div className="progress-copy">
          <div><span className="progress-value">{progress.progress}%</span><span>complete</span></div>
          <span>{progress.completed} of {progress.total} actionable tasks finished</span>
        </div>
        <div className="progress-track"><span style={{ width: `${progress.progress}%` }} /></div>
      </section>

      {!items.length ? (
        <section className="roadmap-empty">
          <div className="ai-orb"><BrainCircuit size={28} /></div>
          <p className="eyebrow">Your AI roadmap</p>
          <h2>Turn this goal into a layered plan.</h2>
          <p>
            Flowlist separates major areas, modules, and focus-sized tasks so
            broad topics never masquerade as one afternoon of work.
          </p>
          <div className="empty-actions">
            <button className="primary-button" onClick={onGenerate}>
              <Sparkles size={16} /> Generate roadmap
            </button>
            <button className="secondary-button" onClick={onImport}>
              <FileInput size={16} /> Import roadmap
            </button>
          </div>
          <button className="text-button" onClick={() => onAddItem(null)}>
            Or add a roadmap item manually
          </button>
        </section>
      ) : (
        <section className="checklist-section">
          <div className="section-heading">
            <div><p className="eyebrow">Roadmap tree</p><h2>From direction to action</h2></div>
            <div className="heading-actions">
              <button className="secondary-button" onClick={onImport}>
                <FileInput size={15} /> Import
              </button>
              <button className="secondary-button" onClick={onGenerate}>
                <Sparkles size={15} /> Add with AI
              </button>
              <button className="secondary-button" onClick={() => onAddItem(null)}>
                <Plus size={16} /> Add area
              </button>
            </div>
          </div>
          <div className="roadmap-legend">
            <FolderTree size={14} /> Expand areas to reach actionable focus tasks
          </div>
          <div className="roadmap-tree">
            {roots.map((item) => (
              <RoadmapRow
                key={item.id}
                item={item}
                items={items}
                expandedIds={expandedIds}
                onToggleExpanded={onToggleExpanded}
                onAddChild={onAddItem}
                onGenerateChildren={onGenerateChildren}
                onToggle={onToggle}
                onUpdate={onUpdate}
                onEdit={onEditItem}
                onDelete={onDeleteItem}
                onStart={onStart}
              />
            ))}
          </div>
        </section>
      )}
      <GoalNotes goal={goal} onSave={(notes) => onUpdateGoal({ notes })} />
    </div>
  );
}

function GoalNotes({
  goal,
  onSave,
}: {
  goal: Goal;
  onSave: (notes: string) => void;
}) {
  const [open, setOpen] = useState(Boolean(goal.notes));
  const [notes, setNotes] = useState(goal.notes ?? "");
  const [saved, setSaved] = useState(true);

  useEffect(() => {
    setNotes(goal.notes ?? "");
    setSaved(true);
  }, [goal.id, goal.notes]);

  return (
    <section className="goal-notes">
      <button className="notes-heading" onClick={() => setOpen((value) => !value)}>
        <span><NotebookPen size={17} /> Goal notes</span>
        {open ? <ChevronDown size={17} /> : <ChevronRight size={17} />}
      </button>
      {open && (
        <div className="notes-body">
          <textarea
            value={notes}
            onChange={(event) => {
              setNotes(event.target.value);
              setSaved(false);
            }}
            placeholder={"## Resources\n- Add useful links\n\n## Progress\n- Capture decisions and what to do next"}
            rows={9}
          />
          <div className="notes-footer">
            <span>{saved ? "Saved locally" : "Unsaved changes"}</span>
            <button
              className="primary-button"
              disabled={saved}
              onClick={() => {
                onSave(notes);
                setSaved(true);
              }}
            >
              <Save size={15} /> Save notes
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function RoadmapRow({
  item,
  items,
  expandedIds,
  onToggleExpanded,
  onAddChild,
  onGenerateChildren,
  onToggle,
  onUpdate,
  onEdit,
  onDelete,
  onStart,
}: {
  item: RoadmapItem;
  items: RoadmapItem[];
  expandedIds: Set<string>;
  onToggleExpanded: (id: string) => void;
  onAddChild: (parentId: string) => void;
  onGenerateChildren: (item: RoadmapItem) => void;
  onToggle: (item: RoadmapItem) => void;
  onUpdate: (id: string, updates: Partial<RoadmapItem>) => void;
  onEdit: (item: RoadmapItem) => void;
  onDelete: (item: RoadmapItem) => void;
  onStart: (item: RoadmapItem) => void;
}) {
  const children = getChildren(items, item.id);
  const hasChildren = children.length > 0;
  const expanded = expandedIds.has(item.id);
  const progress = getItemProgress(items, item);
  const canAddChildren = item.depth < MAX_ROADMAP_DEPTH;
  const hierarchyLabel =
    item.depth === 1 ? "Area" : item.depth === 2 ? "Module" : "Task";

  return (
    <div className={`tree-branch depth-${item.depth}`}>
      <article className={`roadmap-row ${item.status} ${hasChildren ? "parent" : "leaf"}`}>
        <button
          className={`tree-toggle ${hasChildren ? "" : "placeholder"}`}
          onClick={() => hasChildren && onToggleExpanded(item.id)}
          aria-label={expanded ? "Collapse" : "Expand"}
        >
          {hasChildren && (expanded ? <ChevronDown size={17} /> : <ChevronRight size={17} />)}
        </button>
        {hasChildren ? (
          <span className={`hierarchy-badge depth-${item.depth}`}>
            {hierarchyLabel}
          </span>
        ) : (
          <button className="check-button" onClick={() => onToggle(item)}>
            {progress === 100 && <Check size={15} strokeWidth={3} />}
          </button>
        )}
        <div className="item-copy">
          <div className="item-title-line">
            <h3>{item.title}</h3>
            <span className={`source-chip ${item.source ?? "manual"}`}>
              {item.source === "rag" ? "AI + source" : item.source?.replace("_", " ") ?? "manual"}
            </span>
          </div>
          {item.description && <p>{item.description}</p>}
          <div className="item-meta">
            {hasChildren ? (
              <>
                <span>{children.length} {children.length === 1 ? "section" : "sections"}</span>
                <span className="tree-progress"><span style={{ width: `${progress}%` }} /></span>
                <strong>{progress}%</strong>
              </>
            ) : (
              <><Clock3 size={13} /> {item.estimatedMinutes ?? 25} min</>
            )}
            {item.status === "in_progress" && <span className="status-label">In progress</span>}
          </div>
        </div>
        <div className="row-actions">
            <button className="row-icon-button" onClick={() => onEdit(item)} title="Edit item">
              <Pencil size={14} />
            </button>
            {canAddChildren && (
              <>
                <button className="row-icon-button" onClick={() => onAddChild(item.id)} title="Add subtask">
                  <Plus size={15} />
                </button>
                <button
                  className="row-ai-button"
                  onClick={() => onGenerateChildren(item)}
                  title="Generate subtasks"
                >
                  <WandSparkles size={14} /> Break down
                </button>
              </>
            )}
            {!hasChildren && item.status !== "completed" && (
              <button className="focus-button" onClick={() => onStart(item)}>
                <Play size={14} fill="currentColor" /> Focus
              </button>
            )}
            {!hasChildren && item.status === "completed" && (
              <span className="complete-label"><CheckCircle2 size={15} /> Done</span>
            )}
            <button className="row-icon-button danger" onClick={() => onDelete(item)} title="Delete item">
              <Trash2 size={14} />
            </button>
          </div>
      </article>
      {hasChildren && expanded && (
        <div className="tree-children">
          {children.map((child) => (
            <RoadmapRow
              key={child.id}
              item={child}
              items={items}
              expandedIds={expandedIds}
              onToggleExpanded={onToggleExpanded}
              onAddChild={onAddChild}
              onGenerateChildren={onGenerateChildren}
              onToggle={onToggle}
              onUpdate={onUpdate}
              onEdit={onEdit}
              onDelete={onDelete}
              onStart={onStart}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function HistoryView({
  sessions,
  goals,
  onSelectGoal,
}: {
  sessions: FocusSession[];
  goals: Goal[];
  onSelectGoal: (id: string) => void;
}) {
  const focusedMinutes = sessions.reduce(
    (total, session) => total + session.actualMinutes,
    0,
  );
  return (
    <div className="history-view">
      <section className="history-header">
        <p className="eyebrow">Your focus record</p>
        <h1>Session history</h1>
        <p>Small blocks of attention add up. Here’s the work you’ve logged.</p>
      </section>
      <div className="history-stats">
        <div><strong>{sessions.length}</strong><span>Sessions</span></div>
        <div><strong>{focusedMinutes}</strong><span>Focused minutes</span></div>
        <div><strong>{sessions.filter((session) => session.completed).length}</strong><span>Blocks completed</span></div>
      </div>
      {sessions.length ? (
        <div className="session-list">
          {sessions.map((session) => {
            const goal = goals.find((candidate) => candidate.id === session.goalId);
            return (
              <article className="session-row" key={session.id}>
                <div className="session-icon">
                  {session.completed ? <CheckCircle2 size={20} /> : <TimerReset size={20} />}
                </div>
                <div className="session-copy">
                  <h3>{session.itemTitle}</h3>
                  <button onClick={() => onSelectGoal(session.goalId)}>
                    {session.itemPath || goal?.title || "Deleted goal"} <ChevronRight size={13} />
                  </button>
                  {session.reflectionNote && <p>“{session.reflectionNote}”</p>}
                </div>
                <div className="session-meta">
                  <strong>{session.actualMinutes} min</strong>
                  <span>{formatSessionDate(session.endedAt)}</span>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="history-empty">
          <History size={26} /><h2>No focus sessions yet</h2>
          <p>Start a focus block from any leaf task. It’ll appear here.</p>
        </div>
      )}
    </div>
  );
}

function DialogFrame({
  children,
  onClose,
  wide = false,
}: {
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <section
        className={`dialog ${wide ? "dialog-wide" : ""}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button className="dialog-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
        {children}
      </section>
    </div>
  );
}

function GoalDialog({
  goal,
  onClose,
  onCreate,
}: {
  goal?: Goal;
  onClose: () => void;
  onCreate: (title: string, description: string) => void;
}) {
  const [title, setTitle] = useState(goal?.title ?? "");
  const [description, setDescription] = useState(goal?.description ?? "");
  return (
    <DialogFrame onClose={onClose}>
      <div className="dialog-icon"><Target size={21} /></div>
      <p className="eyebrow">{goal ? "Edit goal" : "New goal"}</p>
      <h2>{goal ? "Refine this goal" : "What do you want to make progress on?"}</h2>
      <p className="dialog-description">
        {goal
          ? "Keep the title and project context current as your direction changes."
          : "Keep it specific enough to act on. Flowlist will help with the layers."}
      </p>
      <form onSubmit={(event) => {
        event.preventDefault();
        if (title.trim()) onCreate(title.trim(), description.trim());
      }}>
        <label className="field"><span>Goal</span>
          <input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Learn AI engineering" />
        </label>
        <label className="field"><span>Context <small>Optional</small></span>
          <textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Experience, deadline, constraints, or desired outcome..." rows={3} />
        </label>
        <button className="primary-button full" disabled={!title.trim()}>
          {goal ? "Save changes" : "Create goal"} {goal ? <Save size={16} /> : <ArrowRight size={16} />}
        </button>
      </form>
    </DialogFrame>
  );
}

function GenerateDialog({
  goal,
  parent,
  onClose,
  onGenerate,
}: {
  goal: Goal;
  parent?: RoadmapItem;
  onClose: () => void;
  onGenerate: (preferences: RoadmapGenerationPreferences) => Promise<void>;
}) {
  const [currentLevel, setCurrentLevel] =
    useState<RoadmapGenerationPreferences["currentLevel"]>("beginner");
  const [timeline, setTimeline] =
    useState<RoadmapGenerationPreferences["timeline"]>("3 months");
  const [weeklyHours, setWeeklyHours] = useState(5);
  const [detailLevel, setDetailLevel] =
    useState<RoadmapGenerationPreferences["detailLevel"]>("balanced");
  const [context, setContext] = useState(goal.description ?? "");
  const [generating, setGenerating] = useState(false);
  return (
    <DialogFrame onClose={onClose} wide>
      <div className="dialog-icon violet"><Sparkles size={21} /></div>
      <p className="eyebrow">{parent ? "AI task breakdown" : "AI roadmap"}</p>
      <h2>{parent ? `Break down “${parent.title}”` : "Build a layered plan for this goal"}</h2>
      <p className="dialog-description">
        {parent
          ? "New tasks append to anything already here. Existing work is never overwritten."
          : "Flowlist will create major areas, modules, and practical leaf tasks."}
      </p>
      <label className="field"><span>Goal</span>
        <input value={parent?.title ?? goal.title} readOnly />
      </label>
      {!parent && (
        <div className="generation-grid">
          <label className="field"><span>Current level</span>
            <select value={currentLevel} onChange={(event) => setCurrentLevel(event.target.value as RoadmapGenerationPreferences["currentLevel"])}>
              <option value="beginner">Beginner</option>
              <option value="intermediate">Intermediate</option>
              <option value="advanced">Advanced</option>
            </select>
          </label>
          <label className="field"><span>Target timeline</span>
            <select value={timeline} onChange={(event) => setTimeline(event.target.value as RoadmapGenerationPreferences["timeline"])}>
              <option value="1 month">1 month</option>
              <option value="3 months">3 months</option>
              <option value="6 months">6 months</option>
              <option value="No deadline">No deadline</option>
            </select>
          </label>
          <label className="field"><span>Weekly time</span>
            <select value={weeklyHours} onChange={(event) => setWeeklyHours(Number(event.target.value))}>
              <option value={2}>2 hours / week</option>
              <option value={5}>5 hours / week</option>
              <option value={10}>10 hours / week</option>
              <option value={15}>15 hours / week</option>
              <option value={20}>20+ hours / week</option>
            </select>
          </label>
          <label className="field"><span>Detail level</span>
            <select value={detailLevel} onChange={(event) => setDetailLevel(event.target.value as RoadmapGenerationPreferences["detailLevel"])}>
              <option value="high-level">High-level</option>
              <option value="balanced">Balanced</option>
              <option value="detailed">Detailed</option>
            </select>
          </label>
        </div>
      )}
      <label className="field"><span>Extra context <small>Optional</small></span>
        <textarea value={context} onChange={(event) => setContext(event.target.value)} placeholder="Mention experience, constraints, preferred resources, or what success looks like..." rows={4} />
      </label>
      <button
        className="primary-button full"
        disabled={generating}
        onClick={async () => {
          setGenerating(true);
          await onGenerate({
            currentLevel,
            timeline,
            weeklyHours,
            detailLevel,
            additionalContext: context,
          });
        }}
      >
        {generating ? <><span className="spinner" /> Building the roadmap…</> : <><Sparkles size={16} /> {parent ? "Generate subtasks" : "Generate roadmap"}</>}
      </button>
      <p className="mock-note">Uses OpenAI when configured; otherwise falls back to a local generator.</p>
    </DialogFrame>
  );
}

function EditItemDialog({
  item,
  hasChildren,
  onClose,
  onSave,
}: {
  item?: RoadmapItem;
  hasChildren: boolean;
  onClose: () => void;
  onSave: (updates: Partial<RoadmapItem>) => void;
}) {
  const [title, setTitle] = useState(item?.title ?? "");
  const [description, setDescription] = useState(item?.description ?? "");
  const [minutes, setMinutes] = useState(item?.estimatedMinutes ?? 25);
  if (!item) return null;

  return (
    <DialogFrame onClose={onClose}>
      <div className="dialog-icon"><Pencil size={20} /></div>
      <p className="eyebrow">Edit roadmap item</p>
      <h2>Make this item clearer</h2>
      <p className="dialog-description">
        Use plain language and enough context to understand the task later.
      </p>
      <form onSubmit={(event) => {
        event.preventDefault();
        if (!title.trim()) return;
        onSave({
          title: title.trim(),
          description: description.trim() || undefined,
          estimatedMinutes: hasChildren
            ? item.estimatedMinutes
            : Math.max(5, Math.min(180, minutes)),
        });
      }}>
        <label className="field"><span>Title</span>
          <input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label className="field"><span>Description <small>Optional</small></span>
          <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={4} placeholder="Add useful context, a definition of done, or a resource link..." />
        </label>
        {!hasChildren && (
          <label className="field"><span>Estimated minutes</span>
            <input type="number" min="5" max="180" step="5" value={minutes} onChange={(event) => setMinutes(Number(event.target.value))} />
          </label>
        )}
        <button className="primary-button full" disabled={!title.trim()}>
          Save changes <Save size={16} />
        </button>
      </form>
    </DialogFrame>
  );
}

function AddItemDialog({
  parent,
  onClose,
  onAdd,
}: {
  parent?: RoadmapItem;
  onClose: () => void;
  onAdd: (title: string, minutes?: number) => void;
}) {
  const [title, setTitle] = useState("");
  const [minutes, setMinutes] = useState(25);
  const willBeLeaf = !parent || parent.depth + 1 >= MAX_ROADMAP_DEPTH;
  return (
    <DialogFrame onClose={onClose}>
      <div className="dialog-icon"><ListChecks size={21} /></div>
      <p className="eyebrow">{parent ? "New child item" : "New roadmap area"}</p>
      <h2>{parent ? `Add beneath “${parent.title}”` : "Add a roadmap item"}</h2>
      <p className="dialog-description">
        {willBeLeaf ? "This level is actionable and can start a focus session." : "You can break this item into smaller children later."}
      </p>
      <form onSubmit={(event) => {
        event.preventDefault();
        if (title.trim()) onAdd(title.trim(), willBeLeaf ? minutes : undefined);
      }}>
        <label className="field"><span>Title</span>
          <input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Build a small counter app" />
        </label>
        {willBeLeaf && (
          <label className="field"><span>Estimated time</span>
            <select value={minutes} onChange={(event) => setMinutes(Number(event.target.value))}>
              <option value={25}>25 minutes</option>
              <option value={50}>50 minutes</option>
              <option value={60}>60 minutes</option>
              <option value={90}>90 minutes</option>
            </select>
          </label>
        )}
        <button className="primary-button full" disabled={!title.trim()}>Add item <Plus size={16} /></button>
      </form>
    </DialogFrame>
  );
}

function ImportDialog({
  goal,
  onClose,
  onPreview,
  onImport,
}: {
  goal: Goal;
  onClose: () => void;
  onPreview: (text: string) => Promise<{
    items: RoadmapItem[];
    mode: "openai" | "heuristic";
  }>;
  onImport: (items: RoadmapItem[]) => void;
}) {
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<RoadmapItem[] | null>(null);
  const [mode, setMode] = useState<"openai" | "heuristic">("heuristic");
  const [loading, setLoading] = useState(false);
  const roots = preview ? getChildren(preview, null) : [];
  return (
    <DialogFrame onClose={onClose} wide>
      <div className="dialog-icon"><FileInput size={21} /></div>
      <p className="eyebrow">Import roadmap</p>
      <h2>Paste Markdown or plain text</h2>
      <p className="dialog-description">
        Headings, nested bullets, and checkboxes become roadmap levels. Checked
        items remain completed.
      </p>
      {!preview ? (
        <>
          <div className="goal-context-card"><Target size={16} /><span>{goal.title}</span></div>
          <label className="field import-field"><span>Roadmap text</span>
            <textarea
              autoFocus
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder={"# Learn JavaScript\n\nA practical learning plan for frontend work.\n\n## Basics\n- [ ] Practice variables — 25 min\n- [x] Write functions\n\nResources: https://javascript.info"}
              rows={12}
            />
          </label>
          <div className="import-help">
            <code># Area</code><code>## Module</code><code>- [ ] Task</code><code>- [x] Done</code>
          </div>
          <button
            className="primary-button full"
            disabled={!text.trim() || loading}
            onClick={async () => {
              setLoading(true);
              const result = await onPreview(text);
              setPreview(result.items);
              setMode(result.mode);
              setLoading(false);
            }}
          >
            {loading ? <><span className="spinner" /> Cleaning roadmap…</> : <><WandSparkles size={16} /> Clean and preview</>}
          </button>
        </>
      ) : (
        <>
          <div className="preview-summary">
            <div><strong>{preview.length}</strong><span>items found</span></div>
            <span>{mode === "openai" ? "Cleaned with OpenAI" : "Cleaned locally"}</span>
          </div>
          <div className="import-preview">
            {roots.length ? roots.map((item) => (
              <ImportPreviewNode key={item.id} item={item} items={preview} />
            )) : <p>No structured roadmap items were found. Add headings, checkboxes, or short bullets.</p>}
          </div>
          <div className="preview-actions">
            <button className="secondary-button" onClick={() => setPreview(null)}>Back to text</button>
            <button className="primary-button" disabled={!preview.length} onClick={() => onImport(preview)}>
              <FileInput size={16} /> Import {preview.length} items
            </button>
          </div>
        </>
      )}
    </DialogFrame>
  );
}

function ImportPreviewNode({
  item,
  items,
}: {
  item: RoadmapItem;
  items: RoadmapItem[];
}) {
  const children = getChildren(items, item.id);
  return (
    <div className="preview-node">
      <div>
        {children.length ? <FolderTree size={14} /> : item.status === "completed" ? <CheckCircle2 size={14} /> : <Circle size={14} />}
        <span>{item.title}</span>
        <small>{item.depth === 1 ? "Area" : item.depth === 2 ? "Module" : "Task"}</small>
      </div>
      {item.description && <p>{item.description}</p>}
      {children.length > 0 && (
        <div className="preview-children">
          {children.map((child) => <ImportPreviewNode key={child.id} item={child} items={items} />)}
        </div>
      )}
    </div>
  );
}

function FocusOverlay({
  focus,
  item,
  path,
  onPause,
  onResume,
  onStop,
  onFinish,
}: {
  focus: FocusState;
  item?: RoadmapItem;
  path: string;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onFinish: (status: ItemStatus | null, reflection: string) => void;
}) {
  const [reflection, setReflection] = useState("");
  const phaseTotal = focus.phase === "focus" ? FOCUS_SECONDS : BREAK_SECONDS;
  const timerProgress = ((phaseTotal - focus.secondsLeft) / phaseTotal) * 100;

  if (focus.review) {
    return (
      <div className="focus-overlay">
        <section className="review-card">
          <div className="review-check"><Check size={28} strokeWidth={2.5} /></div>
          <p className="eyebrow">Session logged</p>
          <h2>How did that focus block go?</h2>
          <p className="review-item">{path}</p>
          <label className="field reflection-field"><span>Quick reflection <small>Optional</small></span>
            <textarea autoFocus value={reflection} onChange={(event) => setReflection(event.target.value)} placeholder="What moved forward? What should you remember next time?" rows={3} />
          </label>
          <div className="review-actions">
            <button className="primary-button full" onClick={() => onFinish("completed", reflection)}><CheckCircle2 size={17} /> Mark task complete</button>
            <button className="secondary-button full" onClick={() => onFinish("in_progress", reflection)}>Keep in progress</button>
            <button className="text-button" onClick={() => onFinish(null, reflection)}>Leave unfinished</button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className={`focus-overlay ${focus.phase}`}>
      <section className="focus-screen">
        <div className="focus-top">
          <div className="focus-brand"><div className="brand-mark"><Check size={15} strokeWidth={3} /></div>Flowlist</div>
          <button onClick={onStop}>End session <X size={17} /></button>
        </div>
        <div className="focus-content">
          <div className={`phase-pill ${focus.phase}`}>
            {focus.phase === "focus" ? <Target size={14} /> : <Coffee size={14} />}
            {focus.phase === "focus" ? "Focus" : "Break"}
          </div>
          <p className="focus-goal">{path}</p>
          <h1>{focus.phase === "focus" ? item?.title : "Step away and reset."}</h1>
          {focus.phase === "break" && <p className="break-message">Your focus block is complete. Stretch, breathe, get some water.</p>}
          <div className="timer-ring" style={{ "--timer-progress": `${timerProgress * 3.6}deg` } as React.CSSProperties}>
            <div className="timer-inner"><span>{formatTimer(focus.secondsLeft)}</span><small>{focus.isRunning ? "remaining" : "paused"}</small></div>
          </div>
          <div className="timer-controls">
            <button className="timer-primary" onClick={focus.isRunning ? onPause : onResume}>
              {focus.isRunning ? <><Pause size={20} fill="currentColor" /> Pause</> : <><Play size={20} fill="currentColor" /> Resume</>}
            </button>
            <button className="timer-stop" onClick={onStop} aria-label="Stop"><Square size={18} fill="currentColor" /></button>
          </div>
          <p className="focus-hint">{focus.phase === "focus" ? "One clear task. Everything else can wait." : "The roadmap will still be here when you return."}</p>
        </div>
      </section>
    </div>
  );
}

export default App;
