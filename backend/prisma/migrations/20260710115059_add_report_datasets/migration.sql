-- AlterTable
ALTER TABLE `users` MODIFY `role` VARCHAR(50) NOT NULL DEFAULT 'viewer';

-- CreateTable
CREATE TABLE `report_datasets` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `market_id` VARCHAR(100) NOT NULL,
    `week` VARCHAR(32) NOT NULL,
    `tab_id` VARCHAR(64) NOT NULL,
    `category` VARCHAR(64) NOT NULL DEFAULT '',
    `columns` JSON NOT NULL,
    `rows` JSON NOT NULL,
    `file_name` VARCHAR(255) NULL,
    `sheet_name` VARCHAR(255) NULL,
    `location` VARCHAR(255) NULL,
    `uploaded_by` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `idx_market_week`(`market_id`, `week`),
    UNIQUE INDEX `uniq_market_week_tab_category`(`market_id`, `week`, `tab_id`, `category`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
