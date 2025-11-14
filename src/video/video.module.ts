import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { VideoGateway } from './video.gateway';

@Module({
  imports: [
    ConfigModule.forRoot(),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: '4h' },  // 4 hours - extended for long sessions
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [VideoGateway],
})
export class VideoModule {}
