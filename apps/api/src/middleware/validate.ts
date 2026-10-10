import type { NextFunction, Request, Response } from 'express';
import type { ZodTypeAny } from 'zod';

/** RS-11 : validation stricte des entrées sur chaque route publique. */
export function validateBody(schema: ZodTypeAny) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ error: 'Requête invalide', details: result.error.flatten() });
    }
    req.body = result.data;
    next();
  };
}
