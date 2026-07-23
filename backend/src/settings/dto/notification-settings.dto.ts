import { IsBoolean, IsOptional } from 'class-validator'

export class NotificationSettingsDto {
  @IsBoolean()
  inAppEnabled!: boolean

  @IsBoolean()
  emailEnabled!: boolean
}
