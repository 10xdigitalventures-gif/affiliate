import { Module } from '@nestjs/common'
import { SuperAdminService } from './superadmin.service'
import { SuperAdminController } from './superadmin.controller'
import { SuperAdminGuard } from './superadmin.guard'
import { AuditModule } from '../audit/audit.module'
import { AuthModule } from '../auth/auth.module'

@Module({
  imports: [AuditModule, AuthModule],
  controllers: [SuperAdminController],
  providers: [SuperAdminService, SuperAdminGuard],
  exports: [SuperAdminService],
})
export class SuperAdminModule {}
