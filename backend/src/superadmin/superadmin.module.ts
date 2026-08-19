import { Module } from '@nestjs/common'
import { SuperAdminService } from './superadmin.service'
import { SuperAdminController } from './superadmin.controller'
import { SuperAdminGuard } from './superadmin.guard'
import { AuditModule } from '../audit/audit.module'

@Module({
  imports: [AuditModule],
  controllers: [SuperAdminController],
  providers: [SuperAdminService, SuperAdminGuard],
  exports: [SuperAdminService],
})
export class SuperAdminModule {}
