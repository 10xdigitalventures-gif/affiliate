import { Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common'
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { NotificationsService } from './notifications.service'
import { JwtPayload } from '../auth/jwt.strategy'

// All routes are scoped to the authenticated user; no extra permission is required
// because a user may always read and manage their own notifications.
@ApiTags('notifications')
@ApiBearerAuth('jwt')
@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(
    @Req() req: { user: JwtPayload },
    @Query('unreadOnly') unreadOnly?: string,
    @Query('limit') limit?: string,
  ) {
    return this.notifications.list(req.user.organizationId, req.user.sub, {
      unreadOnly: unreadOnly === 'true' || unreadOnly === '1',
      limit: limit ? Number(limit) : undefined,
    })
  }

  @Get('unread-count')
  unreadCount(@Req() req: { user: JwtPayload }) {
    return this.notifications.unreadCount(req.user.organizationId, req.user.sub)
  }

  @Post(':id/read')
  markRead(@Req() req: { user: JwtPayload }, @Param('id') id: string) {
    return this.notifications.markRead(req.user.organizationId, req.user.sub, id)
  }

  @Post('read-all')
  markAllRead(@Req() req: { user: JwtPayload }) {
    return this.notifications.markAllRead(req.user.organizationId, req.user.sub)
  }
}
