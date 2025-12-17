import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Meeting } from './meeting.schema';
import { CreateMeetingDto } from './dto/create-meeting.dto';
import { UpdateMeetingDto } from './dto/update-meeting.dto';
import { NotificationsService } from './notifications.service';
import * as crypto from 'crypto';


@Injectable()
export class MeetingsService {
  constructor(
    @InjectModel(Meeting.name) private meetingModel: Model<Meeting>,
    private notificationsService: NotificationsService,
  ) {}


  private generateRoomId(): string {
    // Generate a URL-safe random string
    return crypto.randomBytes(9).toString('base64url').slice(0, 12);
  }


  async create(createMeetingDto: CreateMeetingDto, userId: string): Promise<Meeting> {
    const roomId = this.generateRoomId(); // Generate unique room ID


    const meeting = new this.meetingModel({
      ...createMeetingDto,
      roomId,
      createdBy: userId,
      participants: createMeetingDto.participants || [userId],
      settings: {
        requiresAuth: createMeetingDto.requiresAuth ?? false,
        maxParticipants: createMeetingDto.maxParticipants ?? 50,
        recordingEnabled: createMeetingDto.recordingEnabled ?? false,
      },
    });


    const savedMeeting = await meeting.save();


    // Create notifications for all participants
    const populatedMeeting = await this.meetingModel
      .findById(savedMeeting._id)
      .populate('createdBy participants')
      .exec();


    if (populatedMeeting && populatedMeeting.participants.length > 0) {
      await this.notificationsService.createMeetingScheduledNotifications(
        savedMeeting._id as Types.ObjectId,
        {
          title: savedMeeting.title,
          roomId: savedMeeting.roomId,
          scheduledDate: savedMeeting.scheduledDate,
          startTime: savedMeeting.startTime,
          endTime: savedMeeting.endTime,
          createdBy: savedMeeting.createdBy as Types.ObjectId,
        },
        populatedMeeting.participants.map((p: any) => p._id),
      );
    }


    return savedMeeting;
  }


  async findAll(userId: string): Promise<Meeting[]> {
    return this.meetingModel
      .find({
        $or: [
          { createdBy: userId },
          { participants: userId },
        ],
      })
      .populate('createdBy', 'name email')
      .populate('participants', 'name email')
      .populate('relatedTasks', 'title status dueDate')
      .populate('relatedProjects', 'name status')
      .sort({ scheduledDate: -1 })
      .exec();
  }


  async findOne(id: string): Promise<Meeting> {
    const meeting = await this.meetingModel
      .findById(id)
      .populate('createdBy', 'name email')
      .populate('participants', 'name email')
      .populate('relatedTasks', 'title status dueDate')
      .populate('relatedProjects', 'name status')
      .exec();


    if (!meeting) {
      throw new NotFoundException('Meeting not found');
    }


    return meeting;
  }


  async findByRoomId(roomId: string): Promise<Meeting> {
    const meeting = await this.meetingModel
      .findOne({ roomId })
      .populate('createdBy', 'name email')
      .populate('participants', 'name email')
      .populate('relatedTasks', 'title status dueDate')
      .populate('relatedProjects', 'name status')
      .exec();


    if (!meeting) {
      throw new NotFoundException('Meeting not found');
    }


    return meeting;
  }


  async update(id: string, updateMeetingDto: UpdateMeetingDto, userId: string): Promise<Meeting> {
    const meeting = await this.meetingModel.findById(id);


    if (!meeting) {
      throw new NotFoundException('Meeting not found');
    }


    if (meeting.createdBy.toString() !== userId) {
      throw new ForbiddenException('You can only update meetings you created');
    }


    Object.assign(meeting, updateMeetingDto);
    return meeting.save();
  }


  async delete(id: string, userId: string): Promise<void> {
    const meeting = await this.meetingModel.findById(id);


    if (!meeting) {
      throw new NotFoundException('Meeting not found');
    }


    if (meeting.createdBy.toString() !== userId) {
      throw new ForbiddenException('You can only delete meetings you created');
    }


    await meeting.deleteOne();
  }


  async joinMeeting(roomId: string, userId: string): Promise<Meeting> {
    const meeting = await this.meetingModel.findOne({ roomId });


    if (!meeting) {
      throw new NotFoundException('Meeting not found');
    }


    // Add user to participants if not already there
    if (!meeting.participants.includes(userId as any)) {
      meeting.participants.push(userId as any);
      await meeting.save();
    }


    // Update status to ongoing if it's scheduled
    if (meeting.status === 'scheduled') {
      meeting.status = 'ongoing';
      await meeting.save();
    }


    const updatedMeeting = await this.meetingModel
      .findById(meeting._id)
      .populate('createdBy', 'name email')
      .populate('participants', 'name email')
      .populate('relatedTasks', 'title status dueDate')
      .populate('relatedProjects', 'name status')
      .exec();


    if (!updatedMeeting) {
      throw new NotFoundException('Meeting not found after update');
    }


    return updatedMeeting;
  }


  async getUpcoming(userId: string, days: number = 7): Promise<Meeting[]> {
    const now = new Date();
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + days);


