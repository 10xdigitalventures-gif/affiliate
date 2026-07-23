import { Module } from '@nestjs/common'
import { StoresController } from './stores.controller'
import { StoresService } from './stores.service'
import { CatalogController } from './catalog.controller'
import { CatalogService } from './catalog.service'
import { StoreRegisterController } from './store-register.controller'
import { IntegrationsModule } from '../integrations/integrations.module'
import { ApiKeysModule } from '../apikeys/apikeys.module'

@Module({
  imports: [IntegrationsModule, ApiKeysModule],
  controllers: [StoresController, CatalogController, StoreRegisterController],
  providers: [StoresService, CatalogService],
  exports: [StoresService, CatalogService],
})
export class StoresModule {}
