import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  UseGuards,
  Request,
  Query,
} from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../auth/jwt.guard';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  getAllNotifications(@Request() req, @Query('limit') limit?: string) {
    const limitNum = limit ? parseInt(limit, 10) : 100;
    return this.notificationsService.getAllNotifications(req.user.sub, limitNum);
  }

  @Get('unread')
  getUnreadNotifications(@Request() req) {
    return this.notificationsService.getUnreadNotifications(req.user.sub);
  }

  @Get('unread/count')
  getUnreadCount(@Request() req) {
    return this.notificationsService.getUnreadCount(req.user.sub);
  }

  @Post(':id/read')
  markAsRead(@Param('id') id: string, @Request() req) {
    return this.notificationsService.markAsRead(id, req.user.sub);
  }

  @Post('read-all')
  markAllAsRead(@Request() req) {
    return this.notificationsService.markAllAsRead(req.user.sub);
  }

  @Delete(':id')
  deleteNotification(@Param('id') id: string, @Request() req) {
    return this.notificationsService.deleteNotification(id, req.user.sub);
  }
}
