declare global {
  namespace Express {
    interface Request {
      authentication: import('../middleware/authentication.js').AuthenticationContext;
      requestId: string;
    }
  }
}

export {};
