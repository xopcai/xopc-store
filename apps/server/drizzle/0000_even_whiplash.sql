CREATE TABLE `package_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`package_id` text NOT NULL,
	`version` text NOT NULL,
	`file_key` text NOT NULL,
	`file_size` integer NOT NULL,
	`manifest` text NOT NULL,
	`changelog` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`reject_reason` text,
	`published_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`package_id`) REFERENCES `packages`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pkg_version_unique` ON `package_versions` (`package_id`,`version`);--> statement-breakpoint
CREATE TABLE `packages` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`description` text NOT NULL,
	`readme` text,
	`author_id` text NOT NULL,
	`latest_version_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`downloads` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `packages_name_unique` ON `packages` (`name`);--> statement-breakpoint
CREATE TABLE `review_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`version_id` text NOT NULL,
	`reviewer_id` text NOT NULL,
	`action` text NOT NULL,
	`reason` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`version_id`) REFERENCES `package_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reviewer_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`github_id` integer NOT NULL,
	`username` text NOT NULL,
	`avatar_url` text,
	`email` text,
	`role` text DEFAULT 'user' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_github_id_unique` ON `users` (`github_id`);