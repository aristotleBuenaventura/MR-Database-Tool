-- CreateTable
CREATE TABLE `user_sessions` (
    `id` VARCHAR(36) NOT NULL,
    `user_id` INTEGER NOT NULL,
    `ip_address` VARCHAR(64) NULL,
    `user_agent` VARCHAR(512) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `last_seen_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `revoked_at` DATETIME(3) NULL,

    INDEX `idx_session_user_revoked`(`user_id`, `revoked_at`),
    INDEX `idx_session_last_seen`(`last_seen_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `user_sessions` ADD CONSTRAINT `user_sessions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
