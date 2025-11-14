import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { RefreshToken, RefreshTokenDocument } from '../schemas/refresh-token.schema';
import * as crypto from 'crypto';

@Injectable()
export class RefreshTokenService {
  constructor(
    @InjectModel(RefreshToken.name) private refreshTokenModel: Model<RefreshTokenDocument>,
  ) {}

  async createRefreshToken(
    userId: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<{ token: string; expiresAt: Date }> {
    const token = crypto.randomBytes(64).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30); // 30 days

    await this.refreshTokenModel.create({
      userId,
      token,
      expiresAt,
      ipAddress,
      userAgent,
    });

    return { token, expiresAt };
  }

  async validateRefreshToken(token: string): Promise<RefreshTokenDocument | null> {
    // First, try to find a non-revoked token
    let refreshToken = await this.refreshTokenModel.findOne({
      token,
      isRevoked: false,
      expiresAt: { $gt: new Date() },
    });

    // If not found, check if token was recently revoked (5 second grace period)
    // This prevents refresh loops during OAuth redirects and page transitions
    if (!refreshToken) {
      const fiveSecondsAgo = new Date(Date.now() - 5000);
      refreshToken = await this.refreshTokenModel.findOne({
        token,
        isRevoked: true,
        revokedAt: { $gte: fiveSecondsAgo },
        expiresAt: { $gt: new Date() },
      });

      // If we're using a recently-revoked token, log it (might indicate race condition)
      if (refreshToken) {
        console.warn(`⚠️ Using recently-revoked token within grace period for user ${refreshToken.userId}`);
      }
    }

    if (refreshToken) {
      // Update last used timestamp
      refreshToken.lastUsedAt = new Date();
      await refreshToken.save();
    }

    return refreshToken;
  }

  async revokeToken(token: string): Promise<void> {
    await this.refreshTokenModel.updateOne(
      { token },
      { isRevoked: true, revokedAt: new Date() },
    );
  }

  async revokeAllUserTokens(userId: string): Promise<void> {
    await this.refreshTokenModel.updateMany(
      { userId, isRevoked: false },
      { isRevoked: true, revokedAt: new Date() },
    );
  }

  async getUserActiveTokens(userId: string): Promise<RefreshTokenDocument[]> {
    return this.refreshTokenModel.find({
      userId,
      isRevoked: false,
      expiresAt: { $gt: new Date() },
    }).sort({ createdAt: -1 }).exec();
  }

  async cleanupExpiredTokens(): Promise<void> {
    // MongoDB TTL index will handle this, but we can manually clean up too
    await this.refreshTokenModel.deleteMany({
      expiresAt: { $lt: new Date() },
    });
  }
}
