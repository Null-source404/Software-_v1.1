// Global error handling middleware
const errorHandler = (err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  if (process.env.NODE_ENV !== 'test' && statusCode >= 500) {
    console.error('Error:', err);
  }

  res.status(statusCode).json({
    error: message,
    status: statusCode,
    ...(err.safetyStatus && { safetyStatus: err.safetyStatus }),
    ...(err.safetyCategory && { safetyCategory: err.safetyCategory }),
    ...(err.reasons && { reasons: err.reasons }),
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};

module.exports = errorHandler;
