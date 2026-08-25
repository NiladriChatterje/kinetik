import { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ERROR_CODES } from '@kinetik/shared';

interface AppError extends Error {
  statusCode?: number;
  code?: string;
  details?: unknown;
}

export function errorHandler(
  error: FastifyError | AppError,
  _request: FastifyRequest,
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

  // Validation errors (FastifyError only — AppError has no validation field)
  const validation = (error as FastifyError).validation;
  if (validation) {
    return reply.status(400).send({
      success: false,
      error: {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'Validation failed',
        details: validation,
      },
    });
  }

  // Internal errors are logged above with the full stack for developers —
  // users must never see infrastructure details (Redis states, SQL, etc.)
  reply.status(statusCode).send({
    success: false,
    error: {
      code,
      message: statusCode >= 500 ? 'Something went wrong! Please try connecting again.' : message,
      details: statusCode >= 500 ? undefined : (error as AppError).details,
    },
  });
  return undefined;
}
