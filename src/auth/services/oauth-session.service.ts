import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';

interface OAuthSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

@Injectable()
export class OAuthSessionService {
  private sessions = new Map<string, OAuthSession>();

  /**
   * Create a temporary session for OAuth redirect
   * Returns a one-time session code
   */
  createSession(accessToken: string, refreshToken: string): string {
    const sessionCode = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60000); // 1 minute expiry

    this.sessions.set(sessionCode, {
      accessToken,
      refreshToken,
      expiresAt,
    });

    // Auto-cleanup after expiry
    setTimeout(() => {
      this.sessions.delete(sessionCode);
    }, 60000);

    return sessionCode;
  }

  /**
   * Exchange session code for tokens (one-time use)
   */
  consumeSession(sessionCode: string): { accessToken: string; refreshToken: string } | null {
    const session = this.sessions.get(sessionCode);

    if (!session) {
      return null;
    }

    // Check if expired
    if (session.expiresAt < new Date()) {
      this.sessions.delete(sessionCode);
      return null;
    }

    // Delete session after use (one-time)
    this.sessions.delete(sessionCode);

    return {
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
    };
  }

  /**
   * Cleanup expired sessions (can be called periodically)
   */
  cleanupExpiredSessions(): void {
    const now = new Date();
    for (const [code, session] of this.sessions.entries()) {
      if (session.expiresAt < now) {
        this.sessions.delete(code);
      }
    }
  }
}
