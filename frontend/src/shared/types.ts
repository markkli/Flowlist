export interface Task { id: number; goal_id: number; parent_id: number | null; depth: number; title: string; completed: boolean; position: number }
export interface Goal { id: number; title: string; completed: boolean; goal_type: 'project' | 'standalone'; position: number }
export interface Selection { task_id: number; completed: boolean }
export interface FocusBlockInput { started_at: string; ended_at: string }
export interface SessionPayload { started_at?: string; ended_at?: string; blocks?: FocusBlockInput[]; client_id: string; planned_minutes: number; actual_minutes: number; completed: boolean; summary: string | null; tasks: Selection[] }
export interface ActivityDay { date: string; minutes: number; sessions: number }
export interface QueueEntry { task: Task; goal: Goal }
export interface Dashboard { queue: QueueEntry[]; goals: { goal: Goal; tasks: Task[] }[]; stats: { current_streak: number; total_sessions: number; total_minutes: number }; week_sessions: number; activity: ActivityDay[] }
