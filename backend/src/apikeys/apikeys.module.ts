import { Module } from '@nestjs/common'
import { ApiKeysService } from './apikeys.service'
import { ApiKeysController } from './apikeys.controller'
import { PrismaModule } from '../prisma/prisma.module'

@Module({
  imports: [PrismaModule],
  controllers: [ApiKeysController],
  providers: [ApiKeysService],
  exports: [ApiKeysService],
})
export class ApiKeysModule {}
