PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_package_versions` (
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
	FOREIGN KEY (`package_id`) REFERENCES `packages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_package_versions`("id", "package_id", "version", "file_key", "file_size", "manifest", "changelog", "status", "reject_reason", "published_at", "created_at") SELECT "id", "package_id", "version", "file_key", "file_size", "manifest", "changelog", "status", "reject_reason", "published_at", "created_at" FROM `package_versions`;--> statement-breakpoint
DROP TABLE `package_versions`;--> statement-breakpoint
ALTER TABLE `__new_package_versions` RENAME TO `package_versions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `pkg_version_unique` ON `package_versions` (`package_id`,`version`);--> statement-breakpoint
CREATE TABLE `__new_review_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`version_id` text NOT NULL,
	`reviewer_id` text NOT NULL,
	`action` text NOT NULL,
	`reason` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`version_id`) REFERENCES `package_versions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reviewer_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_review_logs`("id", "version_id", "reviewer_id", "action", "reason", "created_at") SELECT "id", "version_id", "reviewer_id", "action", "reason", "created_at" FROM `review_logs`;--> statement-breakpoint
DROP TABLE `review_logs`;--> statement-breakpoint
ALTER TABLE `__new_review_logs` RENAME TO `review_logs`;