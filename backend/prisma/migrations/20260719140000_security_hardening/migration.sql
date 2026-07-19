-- AlterTable
ALTER TABLE `users`
    ADD COLUMN `failed_login_attempts` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `locked_until` DATETIME(3) NULL,
    ADD COLUMN `totp_secret` VARCHAR(255) NULL,
    ADD COLUMN `totp_enabled` BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE `security_audit_logs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `event` VARCHAR(64) NOT NULL,
    `user_id` INTEGER NULL,
    `email` VARCHAR(255) NULL,
    `ip_address` VARCHAR(64) NULL,
    `user_agent` VARCHAR(512) NULL,
    `detail` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `idx_audit_created`(`created_at`),
    INDEX `idx_audit_event_created`(`event`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