    return this.meetingModel
      .find({
        $or: [
          { createdBy: userId },
          { participants: userId },
        ],
        scheduledDate: {
          $gte: now,
          $lte: futureDate,
        },
        status: { $in: ['scheduled', 'ongoing'] },
      })
      .populate('createdBy', 'name email')
      .populate('participants', 'name email')
      .populate('relatedTasks', 'title status dueDate')
      .populate('relatedProjects', 'name status')
      .sort({ scheduledDate: 1 })
      .exec();
  }


  async startMeeting(meetingId: string, userId: string): Promise<Meeting> {
    const meeting = await this.meetingModel.findById(meetingId);


    if (!meeting) {
      throw new NotFoundException('Meeting not found');
    }


    meeting.status = 'ongoing';
    meeting.actualStartTime = new Date();


    await meeting.save();


    // Notify all participants that meeting has started
    const populatedMeeting = await this.meetingModel
      .findById(meetingId)
      .populate('participants')
      .exec();


    if (populatedMeeting) {
      await this.notificationsService.createMeetingStartedNotifications(
        meetingId,
        {
          title: meeting.title,
          roomId: meeting.roomId,
        },
        populatedMeeting.participants.map((p: any) => p._id),
      );
    }


    return meeting;
  }


  async completeMeeting(
    meetingId: string,
    transcriptData: {
      tasksCompleted?: Array<{
        taskId?: string;
        title: string;
        description?: string;
      }>;
      tasksCreated?: Array<{
        taskId?: string;
        title: string;
        description?: string;
        assignedTo?: string[];
      }>;
      notes?: string;
      summary?: string;
      attendees?: Array<{
        userId: string;
        joinedAt: Date;
        leftAt?: Date;
      }>;
    },
  ): Promise<Meeting> {
    const meeting = await this.meetingModel.findById(meetingId).populate('participants');


    if (!meeting) {
      throw new NotFoundException('Meeting not found');
    }


    const endTime = new Date();
    const startTime = meeting.actualStartTime || new Date(meeting.scheduledDate);
    const durationInMinutes = Math.round((endTime.getTime() - startTime.getTime()) / (1000 * 60));


    // Process attendees with duration calculations
    const processedAttendees = (transcriptData.attendees || []).map(attendee => {
      const joinTime = new Date(attendee.joinedAt);
      const leaveTime = attendee.leftAt ? new Date(attendee.leftAt) : endTime;
      const attendeeDuration = Math.round((leaveTime.getTime() - joinTime.getTime()) / (1000 * 60));


      return {
        userId: new Types.ObjectId(attendee.userId),
        joinedAt: joinTime,
        leftAt: leaveTime,
        duration: attendeeDuration,
      };
    });


    meeting.status = 'completed';
    meeting.actualEndTime = endTime;
    meeting.transcript = {
      duration: durationInMinutes,
      tasksCompleted: (transcriptData.tasksCompleted || []).map(task => ({
        taskId: task.taskId ? new Types.ObjectId(task.taskId) : undefined,
        title: task.title,
        description: task.description,
        completedAt: new Date(),
      })),
      tasksCreated: (transcriptData.tasksCreated || []).map(task => ({
        taskId: task.taskId ? new Types.ObjectId(task.taskId) : undefined,
        title: task.title,
        description: task.description,
        assignedTo: task.assignedTo?.map(id => new Types.ObjectId(id)),
        createdAt: new Date(),
      })),
      notes: transcriptData.notes || '',
      summary: transcriptData.summary || '',
      attendees: processedAttendees,
    };


    await meeting.save();


    // Notify all participants that meeting has ended with transcript info
    await this.notificationsService.createMeetingEndedNotification(
      meetingId,
      {
        title: meeting.title,
        duration: durationInMinutes,
        tasksCompleted: meeting.transcript.tasksCompleted.length,
        tasksCreated: meeting.transcript.tasksCreated.length,
      },
      (meeting.participants as any[]).map((p: any) => p._id),
    );


    return meeting;
  }


  async getMeetingTranscript(meetingId: string, userId: string): Promise<any> {
    const meeting = await this.meetingModel
      .findById(meetingId)
      .populate('createdBy participants')
      .populate('transcript.attendees.userId', 'name email')
      .populate('transcript.tasksCompleted.taskId')
      .populate('transcript.tasksCreated.taskId')
      .exec();


    if (!meeting) {
      throw new NotFoundException('Meeting not found');
    }


    // Check if user is a participant
    const isParticipant = (meeting.participants as any[]).some(
      (p: any) => p._id.toString() === userId,
    );


    if (!isParticipant && meeting.createdBy.toString() !== userId) {
      throw new ForbiddenException('You can only view transcripts of meetings you participated in');
    }


    if (!meeting.transcript) {
      throw new NotFoundException('Meeting transcript not available');
    }


    return {
      meeting: {
        id: meeting._id,
        title: meeting.title,
        scheduledDate: meeting.scheduledDate,
        startTime: meeting.startTime,
        endTime: meeting.endTime,
        actualStartTime: meeting.actualStartTime,
        actualEndTime: meeting.actualEndTime,
      },
      transcript: meeting.transcript,
    };
  }
}
