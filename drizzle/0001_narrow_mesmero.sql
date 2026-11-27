CREATE TABLE `schedule_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`title` varchar(180) NOT NULL,
	`description` text,
	`category` enum('class','assignment','exam','reminder') NOT NULL,
	`startAt` timestamp NOT NULL,
	`endAt` timestamp,
	`status` enum('scheduled','completed') NOT NULL DEFAULT 'scheduled',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `schedule_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `schedule_items` ADD CONSTRAINT `schedule_items_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `schedule_items_user_start_idx` ON `schedule_items` (`userId`,`startAt`);