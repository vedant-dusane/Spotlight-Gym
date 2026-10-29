-- Gym Classes schema (MySQL 8.0.16+, InnoDB). Safe to run repeatedly.

CREATE TABLE IF NOT EXISTS users (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(100) NOT NULL,
  email         VARCHAR(190) NOT NULL,
  password_hash VARCHAR(100) NOT NULL,           -- bcrypt, never the plain password
  role          ENUM('member','trainer','admin') NOT NULL DEFAULT 'member',
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS membership_plans (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(80) NOT NULL,
  type        ENUM('monthly','quarterly') NOT NULL,  -- 1 or 3 calendar months
  price_minor INT UNSIGNED NOT NULL,                 -- price in minor units (paise)
  is_active   TINYINT(1) NOT NULL DEFAULT 1,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS memberships (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id    INT UNSIGNED NOT NULL,
  plan_id    INT UNSIGNED NOT NULL,
  start_date DATE NOT NULL,                          -- inclusive
  end_date   DATE NOT NULL,                          -- inclusive
  status     ENUM('active','cancelled') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_memberships_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_memberships_plan FOREIGN KEY (plan_id) REFERENCES membership_plans(id),
  CONSTRAINT chk_membership_dates CHECK (end_date >= start_date),
  KEY idx_memberships_user (user_id, end_date)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS classes (
  id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  title            VARCHAR(80) NOT NULL,
  description      VARCHAR(500) NULL,
  trainer_id       INT UNSIGNED NOT NULL,
  starts_at        DATETIME NOT NULL,                -- stored in UTC
  duration_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 60,
  capacity         SMALLINT UNSIGNED NOT NULL,
  status           ENUM('scheduled','cancelled') NOT NULL DEFAULT 'scheduled',
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_classes_trainer FOREIGN KEY (trainer_id) REFERENCES users(id),
  CONSTRAINT chk_class_capacity CHECK (capacity > 0),
  CONSTRAINT chk_class_duration CHECK (duration_minutes > 0),
  KEY idx_classes_starts (starts_at),
  KEY idx_classes_trainer (trainer_id, starts_at)
) ENGINE=InnoDB;

-- One row per (member, class) attempt.
--   booked / attended / no_show  -> occupy a spot
--   waitlisted                   -> queue position = order of `id` (auto-increment == arrival order)
--   cancelled                    -> history only
-- active_user_id is NULL for cancelled rows, so the UNIQUE key below guarantees a member
-- can hold at most ONE live row per class, even under concurrent requests.
-- (No ON DELETE/UPDATE CASCADE on user_id: MySQL forbids it on columns used by a stored generated column.)
CREATE TABLE IF NOT EXISTS bookings (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  class_id       INT UNSIGNED NOT NULL,
  user_id        INT UNSIGNED NOT NULL,
  status         ENUM('booked','waitlisted','attended','no_show','cancelled') NOT NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  promoted_at    DATETIME NULL,
  cancelled_at   DATETIME NULL,
  cancel_reason  VARCHAR(40) NULL,
  active_user_id INT UNSIGNED GENERATED ALWAYS AS (IF(status = 'cancelled', NULL, user_id)) STORED,
  CONSTRAINT fk_bookings_class FOREIGN KEY (class_id) REFERENCES classes(id),
  CONSTRAINT fk_bookings_user  FOREIGN KEY (user_id)  REFERENCES users(id),
  UNIQUE KEY uq_one_live_booking (class_id, active_user_id),
  KEY idx_bookings_class_status (class_id, status, id),
  KEY idx_bookings_user (user_id, status)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS notifications (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id    INT UNSIGNED NOT NULL,
  kind       VARCHAR(40) NOT NULL,
  message    VARCHAR(255) NOT NULL,
  dedupe_key VARCHAR(120) NULL,                      -- stops the same reminder being sent twice
  read_at    DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users(id),
  UNIQUE KEY uq_notifications_dedupe (dedupe_key),
  KEY idx_notifications_user (user_id, read_at, id)
) ENGINE=InnoDB;
