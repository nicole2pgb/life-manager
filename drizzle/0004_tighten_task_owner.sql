-- No DELETE here by design: this migration must never silently discard
-- orphaned rows. If any task still has a NULL user_id when this runs, the
-- MODIFY below fails outright (MySQL refuses to add NOT NULL over an
-- existing NULL) and the migration aborts — that failure is the intended
-- behavior, not something to work around. Before applying, confirm
-- `SELECT COUNT(*) FROM tasks WHERE user_id IS NULL` returns 0 (the 4
-- legacy tasks were explicitly assigned via scripts/assign-legacy-tasks.ts,
-- not by any automatic/general rule — see specs/user-login.md's Migration
-- Strategy). If it doesn't, resolve those rows first (assign or
-- deliberately delete them yourself) rather than letting this migration do
-- it implicitly.
ALTER TABLE `tasks` MODIFY COLUMN `user_id` char(36) NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD CONSTRAINT `tasks_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;