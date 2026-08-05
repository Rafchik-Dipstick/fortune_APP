import express, { type Express } from 'express';

/**
 * Creates an isolated HTTP application without opening a network listener.
 *
 * Keeping construction side-effect free lets tests exercise the complete
 * middleware and routing stack without owning process-level resources.
 */
export const createApiApp = (): Express => express();
