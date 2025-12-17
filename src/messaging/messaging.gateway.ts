import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { MessagingService } from './messaging.service';
import { UseGuards } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

@WebSocketGateway({
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3001',
    credentials: true,
  },
  namespace: '/messaging',
})
export class MessagingGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  // Store user ID to socket ID mapping
  private userSockets = new Map<string, string>();

  constructor(
    private readonly messagingService: MessagingService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  private extractTokenFromCookies(cookieHeader: string | undefined): string | null {
    if (!cookieHeader) return null;

    const cookies = cookieHeader.split(';').reduce((acc, cookie) => {
      const [key, value] = cookie.trim().split('=');
      acc[key] = value;
      return acc;
    }, {} as Record<string, string>);

    return cookies['accessToken'] || null;
  }

  async handleConnection(client: Socket) {
    // Try to get token from cookies first (HTTP-only cookie auth)
    const cookieHeader = client.handshake.headers.cookie;
    let token = this.extractTokenFromCookies(cookieHeader);

    // Fallback to query parameter for backwards compatibility
    if (!token) {
      const queryToken = client.handshake.query.token;
      token = Array.isArray(queryToken)
        ? queryToken[0]
        : (queryToken || null);
    }

    if (!token) {
      console.error('Messaging auth failed: Token is required');
      client.emit('error', {
        message: 'Authentication required',
        code: 'AUTH_TOKEN_REQUIRED',
        requiresLogin: true
      });
      setTimeout(() => client.disconnect(), 100);
      return;
    }

    try {
      const decoded = this.jwtService.verify(token, {
        secret: this.configService.get<string>('JWT_SECRET'),
      });

      const userId = decoded.sub;
      const email = decoded.email;

      if (!userId) {
        console.error('Messaging auth failed: Invalid token');
        client.emit('error', {
          message: 'Invalid token',
          code: 'AUTH_INVALID_TOKEN',
          requiresLogin: true
        });
        setTimeout(() => client.disconnect(), 100);
        return;
      }

      // Store authenticated user info
      this.userSockets.set(userId, client.id);
      (client as any).userId = userId;
      (client as any).email = email;


      // Join user to their personal room
      client.join(`user:${userId}`);
    } catch (error) {
      console.error('Messaging auth failed', error);
      client.emit('error', {
        message: 'Invalid or expired token',
        code: 'AUTH_TOKEN_EXPIRED',
        requiresLogin: true
      });
      setTimeout(() => client.disconnect(), 100);
    }
  }

  handleDisconnect(client: Socket) {

    // Remove user from mapping
    const userId = client.handshake.auth?.userId;
    if (userId) {
      this.userSockets.delete(userId);
    }
  }

  /**
   * Handle sending a message
   */
  @SubscribeMessage('sendMessage')
  async handleSendMessage(
    @MessageBody() data: {
      senderEmail: string;
      receiverId: string;
      content: string;
      messageType?: string;
      fileUrl?: string;
      fileName?: string;
    },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      // Save message to database
      const message = await this.messagingService.sendMessage(data.senderEmail, {
        receiverId: data.receiverId,
        content: data.content,
        messageType: data.messageType,
        fileUrl: data.fileUrl,
        fileName: data.fileName,
      });

      // Emit to receiver if they're online
      const receiverSocketId = this.userSockets.get(data.receiverId);
      if (receiverSocketId) {
        this.server.to(receiverSocketId).emit('newMessage', message);

        // Get updated unread count for receiver
        const unreadCount = await this.messagingService.getUnreadCount(
          // Need to convert receiverId to email - we'll use the receiver's email from the populated message
          (message.receiverId as any).email || data.receiverId
        );

        // Emit unread count update to receiver
        this.server.to(receiverSocketId).emit('unreadCountUpdate', unreadCount);
      }

      // Emit back to sender for confirmation
      client.emit('messageSent', message);

      return { success: true, message };
    } catch (error) {
      client.emit('messageError', { error: error.message });
      return { success: false, error: error.message };
    }
  }

  /**
   * Handle typing indicator
   */
  @SubscribeMessage('typing')
  handleTyping(
    @MessageBody() data: { senderId: string; receiverId: string; isTyping: boolean },
    @ConnectedSocket() client: Socket,
  ) {
    const receiverSocketId = this.userSockets.get(data.receiverId);
    if (receiverSocketId) {
      this.server.to(receiverSocketId).emit('userTyping', {
        userId: data.senderId,
        isTyping: data.isTyping,
      });
    }
  }

  /**
   * Handle mark as read
   */
  @SubscribeMessage('markAsRead')
  async handleMarkAsRead(
    @MessageBody() data: { userEmail: string; messageId: string },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      await this.messagingService.markAsRead(data.userEmail, data.messageId);

      // Notify the sender that message was read
      const message = await this.messagingService['messageModel'].findById(data.messageId).populate('senderId');

      if (message && message.senderId) {
        const senderSocketId = this.userSockets.get(message.senderId._id.toString());

        if (senderSocketId) {
          this.server.to(senderSocketId).emit('messageRead', {
            messageId: data.messageId,
            readAt: new Date(),
          });
        }
      }

      // Get updated unread count for the user who marked as read
      const unreadCount = await this.messagingService.getUnreadCount(data.userEmail);

      // Emit unread count update to the user
      client.emit('unreadCountUpdate', unreadCount);

      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Handle mark conversation as read
   */
  @SubscribeMessage('markConversationAsRead')
  async handleMarkConversationAsRead(
    @MessageBody() data: { userEmail: string; otherUserId: string },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      await this.messagingService.markConversationAsRead(data.userEmail, data.otherUserId);

      // Get updated unread count for the user
      const unreadCount = await this.messagingService.getUnreadCount(data.userEmail);

      // Emit unread count update to the user
      client.emit('unreadCountUpdate', unreadCount);

      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Notify user about new message (can be called from service)
   */
  notifyNewMessage(userId: string, message: any) {
    const socketId = this.userSockets.get(userId);
    if (socketId) {
      this.server.to(socketId).emit('newMessage', message);
    }
  }

  /**
   * Get online status of a user
   */
  @SubscribeMessage('checkOnlineStatus')
  handleCheckOnlineStatus(
    @MessageBody() data: { userId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const isOnline = this.userSockets.has(data.userId);
    client.emit('onlineStatus', { userId: data.userId, isOnline });
    return { isOnline };
  }

  /**
   * Broadcast online status to all connected users
   */
  broadcastOnlineStatus(userId: string, isOnline: boolean) {
    this.server.emit('userOnlineStatusChanged', { userId, isOnline });
  }
}
