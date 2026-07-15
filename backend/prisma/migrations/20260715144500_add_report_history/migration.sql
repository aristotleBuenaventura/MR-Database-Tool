-- CreateTable
CREATE TABLE `report_histories` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `market_id` VARCHAR(100) NOT NULL,
    `action` VARCHAR(64) NOT NULL,
    `label` VARCHAR(512) NOT NULL,
    `weeks` TEXT NOT NULL,
    `file_name` VARCHAR(255) NULL,
    `user_id` INTEGER NULL,
    `user_email` VARCHAR(255) NULL,
    `user_name` VARCHAR(255) NULL,
    `ip_address` VARCHAR(64) NULL,
    `user_agent` VARCHAR(512) NULL,
    `item_count` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `idx_history_market_created`(`market_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `report_history_items` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `history_id` INTEGER NOT NULL,
    `week` VARCHAR(32) NOT NULL,
    `tab_id` VARCHAR(64) NOT NULL,
    `category` VARCHAR(64) NOT NULL DEFAULT '',
    `columns` JSON NOT NULL,
    `rows` JSON NOT NULL,
    `file_name` VARCHAR(255) NULL,
    `sheet_name` VARCHAR(255) NULL,
    `location` VARCHAR(255) NULL,

    INDEX `idx_history_item_history`(`history_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `report_history_items` ADD CONSTRAINT `report_history_items_history_id_fkey` FOREIGN KEY (`history_id`) REFERENCES `report_histories`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
