-- Migration 007: Add about_answers to users
-- Stores the "Knowing more about you" onboarding answers as JSONB.
-- Shape: { nature: string[], hobbies: string[], movie_genres: string[],
--          music: string[], date_style: string[] }
-- Multi-select chips + user-added custom entries, no emojis.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS about_answers JSONB;
