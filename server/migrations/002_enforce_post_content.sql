DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint constraint_row
    WHERE constraint_row.conrelid = 'posts'::regclass
      AND constraint_row.conname = 'posts_schedule_required'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_constraint constraint_row
    WHERE constraint_row.conrelid = 'posts'::regclass
      AND constraint_row.contype = 'c'
      AND pg_get_constraintdef(constraint_row.oid) LIKE '%status%scheduled%scheduled_at%'
  ) THEN
    ALTER TABLE posts
      ADD CONSTRAINT posts_schedule_required CHECK (
        status <> 'scheduled'::post_status OR scheduled_at IS NOT NULL
      );
  END IF;
END $$;
