import { z } from 'zod';

export const apiVersionSchema = z.literal('v1');
export const uuidSchema = z.uuid();
export const isoUtcDateTimeSchema = z.iso.datetime({ offset: true });
