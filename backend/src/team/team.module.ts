import { Module } from '@nestjs/common'
import { AuditModule } from '../audit/audit.module'
import { TeamController } from './team.controller'
import { TeamService } from './team.service'

@Module({
  imports: [AuditModule],
  controllers: [TeamController],
  providers: [TeamService],
})
export class TeamModule {}
