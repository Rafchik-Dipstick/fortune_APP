declare global {
  namespace Express {
    interface Request {
      authentication: import('../middleware/authentication.js').AuthenticationContext;
      /** Set only by the deletion-management guard; never a normal session. */
      deletionManagementAuthTime: Date;
      deletionManagementUserId: string;
      requestId: string;
    }
  }
}

export {};
