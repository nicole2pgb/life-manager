-- Custom SQL migration file, put your code below! --
-- specs/mysql-persistence.md requires InnoDB (task_completions depends on a
-- foreign key with ON DELETE CASCADE, which MyISAM does not support at all).
-- The original migration (0000) relied on the server's default engine
-- instead of stating this explicitly. Since a foreign key with ON DELETE
-- CASCADE already exists on task_completions, both tables must already be
-- InnoDB wherever migration 0000 succeeded — this statement is an idempotent
-- no-op there, and only has any real effect on a server whose default ever
-- changes or differs.
ALTER TABLE `tasks` ENGINE = InnoDB;
--> statement-breakpoint
ALTER TABLE `task_completions` ENGINE = InnoDB;
