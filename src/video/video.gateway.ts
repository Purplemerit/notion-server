import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

interface RoomParticipant {
  socketId: string;
  userId?: string;
  joinedAt: Date;
}

@WebSocketGateway({
  namespace: '/video',
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3001',
    credentials: true,
  }
})
export class VideoGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  // Track participants in each room
  private rooms: Map<string, RoomParticipant[]> = new Map();

  constructor(
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

    // Optional auth: If token provided, verify it. If not, allow anonymous connection.
    if (token) {
      try {
        const decoded = this.jwtService.verify(token, {
          secret: this.configService.get<string>('JWT_SECRET'),
        });

        // Store user info in socket for later use
        (client as any).userId = decoded.sub;
        (client as any).email = decoded.email;
        (client as any).isAuthenticated = true;

        if (process.env.NODE_ENV === 'development') {
          console.log(`✅ Video socket authenticated: ${decoded.email}`);
        }
      } catch (error) {
        // Token provided but invalid - log warning but allow connection
        if (process.env.NODE_ENV === 'development') {
          console.warn('⚠️ Video auth failed, allowing anonymous connection:', error.message);
        }
        (client as any).isAuthenticated = false;
      }
    } else {
      // No token provided - allow anonymous connection
      if (process.env.NODE_ENV === 'development') {
        console.log('ℹ️ Video socket connected anonymously');
      }
      (client as any).isAuthenticated = false;
    }
  }

  handleDisconnect(client: Socket) {

    // Remove client from all rooms
    this.rooms.forEach((participants, roomName) => {
      const index = participants.findIndex(p => p.socketId === client.id);
      if (index !== -1) {
        participants.splice(index, 1);

        // Notify other participants that someone left
        client.to(roomName).emit('user_left', { userId: client.id });

      }
    });
  }

  @SubscribeMessage('join_room')
  joinRoom(
    @MessageBody() data: { roomName: string; userId?: string },
    @ConnectedSocket() socket: Socket
  ) {
    const { roomName, userId } = data;
    socket.join(roomName);

    // Get or create room participants list
    if (!this.rooms.has(roomName)) {
      this.rooms.set(roomName, []);
    }

    const participants = this.rooms.get(roomName)!; // Non-null assertion since we just set it

    // Add new participant
    const newParticipant: RoomParticipant = {
      socketId: socket.id,
      userId,
      joinedAt: new Date(),
    };
    participants.push(newParticipant);


    // Send existing participants to the new user
    const existingParticipants = participants
      .filter(p => p.socketId !== socket.id)
      .map(p => ({ socketId: p.socketId, userId: p.userId }));

    socket.emit('existing_participants', { participants: existingParticipants });

    // Notify existing participants about the new user
    socket.to(roomName).emit('user_joined', {
      socketId: socket.id,
      userId: userId
    });
  }

  @SubscribeMessage('send_connection_offer')
  handleOffer(
    @MessageBody() data: {
      offer: RTCSessionDescriptionInit;
      roomName: string;
      targetSocketId: string; // Specific target for this offer
    },
    @ConnectedSocket() socket: Socket,
  ) {

    // Send offer to specific participant
    this.server.to(data.targetSocketId).emit('connection_offer', {
      offer: data.offer,
      senderSocketId: socket.id
    });
  }

  @SubscribeMessage('send_answer')
  handleAnswer(
    @MessageBody() data: {
      answer: RTCSessionDescriptionInit;
      roomName: string;
      targetSocketId: string; // Specific target for this answer
    },
    @ConnectedSocket() socket: Socket,
  ) {

    // Send answer to specific participant
    this.server.to(data.targetSocketId).emit('answer', {
      answer: data.answer,
      senderSocketId: socket.id
    });
  }

  @SubscribeMessage('send_candidate')
  handleCandidate(
    @MessageBody() data: {
      candidate: RTCIceCandidate;
      roomName: string;
      targetSocketId: string; // Specific target for this ICE candidate
    },
    @ConnectedSocket() socket: Socket,
  ) {

    // Send ICE candidate to specific participant
    this.server.to(data.targetSocketId).emit('candidate', {
      candidate: data.candidate,
      senderSocketId: socket.id
    });
  }

  @SubscribeMessage('leave_room')
  leaveRoom(@MessageBody() roomName: string, @ConnectedSocket() socket: Socket) {
    socket.leave(roomName);

    // Remove from participants list
    const participants = this.rooms.get(roomName);
    if (participants) {
      const index = participants.findIndex(p => p.socketId === socket.id);
      if (index !== -1) {
        participants.splice(index, 1);
      }
    }


    // Notify others that user left
    socket.to(roomName).emit('user_left', { socketId: socket.id });
  }
}
