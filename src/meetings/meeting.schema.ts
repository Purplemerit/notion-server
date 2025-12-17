import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: true })
export class Meeting extends Document {
  @Prop({ required: true })
  title: string;

  @Prop()
  description: string;

  @Prop({ required: true, unique: true })
  roomId: string;

  @Prop({ required: true })
  scheduledDate: Date;

  @Prop({ required: true })
  startTime: string;

  @Prop({ required: true })
  endTime: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdBy: Types.ObjectId;

  @Prop({ type: [{ type: Types.ObjectId, ref: 'User' }] })
  participants: Types.ObjectId[];

  @Prop({ type: [{ type: Types.ObjectId, ref: 'Task' }] })
  relatedTasks: Types.ObjectId[];

  @Prop({ type: [{ type: Types.ObjectId, ref: 'Project' }] })
  relatedProjects: Types.ObjectId[];

  @Prop({ default: 'scheduled', enum: ['scheduled', 'ongoing', 'completed', 'cancelled'] })
  status: string;

  @Prop({ type: Object })
  settings: {
    requiresAuth?: boolean;
    maxParticipants?: number;
    recordingEnabled?: boolean;
  };

  // Meeting tracking
  @Prop()
  actualStartTime: Date;

  @Prop()
  actualEndTime: Date;

  // Meeting transcript/summary
  @Prop({ type: Object })
  transcript: {
    duration: number; // in minutes
    tasksCompleted: Array<{
      taskId?: Types.ObjectId;
      title: string;
      description?: string;
      completedAt: Date;
    }>;
    tasksCreated: Array<{
      taskId?: Types.ObjectId;
      title: string;
      description?: string;
      assignedTo?: Types.ObjectId[];
      createdAt: Date;
    }>;
    notes: string;
    summary: string;
    attendees: Array<{
      userId: Types.ObjectId;
      joinedAt: Date;
      leftAt?: Date;
      duration: number; // in minutes
    }>;
  };
}

export const MeetingSchema = SchemaFactory.createForClass(Meeting);
