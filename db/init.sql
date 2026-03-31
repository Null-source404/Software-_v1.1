-- Run this in your MySQL client to create the required table:
CREATE DATABASE url_shortener;
USE url_shortener;

CREATE TABLE urls (
  id INT PRIMARY KEY AUTO_INCREMENT,
  short_code VARCHAR(16) NOT NULL UNIQUE,
  original_url TEXT NOT NULL,
  created_at DATETIME NOT NULL,
  click_count INT NOT NULL DEFAULT 0
);
