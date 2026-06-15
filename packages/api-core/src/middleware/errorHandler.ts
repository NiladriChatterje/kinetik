import { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ERROR_CODES } from '@kinetik/shared';

interface AppError extends Error {
  statusCode?: number;
  code?: string;
  details?: unknown;
}

export function errorHandler(
  error: FastifyError | AppError,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const statusCode = (error as AppError).statusCode || error.statusCode || 500;
  const code = (error as AppError).code || 'INTERNAL_ERROR';
  const message = error.message || 'An unexpected error occurred';

  // Log server errors
  if (statusCode >= 500) {
    console.error(`[ERROR] ${statusCode} - ${message}`, error.stack);
  }

  // Rate limit errors
  if (statusCode === 429) {
    return reply.status(429).send({
      success: false,
      error: {
        code: ERROR_CODES.RATE_LIMITED,
        message: 'Too many requests. Please try again later.',
      },
    });
  }

  // Validation errors
  if (error.validation) {
    return reply.status(400).send({
      success: false,
      error: {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'Validation failed',
        details: error.validation,
      },
    });
  }

  reply.status(statusCode).send({
    success: false,
    error: {
      code,
      message,
      details: (error as AppError).details,
    },
  });
}
