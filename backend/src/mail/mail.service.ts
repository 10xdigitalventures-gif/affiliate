import { Injectable, Logger, Optional } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import * as nodemailer from 'nodemailer'
import type { Transporter } from 'nodemailer'

export interface SendMailArgs {
  to: string
  subject: string
  html: string
  text?: string
}

/**
 * MailService — thin Nodemailer wrapper.
 * Configure via env: MAIL_HOST, MAIL_PORT, MAIL_USER, MAIL_PASS, MAIL_FROM, APP_URL.
 * If MAIL_HOST is not set, emails are silently skipped (safe in dev/test).
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name)
  private readonly transporter: Transporter | null
  private readonly from: string
  readonly appUrl: string

  constructor(private readonly config: ConfigService) {
    const host = config.get<string>('MAIL_HOST')
    this.from = config.get<string>('MAIL_FROM') ?? 'Affiliate Platform <noreply@example.com>'
    this.appUrl = config.get<string>('APP_URL') ?? 'http://localhost:3000'

    if (host) {
      this.transporter = nodemailer.createTransport({
        host,
        port: Number(config.get<string>('MAIL_PORT') ?? 587),
        secure: Number(config.get<string>('MAIL_PORT') ?? 587) === 465,
        auth: {
          user: config.get<string>('MAIL_USER'),
          pass: config.get<string>('MAIL_PASS'),
        },
      })
      this.logger.log(`Mail transport configured (${host})`)
    } else {
      this.transporter = null
      this.logger.warn('MAIL_HOST not set — emails will be skipped')
    }
  }

  /** Send an email. Never throws — errors are logged. */
  async send(args: SendMailArgs): Promise<void> {
    if (!this.transporter) {
      this.logger.debug(`[MAIL SKIP] To: ${args.to} | Subject: ${args.subject}`)
      return
    }
    try {
      await this.transporter.sendMail({ from: this.from, ...args })
      this.logger.log(`Email sent to ${args.to}: ${args.subject}`)
    } catch (err) {
      this.logger.error(`Failed to send email to ${args.to}: ${(err as Error).message}`)
    }
  }
}
