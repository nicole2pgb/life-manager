ALTER TABLE `task_completions` MODIFY COLUMN `completed_at` datetime(3) NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` MODIFY COLUMN `completed_at` datetime(3);--> statement-breakpoint
ALTER TABLE `tasks` MODIFY COLUMN `created_at` datetime(3) NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` MODIFY COLUMN `updated_at` datetime(3) NOT NULL;