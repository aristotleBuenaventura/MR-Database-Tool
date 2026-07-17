-- CreateTable
CREATE TABLE `report_backups` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `market_id` VARCHAR(100) NOT NULL,
    `label` VARCHAR(512) NOT NULL,
    `trigger` VARCHAR(32) NOT NULL DEFAULT 'manual',
    `item_count` INTEGER NOT NULL DEFAULT 0,
    `row_count` INTEGER NOT NULL DEFAULT 0,
    `user_id` INTEGER NULL,
    `user_email` VARCHAR(255) NULL,
    `user_name` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `idx_backup_market_created`(`market_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `report_backup_items` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `backup_id` INTEGER NOT NULL,
    `market_id` VARCHAR(100) NOT NULL,
    `week` VARCHAR(32) NOT NULL,
    `tab_id` VARCHAR(64) NOT NULL,
    `category` VARCHAR(64) NOT NULL DEFAULT '',
    `columns` JSON NOT NULL,
    `rows` JSON NOT NULL,
    `file_name` VARCHAR(255) NULL,
    `sheet_name` VARCHAR(255) NULL,
    `location` VARCHAR(255) NULL,

    INDEX `idx_backup_item_backup`(`backup_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `app_settings` (
    `key` VARCHAR(100) NOT NULL,
    `value` TEXT NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `report_backup_items` ADD CONSTRAINT `report_backup_items_backup_id_fkey` FOREIGN KEY (`backup_id`) REFERENCES `report_backups`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
