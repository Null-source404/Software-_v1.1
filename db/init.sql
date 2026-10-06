-- Run this in your MySQL client to create the required database and table:
CREATE DATABASE IF NOT EXISTS url_shortener;
USE url_shortener;

CREATE TABLE IF NOT EXISTS urls (
  id INT PRIMARY KEY AUTO_INCREMENT,
  short_code VARCHAR(32) NOT NULL UNIQUE,
  original_url TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_accessed_at DATETIME NULL,
  click_count INT NOT NULL DEFAULT 0,
  max_clicks INT NULL DEFAULT NULL,
  analytics_json LONGTEXT NULL
);
