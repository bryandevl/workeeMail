import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { SimpleEmailController } from 'src/controller/simple-email.controller'; // ✅ Subir 2 niveles
import { SimpleEmailService } from 'src/services/simple-email.service';         // ✅ Subir 2 niveles
import { EmailApiService } from 'src/services/email-api.service';               // ✅ Subir 2 niveles
import { ExcelService } from 'src/services/excel.service';                      // ✅ Subir 2 niveles
import { Correo } from 'src/entities/correo.entity';                            // ✅ Subir 2 niveles
import { Resul_val_correo } from 'src/entities/result_val_correo.entity';      // ✅ Subir 2 niveles
import { DashboardService } from 'src/services/dashboard.service';
import { DashboardController } from 'src/controller/dashboard.controller';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([Correo, Resul_val_correo]),
  ],
  controllers: [SimpleEmailController, DashboardController],
  providers: [SimpleEmailService, EmailApiService, ExcelService, DashboardService],
  exports: [SimpleEmailService, EmailApiService, ExcelService, DashboardService],
})
export class EmailValidationModule {}