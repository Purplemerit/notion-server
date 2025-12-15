import {
  WebSocketGateway,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger} from '@nestjs/common';

interface CollaboratorInfo {
  id: string;
  name: string;
  email: string;
  avatar?: string;
  color: string;
}

interface WhiteboardRoom {
  roomId: string;
  collaborators: Map<string, CollaboratorInfo>;
  currentState: any;
}

@WebSocketGateway({
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3001',
    credentials: true,
  },
})
export class WhiteboardGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(WhiteboardGateway.name);
  private rooms: Map<string, WhiteboardRoom> = new Map();
  private userRooms: Map<string, string> = new Map(); // socket.id -> roomId

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
    const roomId = this.userRooms.get(client.id);

    if (roomId) {
      this.handleLeaveWhiteboard(client, roomId);
    }
  }

  @SubscribeMessage('join-whiteboard')
  handleJoinWhiteboard(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string; user: CollaboratorInfo },
  ) {
    const { roomId, user } = data;

    // Generate random color for user if not provided
    if (!user.color) {
      const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E2'];
      user.color = colors[Math.floor(Math.random() * colors.length)];
    }

    // Create room if it doesn't exist
    if (!this.rooms.has(roomId)) {
      this.rooms.set(roomId, {
        roomId,
        collaborators: new Map(),
        currentState: null,
      });
    }

    const room = this.rooms.get(roomId);

    // This should never happen since we just created the room if it didn't exist
    if (!room) {
      this.logger.error(`Room ${roomId} not found after creation`);
      return;
    }

    // Add user to room
    room.collaborators.set(client.id, user);
    this.userRooms.set(client.id, roomId);

    // Join socket.io room
    client.join(roomId);

    // Notify others in the room
    client.to(roomId).emit('user-joined', user);

    // Send current collaborators list to the joining user
    const collaboratorsList = Array.from(room.collaborators.values());
    client.emit('collaborators-list', collaboratorsList);

    // Send current whiteboard state if available
    if (room.currentState) {
      client.emit('whiteboard-update', room.currentState);
    }

    this.logger.log(`User ${user.name} joined room ${roomId}. Total collaborators: ${room.collaborators.size}`);
  }

  @SubscribeMessage('leave-whiteboard')
  handleLeaveWhiteboard(
    @ConnectedSocket() client: Socket,
    @MessageBody() roomId?: string,
  ) {
    const actualRoomId = roomId || this.userRooms.get(client.id);

    if (!actualRoomId) return;

    const room = this.rooms.get(actualRoomId);

    if (room) {
      const user = room.collaborators.get(client.id);

      // Remove user from room
      room.collaborators.delete(client.id);
      this.userRooms.delete(client.id);

      // Leave socket.io room
      client.leave(actualRoomId);

      // Notify others
      if (user) {
        client.to(actualRoomId).emit('user-left', user.id);
        this.logger.log(`User ${user.name} left room ${actualRoomId}. Remaining: ${room.collaborators.size}`);
      }

      // Clean up empty rooms
      if (room.collaborators.size === 0) {
        this.rooms.delete(actualRoomId);
        this.logger.log(`Room ${actualRoomId} deleted (empty)`);
      }
    }
  }

  @SubscribeMessage('whiteboard-change')
  handleWhiteboardChange(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string; elements: any[]; appState: any },
  ) {
    const { roomId, elements, appState } = data;
    const room = this.rooms.get(roomId);

    if (!room) {
      this.logger.warn(`Room ${roomId} not found for whiteboard change`);
      return;
    }

    // Update room state
    room.currentState = { elements, appState };

    // Broadcast to all other users in the room
    client.to(roomId).emit('whiteboard-update', { elements, appState });
  }

  @SubscribeMessage('cursor-move')
  handleCursorMove(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string; x: number; y: number },
  ) {
    const { roomId, x, y } = data;
    const room = this.rooms.get(roomId);

    if (!room) return;

    const user = room.collaborators.get(client.id);

    if (user) {
      // Broadcast cursor position to others
      client.to(roomId).emit('cursor-update', {
        userId: user.id,
        userName: user.name,
        color: user.color,
        x,
        y,
      });
    }
  }

  // Get room statistics (for monitoring/debugging)
  getRoomStats() {
    const stats = Array.from(this.rooms.values()).map(room => ({
      roomId: room.roomId,
      collaboratorCount: room.collaborators.size,
      collaborators: Array.from(room.collaborators.values()).map(c => ({
        name: c.name,
        email: c.email,
      })),
    }));

    return {
      totalRooms: this.rooms.size,
      totalConnections: this.userRooms.size,
      rooms: stats,
    };
  }
}
