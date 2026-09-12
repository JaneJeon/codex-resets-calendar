CREATE TABLE `dtsm_categories` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`description` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `dtsm_event_categories` (
	`event_id` integer NOT NULL,
	`category_id` integer NOT NULL,
	`position` integer NOT NULL,
	PRIMARY KEY(`event_id`, `category_id`),
	FOREIGN KEY (`event_id`) REFERENCES `dtsm_events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `dtsm_categories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `dtsm_event_categories_event_idx` ON `dtsm_event_categories` (`event_id`);--> statement-breakpoint
CREATE INDEX `dtsm_event_categories_category_idx` ON `dtsm_event_categories` (`category_id`);--> statement-breakpoint
CREATE TABLE `dtsm_event_organizers` (
	`event_id` integer NOT NULL,
	`organizer_id` integer NOT NULL,
	`position` integer NOT NULL,
	PRIMARY KEY(`event_id`, `organizer_id`),
	FOREIGN KEY (`event_id`) REFERENCES `dtsm_events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organizer_id`) REFERENCES `dtsm_organizers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `dtsm_event_organizers_event_idx` ON `dtsm_event_organizers` (`event_id`);--> statement-breakpoint
CREATE INDEX `dtsm_event_organizers_organizer_idx` ON `dtsm_event_organizers` (`organizer_id`);--> statement-breakpoint
CREATE TABLE `dtsm_events` (
	`id` integer PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description_html` text NOT NULL,
	`url` text,
	`website` text,
	`start_local` text NOT NULL,
	`end_local` text NOT NULL,
	`all_day` integer NOT NULL,
	`status` text NOT NULL,
	`venue_id` integer,
	`created_utc` text,
	`modified_utc` text,
	`withdrawn_at` integer,
	FOREIGN KEY (`venue_id`) REFERENCES `dtsm_venues`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `dtsm_events_end_local_idx` ON `dtsm_events` (`end_local`);--> statement-breakpoint
CREATE INDEX `dtsm_events_venue_idx` ON `dtsm_events` (`venue_id`);--> statement-breakpoint
CREATE TABLE `dtsm_organizers` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`phone` text NOT NULL,
	`website` text,
	`url` text,
	`modified_utc` text
);
--> statement-breakpoint
CREATE TABLE `dtsm_sync_state` (
	`calendar` text PRIMARY KEY NOT NULL,
	`last_success_at` integer,
	`next_attempt_at` integer DEFAULT 0 NOT NULL,
	`lease_until` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `dtsm_venues` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`address` text NOT NULL,
	`city` text NOT NULL,
	`state_province` text NOT NULL,
	`country` text NOT NULL,
	`zip` text NOT NULL,
	`url` text,
	`modified_utc` text
);
--> statement-breakpoint
INSERT INTO `dtsm_sync_state` (`calendar`) VALUES ('dtsm-events');
