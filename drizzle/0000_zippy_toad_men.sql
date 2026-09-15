CREATE TABLE `task_completions` (
	`id` char(36) NOT NULL,
	`task_id` char(36) NOT NULL,
	`occurrence_date` date NOT NULL,
	`completed_at` datetime NOT NULL,
	CONSTRAINT `task_completions_id` PRIMARY KEY(`id`),
	CONSTRAINT `one_completion_per_task_per_day` UNIQUE(`task_id`,`occurrence_date`)
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` char(36) NOT NULL,
	`title` varchar(200) NOT NULL,
	`notes` varchar(2000),
	`completed` boolean NOT NULL DEFAULT false,
	`completed_at` datetime,
	`recurrence` json,
	`created_at` datetime NOT NULL,
	`updated_at` datetime NOT NULL,
	CONSTRAINT `tasks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `task_completions` ADD CONSTRAINT `task_completions_task_id_tasks_id_fk` FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON DELETE cascade ON UPDATE no action;