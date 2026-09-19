export interface Task { id: number; goal_id: number; parent_id: number | null; depth: number; title: string; completed: boolean; position: number }
export interface Goal { id: number; title: string; completed: boolean; goal_type: 'project' | 'learning' | 'standalone'; position: number }
export interface Selection { task_id: number; completed: boolean }
export interface SessionPayload { client_id: string; planned_minutes: number; actual_minutes: number; completed: boolean; summary: string | null; tasks: Selection[] }
export interface ActivityDay { date: string; minutes: number; sessions: number }
export interface Dashboard { goals: { goal: Goal; tasks: Task[] }[]; stats: { current_streak: number; total_sessions: number; total_minutes: number }; week_sessions: number; activity: ActivityDay[] }
