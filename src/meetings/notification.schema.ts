import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: true })
export class Notification extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ required: true, enum: ['meeting_scheduled', 'meeting_started', 'meeting_ended', 'meeting_cancelled', 'meeting_updated', 'meeting_reminder'] })
  type: string;

  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  message: string;

  @Prop({ type: Types.ObjectId, ref: 'Meeting' })
  meetingId: Types.ObjectId;

  @Prop({ type: Object })
  metadata: {
    meetingTitle?: string;
    meetingRoomId?: string;
    scheduledDate?: Date;
    startTime?: string;
    endTime?: string;
    createdBy?: Types.ObjectId;
    actionUrl?: string;
  };

  @Prop({ default: false })
  isRead: boolean;

  @Prop()
  readAt: Date;

  @Prop({ default: 'info', enum: ['info', 'success', 'warning', 'error'] })
  priority: string;
}

export const NotificationSchema = SchemaFactory.createForClass(Notification);

// Indexes for efficient queries
NotificationSchema.index({ userId: 1, isRead: 1 });
NotificationSchema.index({ userId: 1, createdAt: -1 });
NotificationSchema.index({ meetingId: 1 });
