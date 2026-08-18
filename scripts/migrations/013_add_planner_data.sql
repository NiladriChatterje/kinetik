-- 013_add_planner_data.sql
-- Adds a JSONB column to store the collaborative date planner data
-- (selected activities, shared checklist/todos, and notes) for each match.
-- The column is nullable — matches without a planner plan keep it NULL.
ALTER TABLE matches ADD COLUMN IF NOT EXISTS planner_data JSONB;
