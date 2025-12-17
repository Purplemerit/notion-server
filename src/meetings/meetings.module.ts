import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MeetingsController } from './meetings.controller';
import { NotificationsController } from './notifications.controller';
import { MeetingsService } from './meetings.service';
import { NotificationsService } from './notifications.service';
import { Meeting, MeetingSchema } from './meeting.schema';
import { Notification, NotificationSchema } from './notification.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Meeting.name, schema: MeetingSchema },
      { name: Notification.name, schema: NotificationSchema },
    ]),
  ],
  controllers: [MeetingsController, NotificationsController],
  providers: [MeetingsService, NotificationsService],
  exports: [MeetingsService, NotificationsService],
})
export class MeetingsModule {}
