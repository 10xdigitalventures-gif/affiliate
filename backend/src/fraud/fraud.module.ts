import { Module, forwardRef } from '@nestjs/common'
import { FraudService } from './fraud.service'
import { FraudController } from './fraud.controller'
import { PrismaModule } from '../prisma/prisma.module'
import { AuditModule } from '../audit/audit.module'
import { CommissionsModule } from '../commissions/commissions.module'

@Module({
  imports: [PrismaModule, AuditModule, forwardRef(() => CommissionsModule)],
  controllers: [FraudController],
  providers: [FraudService],
  exports: [FraudService],
})
export class FraudModule {}
