import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { getTypeOrmConfig } from './config/typeorm.config';
import { EmailValidationModule } from './modules/email-validation/email-validation.module'; // ✅
import { ScheduleModule } from '@nestjs/schedule/dist/schedule.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule,
         ScheduleModule.forRoot(), ],
    
      useFactory: getTypeOrmConfig,
      inject: [ConfigService],
    }),
    
    EmailValidationModule, // ✅
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}