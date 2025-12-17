import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Notification } from './notification.schema';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectModel(Notification.name) private notificationModel: Model<Notification>,
  ) {}

  async createNotification(data: {
    userId: string | Types.ObjectId;
    type: string;
    title: string;
    message: string;
    meetingId?: string | Types.ObjectId;
    metadata?: any;
    priority?: string;
  }): Promise<Notification> {
    const notification = new this.notificationModel({
      ...data,
      isRead: false,
    });

    return notification.save();
  }

  async createMeetingScheduledNotifications(
    meetingId: string | Types.ObjectId,
    meetingData: {
      title: string;
      roomId: string;
      scheduledDate: Date;
      startTime: string;
      endTime: string;
      createdBy: Types.ObjectId;
    },
    participantIds: Types.ObjectId[],
  ): Promise<Notification[]> {
    const notifications: Notification[] = [];

    for (const participantId of participantIds) {
      // Create notification for all participants including the creator
      // The creator should also get a confirmation notification
      const isCreator = participantId.toString() === meetingData.createdBy.toString();

      const notification = await this.createNotification({
        userId: participantId,
        type: 'meeting_scheduled',
        title: isCreator ? 'Meeting Created Successfully' : 'New Meeting Scheduled',
        message: isCreator
          ? `Your meeting "${meetingData.title}" has been scheduled for ${new Date(meetingData.scheduledDate).toLocaleDateString()} at ${meetingData.startTime}`
          : `You have been invited to "${meetingData.title}" on ${new Date(meetingData.scheduledDate).toLocaleDateString()} at ${meetingData.startTime}`,
        meetingId,
        metadata: {
          meetingTitle: meetingData.title,
          meetingRoomId: meetingData.roomId,
          scheduledDate: meetingData.scheduledDate,
          startTime: meetingData.startTime,
          endTime: meetingData.endTime,
          createdBy: meetingData.createdBy,
          actionUrl: `/meeting-room/${meetingData.roomId}`,
        },
        priority: 'info',
      });

      notifications.push(notification);
    }

    return notifications;
  }

  async createMeetingStartedNotifications(
    meetingId: string | Types.ObjectId,
    meetingData: {
      title: string;
      roomId: string;
    },
    participantIds: Types.ObjectId[],
  ): Promise<Notification[]> {
    const notifications: Notification[] = [];

    for (const participantId of participantIds) {
      const notification = await this.createNotification({
        userId: participantId,
        type: 'meeting_started',
        title: 'Meeting Started',
        message: `"${meetingData.title}" has started. Join now!`,
        meetingId,
        metadata: {
          meetingTitle: meetingData.title,
          meetingRoomId: meetingData.roomId,
          actionUrl: `/meeting-room/${meetingData.roomId}`,
        },
        priority: 'warning',
      });

      notifications.push(notification);
    }

    return notifications;
  }

  async createMeetingEndedNotification(
    meetingId: string | Types.ObjectId,
    meetingData: {
      title: string;
      duration: number;
      tasksCompleted: number;
      tasksCreated: number;
    },
    participantIds: Types.ObjectId[],
  ): Promise<Notification[]> {
    const notifications: Notification[] = [];

    for (const participantId of participantIds) {
      const notification = await this.createNotification({
        userId: participantId,
        type: 'meeting_ended',
        title: 'Meeting Ended',
        message: `"${meetingData.title}" has ended. Duration: ${meetingData.duration} min. Tasks completed: ${meetingData.tasksCompleted}, Tasks created: ${meetingData.tasksCreated}`,
        meetingId,
        metadata: {
          meetingTitle: meetingData.title,
          duration: meetingData.duration,
          tasksCompleted: meetingData.tasksCompleted,
          tasksCreated: meetingData.tasksCreated,
          actionUrl: `/meetings`,
        },
        priority: 'success',
      });

      notifications.push(notification);
    }

    return notifications;
  }

  async getUnreadNotifications(userId: string): Promise<Notification[]> {
    return this.notificationModel
      .find({
        userId,
        isRead: false,
      })
      .populate('meetingId')
      .sort({ createdAt: -1 })
      .limit(50)
      .exec();
  }

  async getAllNotifications(userId: string, limit: number = 100): Promise<Notification[]> {
    return this.notificationModel
      .find({ userId })
      .populate('meetingId')
      .sort({ createdAt: -1 })
      .limit(limit)
      .exec();
  }

  async markAsRead(notificationId: string, userId: string): Promise<Notification> {
    const notification = await this.notificationModel.findOne({
      _id: notificationId,
      userId,
    });

    if (!notification) {
      throw new Error('Notification not found');
    }

    notification.isRead = true;
    notification.readAt = new Date();

    return notification.save();
  }

  async markAllAsRead(userId: string): Promise<number> {
    const result = await this.notificationModel.updateMany(
      { userId, isRead: false },
      { isRead: true, readAt: new Date() },
    );

    return result.modifiedCount;
  }

  async getUnreadCount(userId: string): Promise<number> {
    return this.notificationModel.countDocuments({
      userId,
      isRead: false,
    });
  }

  async deleteNotification(notificationId: string, userId: string): Promise<void> {
    await this.notificationModel.deleteOne({
      _id: notificationId,
      userId,
    });
  }
}
